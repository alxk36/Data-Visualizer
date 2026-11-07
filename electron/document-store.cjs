'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_HISTORY_BYTES = 32 * 1024 * 1024;
const EXTENSIONS = new Set(['.dv', '.txt', '.csv', '.json', '.md', '.tsv']);
const keyFor = value => createHash('sha256').update(path.resolve(value).toLowerCase()).digest('hex');

function validateText(content) {
  if (typeof content !== 'string') throw new Error('The file must contain text.');
  if (Buffer.byteLength(content, 'utf8') > MAX_FILE_BYTES) throw new Error('Please choose a text file smaller than 8 MB.');
  if (content.includes('\0')) throw new Error('This file contains binary data and cannot be opened as text.');
}

function decodeDocument(content, filePath) {
  if (path.extname(filePath).toLowerCase() !== '.dv') { validateText(content); return content; }
  if (typeof content !== 'string') throw new Error('The file must contain text.');
  let document;
  try { document = JSON.parse(content.replace(/^\uFEFF/, '')); }
  catch { throw new Error('This .dv file is not a valid Data Visualizer document.'); }
  if (document?.format !== 'data-visualizer' || document.version !== 1 || typeof document.content !== 'string') {
    throw new Error('This .dv file uses an unsupported Data Visualizer format.');
  }
  validateText(document.content);
  return document.content;
}

function encodeDocument(content, filePath) {
  validateText(content);
  return path.extname(filePath).toLowerCase() === '.dv'
    ? JSON.stringify({ format: 'data-visualizer', version: 1, content }, null, 2) + '\n'
    : content;
}

async function atomicWrite(filePath, content) {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporaryPath, content, { encoding: 'utf8', flag: 'wx' });
    await fs.rename(temporaryPath, filePath);
  } finally {
    await fs.unlink(temporaryPath).catch(() => {});
  }
}

class DocumentStore {
  constructor(userData) {
    this.directory = userData;
    this.statePath = path.join(userData, 'documents-v1.json');
    this.state = { version: 1, recent: [], history: {}, historyPaths: {} };
    this.queue = Promise.resolve();
  }

  async initialize() {
    await fs.mkdir(this.directory, { recursive: true });
    try {
      const loaded = JSON.parse(await fs.readFile(this.statePath, 'utf8'));
      if (loaded.version === 1 && Array.isArray(loaded.recent) && loaded.history && typeof loaded.history === 'object') {
        this.state = loaded;
        this.state.recent = loaded.recent.filter(item => typeof item?.path === 'string' && typeof item?.name === 'string').slice(0, 20);
        this.state.historyPaths = loaded.historyPaths && typeof loaded.historyPaths === 'object' && !Array.isArray(loaded.historyPaths) ? loaded.historyPaths : {};
        for (const item of this.state.recent) if (this.state.history[keyFor(item.path)]) this.state.historyPaths[keyFor(item.path)] = item.path;
      }
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Could not read saved document history:', error.message);
    }
  }

  recent() {
    return this.state.recent.map(({ path: filePath, name, updatedAt }) => ({ path: filePath, name, updatedAt }));
  }

  async read(filePath) {
    if (typeof filePath !== 'string' || !path.isAbsolute(filePath)) throw new Error('Choose a valid local file.');
    const resolved = path.resolve(filePath);
    if (!EXTENSIONS.has(path.extname(resolved).toLowerCase())) throw new Error('Supported files are .dv, .txt, .csv, .json, .md, and .tsv.');
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) throw new Error('Please choose a file.');
    // The JSON container may be larger than the text it contains because of escaping.
    if (stat.size > MAX_FILE_BYTES * (path.extname(resolved).toLowerCase() === '.dv' ? 6 : 1)) throw new Error('Please choose a text file smaller than 8 MB.');
    const raw = await fs.readFile(resolved, 'utf8');
    const content = decodeDocument(raw, resolved);
    this.touch(resolved);
    await this.persist().catch(error => console.warn('Could not save recent files:', error.message));
    return { id: keyFor(resolved), name: path.basename(resolved), path: resolved, content };
  }

  touch(filePath) {
    const key = keyFor(filePath);
    this.state.recent = [{ path: filePath, name: path.basename(filePath), updatedAt: new Date().toISOString() }, ...this.state.recent.filter(item => keyFor(item.path) !== key)].slice(0, 20);
  }

  record(filePath, content) {
    const key = keyFor(filePath);
    (this.state.historyPaths ||= {})[key] = path.resolve(filePath);
    const snapshots = Array.isArray(this.state.history[key]) ? this.state.history[key] : [];
    if (snapshots[0]?.content === content) return;
    this.state.history[key] = [{ id: randomUUID(), timestamp: new Date().toISOString(), content, name: path.basename(filePath) }, ...snapshots].slice(0, 20);
    const all = Object.entries(this.state.history).flatMap(([fileKey, items]) => (Array.isArray(items) ? items : []).map(snapshot => ({ fileKey, snapshot })));
    all.sort((a, b) => Date.parse(b.snapshot.timestamp) - Date.parse(a.snapshot.timestamp));
    let bytes = 0;
    const kept = {};
    for (const { fileKey, snapshot } of all) {
      if (typeof snapshot.content !== 'string') continue;
      bytes += Buffer.byteLength(snapshot.content, 'utf8');
      if (bytes > MAX_HISTORY_BYTES) break;
      (kept[fileKey] ||= []).push(snapshot);
    }
    this.state.history = kept;
    for (const key of Object.keys(this.state.historyPaths)) if (!kept[key]) delete this.state.historyPaths[key];
  }

  async save(filePath, content) {
    const resolved = path.resolve(filePath);
    const encoded = encodeDocument(content, resolved);
    // Preserve the previous on-disk content as the first revision when replacing it.
    try {
      const previous = decodeDocument(await fs.readFile(resolved, 'utf8'), resolved);
      this.record(resolved, previous);
    } catch (error) {
      if (error.code !== 'ENOENT') console.warn('Previous content was not added to history:', error.message);
    }
    await atomicWrite(resolved, encoded);
    this.touch(resolved);
    this.record(resolved, content);
    await this.persist().catch(error => console.warn('File saved, but history could not be updated:', error.message));
    return { path: resolved, name: path.basename(resolved) };
  }

  history(filePath) {
    const items = this.state.history[keyFor(filePath)];
    return Array.isArray(items) ? structuredClone(items) : [];
  }

  persist() {
    const serialized = JSON.stringify(this.state);
    this.queue = this.queue.catch(() => {}).then(() => atomicWrite(this.statePath, serialized));
    return this.queue;
  }
}

async function readFolder(folderPath) {
  let count = 0;
  const walk = async (directory, depth) => {
    if (depth > 5 || count >= 1500) return [];
    const entries = await fs.readdir(directory, { withFileTypes: true });
    const output = [];
    for (const entry of entries) {
      if (count >= 1500) break;
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || ['node_modules', 'dist', 'release'].includes(entry.name)) continue;
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        count++;
        const children = await walk(entryPath, depth + 1).catch(() => []);
        output.push({ type: 'directory', name: entry.name, path: entryPath, children });
      } else if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        count++;
        output.push({ type: 'file', name: entry.name, path: entryPath });
      }
    }
    return output.sort((a, b) => (a.type === b.type ? 0 : a.type === 'directory' ? -1 : 1) || a.name.localeCompare(b.name, undefined, { numeric: true }));
  };
  return { name: path.basename(folderPath), path: folderPath, entries: await walk(folderPath, 0) };
}

module.exports = { DocumentStore, EXTENSIONS, MAX_FILE_BYTES, atomicWrite, decodeDocument, encodeDocument, keyFor, readFolder, validateText };
