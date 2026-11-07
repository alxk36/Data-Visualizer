'use strict';

const electron = require('electron');
const { app, BrowserWindow, dialog, ipcMain, Menu } = electron;
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { DocumentStore, EXTENSIONS, keyFor, validateText } = require('./document-store.cjs');
const { ExplorerService } = require('./explorer-service.cjs');
const { installExplorerBridge } = require('./explorer-bridge.cjs');

const UI_PATH = path.join(__dirname, '..', 'src', 'index.html');
const UI_URL = pathToFileURL(UI_PATH).href;
const FILTERS = [
  { name: 'Data Visualizer and text files', extensions: ['dv', 'txt', 'csv', 'json', 'md', 'tsv'] },
  { name: 'Data Visualizer document', extensions: ['dv'] },
  { name: 'Text files', extensions: ['txt', 'csv', 'json', 'md', 'tsv'] },
];

let window;
let store;
let explorer;
let explorerBridge;
let dirty = false;
let allowClose = false;
let rendererReady = false;
let awaitingClose = false;
let pendingPaths = [];

app.setName('Data Visualizer');
app.setAppUserModelId('com.datavisualizer.desktop');
const customDataDirectory = app.commandLine.getSwitchValue('user-data-dir') || (!app.isPackaged && process.env.DV_USER_DATA_DIR);
if (customDataDirectory && path.isAbsolute(customDataDirectory)) app.setPath('userData', path.resolve(customDataDirectory));

function pathsFromArguments(argv) {
  return argv.filter(value => typeof value === 'string' && !value.startsWith('-') && path.isAbsolute(value) && EXTENSIONS.has(path.extname(value).toLowerCase()));
}

function requireSender(event) {
  if (!window || event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url.split('#')[0] !== UI_URL) {
    throw new Error('This request is not allowed.');
  }
}

function registerHandler(channel, handler) {
  ipcMain.handle(channel, async (event, ...args) => {
    requireSender(event);
    return handler(...args);
  });
}

async function readPaths(paths) {
  if (!Array.isArray(paths) || paths.length > 50 || paths.some(value => typeof value !== 'string')) throw new Error('Choose up to 50 text files at a time.');
  const files = [];
  for (const filePath of [...new Set(paths)]) {
    try {
      const file = await store.read(filePath);
      await explorer.authorizeFile(file.path);
      files.push(file);
    } catch (error) {
      await dialog.showMessageBox(window, { type: 'error', title: 'Unable to open file', message: `Could not open ${path.basename(filePath)}.`, detail: error.message });
    }
  }
  return files;
}

async function receiveFiles(paths) {
  if (!paths.length) return;
  if (!rendererReady || !store) { pendingPaths.push(...paths); return; }
  const files = await readPaths(paths);
  if (files.length && window && !window.isDestroyed()) window.webContents.send('dv:files', files);
}

function installHandlers() {
  explorerBridge = installExplorerBridge({ registerHandler, service: explorer, store, getWindow: () => window, electron });
  registerHandler('dv:initial', async () => {
    const initialPaths = pendingPaths;
    pendingPaths = [];
    const files = await readPaths(initialPaths);
    rendererReady = true;
    // Requests that arrived while initial files were read must also be delivered.
    if (pendingPaths.length) {
      const queued = pendingPaths;
      pendingPaths = [];
      setImmediate(() => receiveFiles(queued));
    }
    return { files, recent: store.recent(), folders: await explorer.listRoots() };
  });

  registerHandler('dv:open-files', async () => {
    const result = await dialog.showOpenDialog(window, { title: 'Open in Data Visualizer', properties: ['openFile', 'multiSelections'], filters: FILTERS });
    return result.canceled ? [] : readPaths(result.filePaths);
  });

  registerHandler('dv:open-paths', readPaths);

  registerHandler('dv:open-folder', () => explorerBridge.chooseWorkspaceFolder());

  registerHandler('dv:save-file', async file => {
    if (!file || typeof file !== 'object') throw new Error('Choose a document to save.');
    validateText(file.content);
    let targetPath = typeof file.path === 'string' && path.isAbsolute(file.path) ? path.resolve(file.path) : null;
    let chosenNativeTarget = false;
    let authorized = false;
    if (targetPath) authorized = await explorer.assertAuthorized(targetPath).then(entry => entry.type === 'file', () => false);
    if (!targetPath || file.saveAs || !authorized) {
      const suggestedName = typeof file.name === 'string' ? path.basename(file.name) : 'Untitled.dv';
      const result = await dialog.showSaveDialog(window, {
        title: file.saveAs ? 'Save document as' : 'Save document',
        defaultPath: targetPath || path.join(app.getPath('documents'), path.extname(suggestedName) ? suggestedName : `${suggestedName}.dv`),
        filters: [
          { name: 'Data Visualizer document', extensions: ['dv'] },
          { name: 'Plain text', extensions: ['txt'] },
          { name: 'CSV data', extensions: ['csv'] },
          { name: 'JSON data', extensions: ['json'] },
          { name: 'Markdown', extensions: ['md'] },
          { name: 'Tab-separated data', extensions: ['tsv'] },
        ],
      });
      if (result.canceled || !result.filePath) return null;
      targetPath = result.filePath;
      chosenNativeTarget = true;
    }
    if (!EXTENSIONS.has(path.extname(targetPath).toLowerCase())) throw new Error('Save with a .dv, .txt, .csv, .json, .md, or .tsv extension.');
    const occupied = Array.isArray(file.occupiedPaths) ? file.occupiedPaths.filter(value => typeof value === 'string' && path.isAbsolute(value)) : [];
    if (occupied.some(value => keyFor(value) === keyFor(targetPath))) throw new Error('That file is already open in another document. Close that document before replacing it with Save As.');
    return explorerBridge.runMutation(async () => {
      // A queued rename or move may have invalidated the original in-place target.
      // Only a fresh native save-dialog selection is allowed to create a new path.
      if (!chosenNativeTarget) {
        const entry = await explorer.assertAuthorized(targetPath);
        if (entry.type !== 'file') throw new Error('The save destination changed. Use Save As to choose a new file.');
      }
      const saved = await store.save(targetPath, file.content);
      await explorer.authorizeFile(saved.path);
      return saved;
    });
  });

  registerHandler('dv:history', async filePath => {
    if (typeof filePath !== 'string' || !await explorer.assertAuthorized(filePath).then(() => true, () => false)) return [];
    return store.history(filePath);
  });

  registerHandler('dv:confirm-close', async name => {
    awaitingClose = false;
    const result = await dialog.showMessageBox(window, {
      type: 'question', title: 'Unsaved changes', message: `Save changes to ${typeof name === 'string' ? name.slice(0, 250) : 'this document'}?`,
      detail: 'Your changes will be lost if you close without saving.',
      buttons: ['Save', "Don't save", 'Cancel'], defaultId: 0, cancelId: 2, noLink: true,
    });
    return ['save', 'discard', 'cancel'][result.response] || 'cancel';
  });

  ipcMain.on('dv:dirty', (event, value) => { requireSender(event); dirty = value === true; });
  ipcMain.on('dv:approve-close', event => { requireSender(event); allowClose = true; window.close(); });
}

function createWindow() {
  Menu.setApplicationMenu(null);
  window = new BrowserWindow({
    width: 1440, height: 920, minWidth: 560, minHeight: 480,
    title: 'Data Visualizer', backgroundColor: '#191919',
    titleBarStyle: 'hidden', titleBarOverlay: { color: '#191919', symbolColor: '#d7d7d7', height: 40 },
    show: false, icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => { if (url.split('#')[0] !== UI_URL) event.preventDefault(); });
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.session.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.once('ready-to-show', () => window.show());
  window.on('close', event => {
    if (dirty && !allowClose) {
      event.preventDefault();
      if (!awaitingClose) { awaitingClose = true; window.webContents.send('dv:request-close'); }
    }
  });
  window.on('closed', () => { window = null; });
  window.loadFile(UI_PATH);
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  pendingPaths.push(...pathsFromArguments(process.argv));
  app.on('second-instance', (_event, argv) => {
    if (window) { if (window.isMinimized()) window.restore(); window.focus(); }
    receiveFiles(pathsFromArguments(argv)).catch(error => console.error(error));
  });
  app.on('open-file', (event, filePath) => { event.preventDefault(); receiveFiles([filePath]).catch(error => console.error(error)); });
  app.whenReady().then(async () => {
    store = new DocumentStore(app.getPath('userData'));
    await store.initialize();
    explorer = new ExplorerService({ store });
    for (const item of store.recent()) await explorer.authorizeFile(item.path).catch(() => {});
    installHandlers();
    createWindow();
    app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
  }).catch(error => { console.error(error); dialog.showErrorBox('Data Visualizer could not start', error.message); app.quit(); });
  app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
}
