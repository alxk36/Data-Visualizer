'use strict';

const { contextBridge, ipcRenderer, webUtils } = require('electron');

const subscribe = (channel, callback) => {
  if (typeof callback !== 'function') throw new TypeError('A callback is required.');
  const listener = (_event, value) => callback(value);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
};

contextBridge.exposeInMainWorld('dv', Object.freeze({
  getInitialState: () => ipcRenderer.invoke('dv:initial'),
  openFiles: () => ipcRenderer.invoke('dv:open-files'),
  openPaths: paths => ipcRenderer.invoke('dv:open-paths', paths),
  openFolder: () => ipcRenderer.invoke('dv:open-folder'),
  addWorkspaceFolder: () => ipcRenderer.invoke('dv:add-workspace-folder'),
  removeWorkspaceFolder: folderPath => ipcRenderer.invoke('dv:remove-workspace-folder', folderPath),
  refreshWorkspace: () => ipcRenderer.invoke('dv:refresh-workspace'),
  createEntry: input => ipcRenderer.invoke('dv:create-entry', input),
  renameEntry: input => ipcRenderer.invoke('dv:rename-entry', input),
  deleteEntry: entryPath => ipcRenderer.invoke('dv:delete-entry', entryPath),
  setFileClipboard: input => ipcRenderer.invoke('dv:set-file-clipboard', input),
  getFileClipboard: () => ipcRenderer.invoke('dv:get-file-clipboard'),
  pasteEntry: parentPath => ipcRenderer.invoke('dv:paste-entry', parentPath),
  moveEntries: input => ipcRenderer.invoke('dv:move-entries', input),
  copyPath: input => ipcRenderer.invoke('dv:copy-path', input),
  findInFolder: input => ipcRenderer.invoke('dv:find-in-folder', input),
  getFolderTimeline: folderPath => ipcRenderer.invoke('dv:folder-timeline', folderPath),
  getFolderImages: folderPath => ipcRenderer.invoke('dv:folder-images', folderPath),
  openImage: imagePath => ipcRenderer.invoke('dv:open-image', imagePath),
  saveFile: file => ipcRenderer.invoke('dv:save-file', file),
  getHistory: filePath => ipcRenderer.invoke('dv:history', filePath),
  confirmClose: name => ipcRenderer.invoke('dv:confirm-close', name),
  setDirty: dirty => ipcRenderer.send('dv:dirty', dirty),
  onFiles: callback => subscribe('dv:files', callback),
  onRequestClose: callback => subscribe('dv:request-close', callback),
  approveClose: () => ipcRenderer.send('dv:approve-close'),
  getPathForFile: file => webUtils.getPathForFile(file),
  showInFolder: filePath => ipcRenderer.invoke('dv:show-in-folder', filePath),
}));
