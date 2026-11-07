// The three menus follow the user's O/X selections, in screenshot order.
export const explorerMenus = {
  root: [
    ['new-file','New File…'], ['new-folder','New Folder…'],
    ['reveal','Reveal in File Explorer','Shift+Alt+R'], ['images','Open in Images Preview'],
    null, ['add-root','Add Folder to Workspace…'], ['remove-root','Remove Folder from Workspace'],
    null, ['timeline','Open Timeline'], null, ['paste','Paste','Ctrl+V'], ['copy-path','Copy Path','Shift+Alt+C'],
  ],
  file: [
    ['reveal','Reveal in File Explorer','Shift+Alt+R'], null,
    ['compare','Select for Compare'], null,
    ['cut','Cut','Ctrl+X'], ['copy','Copy','Ctrl+C'],
    ['copy-path','Copy Path','Shift+Alt+C'], ['copy-relative','Copy Relative Path','Ctrl+K Ctrl+Shift+C'],
    null, ['rename','Rename…','F2'], ['delete','Delete Permanently','Del'],
  ],
  folder: [
    ['new-file','New File…'], ['new-folder','New Folder…'],
    ['reveal','Reveal in File Explorer','Shift+Alt+R'], null,
    ['find-folder','Find in Folder…','Shift+Alt+F'], null,
    ['cut','Cut','Ctrl+X'], ['copy','Copy','Ctrl+C'], ['paste','Paste','Ctrl+V'],
    ['copy-path','Copy Path','Shift+Alt+C'], ['copy-relative','Copy Relative Path','Ctrl+K Ctrl+Shift+C'],
    null, ['rename','Rename…','F2'], ['delete','Delete Permanently','Del'],
  ],
};

export const normalizePath = value => String(value || '').replaceAll('\\','/').replace(/\/$/,'').toLowerCase();
export const isWithin = (value, parent) => {const child=normalizePath(value),root=normalizePath(parent);return child===root||child.startsWith(`${root}/`);};

export function remapPath(value, oldPath, newPath) {
  if (!value || !isWithin(value,oldPath)) return value;
  return newPath + value.slice(oldPath.length);
}
