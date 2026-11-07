'use strict';

const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const { EXTENSIONS, MAX_FILE_BYTES, encodeDocument, decodeDocument, keyFor, readFolder } = require('./document-store.cjs');

const MAX_OPERATION_ENTRIES = 20000;
const MAX_COPY_BYTES = 512 * 1024 * 1024;
const normalize = value => path.resolve(value);
const pathKey = value => process.platform === 'win32' ? normalize(value).toLowerCase() : normalize(value);
function isWithin(parent, candidate) {
  const relative = path.relative(pathKey(parent), pathKey(candidate));
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
function validPath(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || value.includes('\0')) throw new Error('Choose a valid local path.');
  return normalize(value);
}
function validName(value) {
  if (typeof value !== 'string' || !value || value.length > 240 || /[<>:"/\\|?*\x00-\x1f]/.test(value) || /[. ]$/.test(value) || value === '.' || value === '..' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)) {
    throw new Error('Use a file or folder name without reserved characters, trailing spaces, or trailing dots.');
  }
  return value;
}
async function exists(filePath) {
  try { await fs.lstat(filePath); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}
function entryInfo(filePath, stat) {
  return { path: filePath, name: path.basename(filePath), type: stat.isDirectory() ? 'directory' : 'file' };
}

class ExplorerService {
  constructor({ store } = {}) {
    this.store = store;
    this.roots = new Map();
    this.authorizedFiles = new Map();
    this.clipboard = null;
    this.loading = null;
    this.queue = Promise.resolve();
  }

  async _loadRoots() {
    if (!this.loading) this.loading = (async () => {
      const persisted = this.store?.state?.workspaceRoots;
      if (!Array.isArray(persisted)) return;
      for (const item of persisted.slice(0, 30)) {
        try { const resolved = validPath(item); this.roots.set(pathKey(resolved), resolved); } catch {}
      }
    })();
    await this.loading;
  }

  async _persist() {
    if (!this.store) return;
    this.store.state.workspaceRoots = [...this.roots.values()];
    await this.store.persist();
  }

  _mutate(work) {
    const pending = this.queue.catch(() => {}).then(work);
    this.queue = pending.catch(() => {});
    return pending;
  }

  async listRootPaths() { await this._loadRoots(); return [...this.roots.values()]; }
  async getRootsPaths() { return this.listRootPaths(); }

  async listRoots() {
    await this._loadRoots();
    return Promise.all([...this.roots.values()].map(async root => {
      try { await this._checkDirectory(root); return await readFolder(root); }
      catch { return { name: path.basename(root) || root, path: root, entries: [], unavailable: true }; }
    }));
  }

  async _checkDirectory(directory) {
    const stat = await fs.lstat(directory);
    if (stat.isSymbolicLink()) throw new Error('Linked folders are not supported for file operations.');
    if (!stat.isDirectory()) throw new Error('Choose a folder.');
    return stat;
  }

  async addRoot(directory) {
    await this._loadRoots();
    const resolved = validPath(directory);
    await this._checkDirectory(resolved);
    const real = await fs.realpath(resolved);
    this.roots.set(pathKey(real), real);
    await this._persist();
    return readFolder(real);
  }

  async removeRoot(directory) {
    await this._loadRoots();
    const removed = this.roots.delete(pathKey(validPath(directory)));
    if (removed) await this._persist();
    return removed;
  }

  async authorizeFile(filePath) {
    const resolved = validPath(filePath);
    const stat = await fs.lstat(resolved);
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Choose a regular local file.');
    const real = await fs.realpath(resolved);
    this.authorizedFiles.set(pathKey(real), real);
    return entryInfo(real, stat);
  }

  async assertAuthorized(filePath) {
    await this._loadRoots();
    const resolved = validPath(filePath);
    const roots = [...this.roots.values()].filter(root => isWithin(root, resolved)).sort((a, b) => b.length - a.length);
    if (!roots.length && !this.authorizedFiles.has(pathKey(resolved))) throw new Error('Open this file or add its folder to the workspace first.');
    const base = roots[0] || resolved;
    await fs.lstat(base).then(stat => { if (stat.isSymbolicLink()) throw new Error('Linked files and folders are not supported for file operations.'); });
    const relative = path.relative(base, resolved);
    let current = base;
    for (const segment of relative.split(path.sep).filter(Boolean)) {
      current = path.join(current, segment);
      const stat = await fs.lstat(current);
      if (stat.isSymbolicLink()) throw new Error('Linked files and folders are not supported for file operations.');
    }
    const real = await fs.realpath(resolved);
    // A root may itself have been replaced by a junction since it was opened.
    if (pathKey(real) !== pathKey(resolved)) throw new Error('The selected path has changed. Reopen its folder before continuing.');
    const stat = await fs.lstat(real);
    if (!stat.isFile() && !stat.isDirectory()) throw new Error('Choose a regular file or folder.');
    if (stat.isDirectory() && !roots.length) throw new Error('Add this folder to the workspace first.');
    return entryInfo(real, stat);
  }

  async inspectPath(filePath) { return this.assertAuthorized(filePath); }

  async getRelativePath(filePath) {
    const item = await this.assertAuthorized(filePath);
    const root = [...this.roots.values()].filter(candidate => isWithin(candidate, item.path)).sort((a, b) => b.length - a.length)[0];
    return root ? (path.relative(root, item.path) || path.basename(root)) : item.name;
  }

  _protectRoot(filePath) {
    if ([...this.roots.values()].some(root => isWithin(filePath, root))) throw new Error('Remove this folder from the workspace before moving, renaming, or deleting it.');
  }

  async _parent(parentPath) {
    const parent = await this.assertAuthorized(parentPath);
    if (parent.type !== 'directory') throw new Error('Choose a destination folder.');
    return parent.path;
  }

  async createEntry({ parentPath, name, type } = {}) {
    return this._mutate(async () => {
      const parent = await this._parent(parentPath);
      if (!['file', 'directory'].includes(type)) throw new Error('Choose a file or folder to create.');
      let safeName = validName(name);
      if (type === 'file') {
        if (!path.extname(safeName)) safeName += '.dv';
        if (!EXTENSIONS.has(path.extname(safeName).toLowerCase())) throw new Error('Use .dv, .txt, .csv, .tsv, .json, or .md for a new text file.');
      }
      const destination = path.join(parent, safeName);
      if (!isWithin(parent, destination) || destination === parent) throw new Error('Choose a name inside the selected folder.');
      if (await exists(destination)) throw new Error('An item with that name already exists.');
      if (type === 'directory') await fs.mkdir(destination);
      else { await fs.writeFile(destination, encodeDocument('', destination), { flag: 'wx', encoding: 'utf8' }); await this.authorizeFile(destination); }
      return { path: destination, name: safeName, type };
    });
  }

  async _scanTree(entry, { copy = false } = {}) {
    const result = [];
    let bytes = 0;
    const walk = async (entryPath, relative = '') => {
      const stat = await fs.lstat(entryPath);
      if (stat.isSymbolicLink()) throw new Error('This folder contains a linked item. Linked items are not supported for file operations.');
      if (!stat.isDirectory() && !stat.isFile()) throw new Error('This folder contains an unsupported special file.');
      if (result.length >= MAX_OPERATION_ENTRIES) throw new Error('This operation is limited to 20,000 files and folders.');
      bytes += stat.isFile() ? stat.size : 0;
      if (copy && bytes > MAX_COPY_BYTES) throw new Error('Copy operations are limited to 512 MB at a time.');
      result.push({ path: entryPath, relative, type: stat.isDirectory() ? 'directory' : 'file', size: stat.size, mtimeMs: stat.mtimeMs });
      if (stat.isDirectory()) for (const name of await fs.readdir(entryPath)) await walk(path.join(entryPath, name), path.join(relative, name));
    };
    await walk(entry.path);
    return result;
  }

  async _remap(oldPath, newPath, entries = []) {
    for (const [key, filePath] of this.authorizedFiles) if (isWithin(oldPath, filePath)) {
      this.authorizedFiles.delete(key);
      if (newPath) { const moved = path.join(newPath, path.relative(oldPath, filePath)); this.authorizedFiles.set(pathKey(moved), moved); }
    }
    if (this.clipboard && isWithin(oldPath, this.clipboard.path)) this.clipboard = newPath ? { ...this.clipboard, path: path.join(newPath, path.relative(oldPath, this.clipboard.path)) } : null;
    if (!this.store) return;
    const state = this.store.state;
    const candidates = new Set([oldPath, ...entries.filter(item => item.type === 'file').map(item => item.path), ...(state.recent || []).map(item => item.path), ...Object.values(state.historyPaths || {})]);
    for (const source of candidates) {
      if (typeof source !== 'string' || !isWithin(oldPath, source)) continue;
      const oldKey = keyFor(source);
      const history = state.history?.[oldKey];
      if (newPath) {
        const destination = path.join(newPath, path.relative(oldPath, source));
        const newKey = keyFor(destination);
        if (history) state.history[newKey] = history.map(item => ({ ...item, name: path.basename(destination) }));
        if (state.historyPaths && (history || state.historyPaths[oldKey])) state.historyPaths[newKey] = destination;
        if (newKey === oldKey) continue;
      }
      if (state.history) delete state.history[oldKey];
      if (state.historyPaths) delete state.historyPaths[oldKey];
    }
    state.recent = (state.recent || []).flatMap(item => {
      if (!isWithin(oldPath, item.path)) return [item];
      if (!newPath) return [];
      const destination = path.join(newPath, path.relative(oldPath, item.path));
      return [{ ...item, path: destination, name: path.basename(destination) }];
    });
    await this._persist().catch(error => console.warn('The file operation completed, but saved history could not be updated:', error.message));
  }

  async renameEntry({ path: filePath, name } = {}) {
    return this._mutate(async () => {
      const source = await this.assertAuthorized(filePath);
      this._protectRoot(source.path);
      const safeName = validName(name);
      if (source.type === 'file' && path.extname(source.path).toLowerCase() !== path.extname(safeName).toLowerCase()) throw new Error('Keep the file extension when renaming. Use Save As to change its format.');
      const destination = path.join(path.dirname(source.path), safeName);
      if (destination === source.path) return { ...source, oldPath: source.path };
      if (pathKey(destination) !== pathKey(source.path) && await exists(destination)) throw new Error('An item with that name already exists.');
      const entries = await this._scanTree(source);
      await this.assertAuthorized(source.path);
      await fs.rename(source.path, destination);
      await this._remap(source.path, destination, entries);
      return { path: destination, oldPath: source.path, name: safeName, type: source.type };
    });
  }

  async deleteEntry(filePath) {
    return this._mutate(async () => {
      const source = await this.assertAuthorized(filePath);
      this._protectRoot(source.path);
      const entries = await this._scanTree(source);
      await this.assertAuthorized(source.path);
      // source was resolved and checked against an authorized root/exact-file grant above.
      if (source.type === 'directory') await fs.rm(source.path, { recursive: true, force: false });
      else await fs.unlink(source.path);
      await this._remap(source.path, null, entries);
      return source;
    });
  }

  async setClipboard({ path: filePath, mode } = {}) {
    if (!['cut', 'copy'].includes(mode)) throw new Error('Choose Cut or Copy.');
    const source = await this.assertAuthorized(filePath);
    if (mode === 'cut') this._protectRoot(source.path);
    this.clipboard = { path: source.path, mode, type: source.type };
    return this.getClipboard();
  }

  getClipboard() { return this.clipboard ? { ...this.clipboard } : null; }

  async _availableDestination(parent, sourceName, type, reserved = new Set()) {
    let destination = path.join(parent, sourceName);
    if (!reserved.has(pathKey(destination)) && !await exists(destination)) return destination;
    const extension = type === 'file' ? path.extname(sourceName) : '';
    const base = extension ? sourceName.slice(0, -extension.length) : sourceName;
    for (let index = 1; index < 10000; index++) {
      destination = path.join(parent, `${base} copy${index === 1 ? '' : ` ${index}`}${extension}`);
      if (!reserved.has(pathKey(destination)) && !await exists(destination)) return destination;
    }
    throw new Error('There are too many copies with this name in the destination folder.');
  }

  async _copyEntries(entries, destination, parent) {
    let created = false;
    try {
      if (entries.reduce((bytes, item) => bytes + (item.type === 'file' ? item.size : 0), 0) > MAX_COPY_BYTES) throw new Error('Copying or moving between drives is limited to 512 MB at a time.');
      for (const item of entries) {
        await this.assertAuthorized(item.path);
        const current = await fs.lstat(item.path);
        if (current.isSymbolicLink() || (current.isDirectory() ? 'directory' : 'file') !== item.type) throw new Error('The source changed during copying. Try again.');
        const target = path.join(destination, item.relative);
        if (!isWithin(destination, target)) throw new Error('Invalid copy destination.');
        if (item.type === 'directory') await fs.mkdir(target);
        else await fs.copyFile(item.path, target, constants.COPYFILE_EXCL);
        created = true;
      }
    } catch (error) {
      // Only a newly-created, bounded destination is eligible for partial-copy cleanup.
      if (created && isWithin(parent, destination) && pathKey(parent) !== pathKey(destination)) await fs.rm(destination, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
  }

  async _crossDeviceMove(source, entries, destination, parent) {
    await this._copyEntries(entries, destination, parent);
    try {
      const current = await this._scanTree(source);
      if (current.length !== entries.length) throw new Error('The source changed while it was being moved.');
      const original = new Map(entries.map(item => [item.relative, item]));
      for (const item of current) {
        const before = original.get(item.relative);
        if (!before || before.type !== item.type || (item.type === 'file' && (before.size !== item.size || before.mtimeMs !== item.mtimeMs))) throw new Error('The source changed while it was being moved.');
      }
      await this.assertAuthorized(source.path);
    } catch (error) {
      // Keep the source intact and remove only this operation's complete duplicate.
      if (isWithin(parent, destination) && pathKey(parent) !== pathKey(destination)) await fs.rm(destination, { recursive: true, force: true }).catch(() => {});
      throw error;
    }
    // Both source and destination were resolved and checked against workspace grants.
    if (source.type === 'directory') await fs.rm(source.path, { recursive: true, force: false });
    else await fs.unlink(source.path);
  }

  /** Move a selection without using or clearing the internal cut/copy clipboard. */
  async moveEntries({ paths, destinationPath } = {}) {
    return this._mutate(async () => {
      if (!Array.isArray(paths) || !paths.length || paths.length > 1500) throw new Error('Choose between 1 and 1,500 files or folders to move.');
      const parent = await this._parent(destinationPath);
      const unique = new Map();
      for (const filePath of paths) {
        const resolved = validPath(filePath);
        if (!unique.has(pathKey(resolved))) unique.set(pathKey(resolved), await this.assertAuthorized(resolved));
      }
      const selected = [...unique.values()];
      // A selected directory already carries its selected descendants with it.
      const sources = selected.filter(source => !selected.some(other => other !== source && other.type === 'directory' && isWithin(other.path, source.path)));
      const plans = [];
      const reserved = new Set();
      let totalEntries = 0;
      // Complete every authorization, containment, and tree check before moving anything.
      for (const source of sources) {
        this._protectRoot(source.path);
        if (source.type === 'directory' && isWithin(source.path, parent)) throw new Error('A folder cannot be moved into itself or one of its subfolders.');
        const entries = await this._scanTree(source);
        totalEntries += entries.length;
        if (totalEntries > MAX_OPERATION_ENTRIES) throw new Error('This selection is limited to 20,000 files and folders.');
        const unchanged = pathKey(path.dirname(source.path)) === pathKey(parent);
        const destination = unchanged ? source.path : await this._availableDestination(parent, source.name, source.type, reserved);
        if (!isWithin(parent, destination) || pathKey(destination) === pathKey(parent)) throw new Error('Choose a destination inside the selected folder.');
        reserved.add(pathKey(destination));
        plans.push({ source, destination, unchanged });
      }
      const moved = [], failed = [];
      for (const plan of plans) {
        const { source, unchanged } = plan;
        let destination = plan.destination;
        try {
          const current = await this.assertAuthorized(source.path);
          if (current.type !== source.type) throw new Error('The selected item changed before it could be moved.');
          await this._parent(parent);
          this._protectRoot(source.path);
          if (unchanged) {
            moved.push({ ...source, oldPath: source.path, mode: 'cut', unchanged: true });
            continue;
          }
          // Recheck after preflight so a folder changed externally is not moved unchecked.
          const entries = await this._scanTree(current);
          if (await exists(destination)) {
            reserved.delete(pathKey(destination));
            destination = await this._availableDestination(parent, source.name, source.type, reserved);
            reserved.add(pathKey(destination));
          }
          try { await fs.rename(source.path, destination); }
          catch (error) { if (error.code === 'EXDEV') await this._crossDeviceMove(current, entries, destination, parent); else throw error; }
          // A completed disk move must be reported even if history persistence fails.
          await this._remap(source.path, destination, entries).catch(error => console.warn('The item moved, but its metadata could not be updated:', error.message));
          moved.push({ oldPath: source.path, path: destination, name: path.basename(destination), type: source.type, mode: 'cut' });
        } catch (error) {
          failed.push({ path: source.path, message: error.message || 'This item could not be moved.' });
        }
      }
      return { moved, failed };
    });
  }

  async pasteInto(parentPath) {
    return this._mutate(async () => {
      const clipboard = this.getClipboard();
      if (!clipboard) throw new Error('Copy or cut a file or folder before pasting.');
      const parent = await this._parent(parentPath);
      const source = await this.assertAuthorized(clipboard.path);
      if (source.type === 'directory' && isWithin(source.path, parent)) throw new Error('A folder cannot be pasted inside itself.');
      if (clipboard.mode === 'cut') this._protectRoot(source.path);
      if (clipboard.mode === 'cut' && pathKey(path.dirname(source.path)) === pathKey(parent)) { this.clipboard = null; return { ...source, oldPath: source.path, mode: 'cut', unchanged: true }; }
      const destination = await this._availableDestination(parent, source.name, source.type);
      if (!isWithin(parent, destination) || pathKey(destination) === pathKey(parent)) throw new Error('Choose a destination inside the selected folder.');
      const entries = await this._scanTree(source, { copy: clipboard.mode === 'copy' });
      await this.assertAuthorized(source.path);
      if (clipboard.mode === 'cut') {
        try { await fs.rename(source.path, destination); }
        catch (error) { if (error.code === 'EXDEV') await this._crossDeviceMove(source, entries, destination, parent); else throw error; }
        await this._remap(source.path, destination, entries);
        this.clipboard = null;
      } else {
        await this._copyEntries(entries, destination, parent);
      }
      if (source.type === 'file') await this.authorizeFile(destination);
      return { path: destination, oldPath: clipboard.mode === 'cut' ? source.path : undefined, name: path.basename(destination), type: source.type, mode: clipboard.mode };
    });
  }

  async findInFolder({ path: folderPath, query, caseSensitive = false } = {}) {
    const directory = await this._parent(folderPath);
    if (typeof query !== 'string' || !query.trim() || query.length > 500) throw new Error('Enter search text between 1 and 500 characters.');
    const needle = caseSensitive ? query : query.toLowerCase();
    const matches = [];
    let scanned = 0, visited = 0, truncated = false;
    const walk = async (current, depth) => {
      if (depth > 12) { truncated = true; return; }
      const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => []);
      for (const entry of entries) {
        if (matches.length >= 500 || visited >= MAX_OPERATION_ENTRIES || scanned >= 2000) { truncated = true; return; }
        visited++;
        if (entry.isSymbolicLink() || ['node_modules', '.git', '.local-cache'].includes(entry.name)) continue;
        const filePath = path.join(current, entry.name);
        if (entry.isDirectory()) { await walk(filePath, depth + 1); continue; }
        if (!entry.isFile() || !EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;
        try {
          await this.assertAuthorized(filePath);
          const stat = await fs.stat(filePath);
          if (stat.size > MAX_FILE_BYTES * (path.extname(filePath).toLowerCase() === '.dv' ? 6 : 1)) { truncated = true; continue; }
          const content = decodeDocument(await fs.readFile(filePath, 'utf8'), filePath);
          scanned++;
          const lines = content.split(/\r\n|\n|\r/);
          for (let index = 0; index < lines.length; index++) {
            const haystack = caseSensitive ? lines[index] : lines[index].toLowerCase();
            let column = haystack.indexOf(needle);
            while (column >= 0) {
              if (matches.length >= 500) { truncated = true; return; }
              matches.push({ path: filePath, name: entry.name, line: index + 1, column: column + 1, text: lines[index].slice(Math.max(0, column - 100), column + 300) });
              column = haystack.indexOf(needle, column + Math.max(1, needle.length));
            }
          }
        } catch { /* Unreadable or unsupported content does not prevent searching other files. */ }
      }
    };
    await walk(directory, 0);
    return { matches, truncated, scanned };
  }
}

module.exports = { ExplorerService, isWithin, validName, MAX_OPERATION_ENTRIES, MAX_COPY_BYTES };
