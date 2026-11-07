'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { keyFor } = require('./document-store.cjs');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.ico']);
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGES = 120;
const MAX_SCAN_ENTRIES = 5000;
const contained = (parent, candidate) => {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
};

/** Electron adapters stay here; filesystem authorization belongs to ExplorerService. */
function installExplorerBridge({ registerHandler, service, store, getWindow, electron }) {
  const { dialog, shell, clipboard, nativeImage } = electron;
  let mutationQueue = Promise.resolve();
  function runMutation(operation) {
    const result = mutationQueue.catch(() => {}).then(operation);
    mutationQueue = result.catch(() => {});
    return result;
  }

  async function chooseWorkspaceFolder() {
    const result = await dialog.showOpenDialog(getWindow(), {
      title: 'Add folder to workspace', properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return runMutation(() => service.addRoot(result.filePaths[0]));
  }

  registerHandler('dv:add-workspace-folder', chooseWorkspaceFolder);
  registerHandler('dv:remove-workspace-folder', folderPath => runMutation(async () => {
    await service.removeRoot(folderPath);
    return service.listRoots();
  }));
  registerHandler('dv:refresh-workspace', () => service.listRoots());
  registerHandler('dv:create-entry', input => runMutation(() => service.createEntry(input)));
  registerHandler('dv:rename-entry', input => runMutation(() => service.renameEntry(input)));
  registerHandler('dv:delete-entry', entryPath => runMutation(async () => {
    const entry = await service.inspectPath(entryPath);
    const roots = await service.listRootPaths();
    if (roots.some(root => keyFor(root) === keyFor(entry.path))) throw new Error('Remove a workspace root from the workspace instead of deleting it.');
    const result = await dialog.showMessageBox(getWindow(), {
      type: 'warning', title: 'Delete permanently',
      message: `Permanently delete ${entry.name}?`,
      detail: `${entry.path}\n\n${entry.type === 'directory' ? 'This deletes the folder and everything inside it. ' : ''}This action cannot be undone and does not use the Recycle Bin.`,
      buttons: ['Cancel', 'Delete permanently'], defaultId: 0, cancelId: 0, noLink: true,
    });
    if (result.response !== 1) return null;
    return service.deleteEntry(entry.path);
  }));
  registerHandler('dv:set-file-clipboard', input => service.setClipboard(input));
  registerHandler('dv:get-file-clipboard', () => service.getClipboard());
  registerHandler('dv:paste-entry', parentPath => runMutation(() => service.pasteInto(parentPath)));
  registerHandler('dv:move-entries', input => runMutation(() => service.moveEntries(input)));
  registerHandler('dv:copy-path', async input => {
    if (!input || typeof input !== 'object') throw new Error('Choose a file or folder first.');
    const entry = await service.inspectPath(input.path);
    let value = entry.path;
    if (input.relativeTo) {
      const root = await service.inspectPath(input.relativeTo);
      if (root.type !== 'directory' || !contained(root.path, entry.path)) throw new Error('Choose the workspace folder containing this item.');
      value = path.relative(root.path, entry.path) || '.';
    } else if (input.relative === true) {
      value = await service.getRelativePath(entry.path);
    }
    clipboard.writeText(value);
    return value;
  });
  registerHandler('dv:show-in-folder', async entryPath => {
    const entry = await service.inspectPath(entryPath);
    shell.showItemInFolder(entry.path);
  });
  registerHandler('dv:find-in-folder', input => service.findInFolder(input));
  registerHandler('dv:folder-timeline', async folderPath => {
    const folder = await service.inspectPath(folderPath);
    if (folder.type !== 'directory') throw new Error('Choose a folder to view its timeline.');
    const known = new Map(Object.entries(store.state.historyPaths || {}));
    for (const recent of store.recent()) known.set(keyFor(recent.path), recent.path);
    const entries = [];
    for (const [key, filePath] of known) {
      if (typeof filePath !== 'string' || !contained(folder.path, filePath)) continue;
      for (const version of store.state.history[key] || []) {
        if (typeof version?.content !== 'string') continue;
        entries.push({ path: filePath, name: path.basename(filePath), id: version.id, timestamp: version.timestamp, content: version.content });
      }
    }
    return entries.sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp)).slice(0, 500);
  });

  function rasterPreview(image, maxDimension) {
    const original = image.getSize();
    if (!original.width || !original.height) throw new Error('This image cannot be previewed.');
    const scale = Math.min(1, maxDimension / Math.max(original.width, original.height));
    return scale < 1 ? image.resize({ width: Math.max(1, Math.round(original.width * scale)), height: Math.max(1, Math.round(original.height * scale)), quality: 'good' }) : image;
  }

  async function readImage(imagePath, maxDimension) {
    const entry = await service.inspectPath(imagePath);
    if (entry.type !== 'file' || !IMAGE_EXTENSIONS.has(path.extname(entry.path).toLowerCase())) throw new Error('Supported image previews are PNG, JPEG, GIF, WebP, BMP, and ICO.');
    const info = await fs.stat(entry.path);
    if (info.size > MAX_IMAGE_BYTES) throw new Error('Image previews support files up to 20 MB.');
    const image = nativeImage.createFromPath(entry.path);
    if (image.isEmpty()) throw new Error('This image cannot be previewed.');
    const dimensions = image.getSize();
    return { path: entry.path, name: entry.name, dataUrl: rasterPreview(image, maxDimension).toDataURL(), width: dimensions.width, height: dimensions.height };
  }

  registerHandler('dv:folder-images', async folderPath => {
    const folder = await service.inspectPath(folderPath);
    if (folder.type !== 'directory') throw new Error('Choose a folder to preview its images.');
    const images = [];
    let scanned = 0, skipped = 0, truncated = false;
    async function walk(directory, depth) {
      if (depth > 5) { truncated = true; return; }
      const entries = await fs.readdir(directory, { withFileTypes: true });
      entries.sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
      for (const entry of entries) {
        if (++scanned > MAX_SCAN_ENTRIES || images.length >= MAX_IMAGES) { truncated = true; return; }
        if (entry.isSymbolicLink() || entry.name.startsWith('.') || ['node_modules', 'dist', 'release'].includes(entry.name)) continue;
        const fullPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          try { await service.inspectPath(fullPath); await walk(fullPath, depth + 1); } catch { skipped++; }
        } else if (entry.isFile() && IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
          try {
            const image = await readImage(fullPath, 224);
            images.push({ path: image.path, name: image.name, thumbnail: image.dataUrl });
          } catch { skipped++; }
        }
      }
    }
    await walk(folder.path, 0);
    return { images, truncated, skipped };
  });
  registerHandler('dv:open-image', imagePath => readImage(imagePath, 2560));

  return { chooseWorkspaceFolder, runMutation };
}

module.exports = { installExplorerBridge, IMAGE_EXTENSIONS, MAX_IMAGE_BYTES };
