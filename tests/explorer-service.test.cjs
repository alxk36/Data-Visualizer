'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { ExplorerService, isWithin, validName } = require('../electron/explorer-service.cjs');
const { DocumentStore, keyFor } = require('../electron/document-store.cjs');

async function fixture(t) {
  const testRoot = path.resolve(__dirname, '..', 'test-results', 'explorer-tests');
  await fs.mkdir(testRoot, { recursive: true });
  const directory = await fs.mkdtemp(path.join(testRoot, 'case-'));
  const root = path.join(directory, 'workspace');
  await fs.mkdir(root);
  const store = new DocumentStore(path.join(directory, 'state'));
  await store.initialize();
  const service = new ExplorerService({ store });
  await service.addRoot(root);
  t.after(async () => {
    const resolved = path.resolve(directory);
    if (!isWithin(testRoot, resolved) || resolved === testRoot) throw new Error('Invalid test cleanup path.');
    await fs.rm(resolved, { recursive: true, force: true });
  });
  return { directory, root, store, service };
}

test('workspace roots persist, deduplicate, and removal never deletes files', async t => {
  const { directory, root, service, store } = await fixture(t);
  const second = path.join(directory, 'other');
  await fs.mkdir(second);
  await service.addRoot(second);
  await service.addRoot(root);
  assert.equal((await service.listRoots()).length, 2);
  const restartedStore = new DocumentStore(store.directory);
  await restartedStore.initialize();
  const restarted = new ExplorerService({ store: restartedStore });
  assert.deepEqual(await restarted.listRootPaths(), [root, second]);
  assert.equal(await restarted.removeRoot(root), true);
  assert.equal((await fs.stat(root)).isDirectory(), true);
  await assert.rejects(restarted.assertAuthorized(root), /add its folder/);
});

test('new files use valid native containers and names cannot escape their destination', async t => {
  const { root, service } = await fixture(t);
  const created = await service.createEntry({ parentPath: root, name: 'Measurements', type: 'file' });
  assert.equal(created.name, 'Measurements.dv');
  assert.equal(JSON.parse(await fs.readFile(created.path, 'utf8')).content, '');
  await service.createEntry({ parentPath: root, name: 'Nested', type: 'directory' });
  await assert.rejects(service.createEntry({ parentPath: root, name: 'Measurements.dv', type: 'file' }), /already exists/);
  for (const name of ['../outside', '..\\outside', 'CON.txt', 'AUX', 'bad.', 'bad ', 'x:y', 'x/y']) assert.throws(() => validName(name));
  await assert.rejects(service.createEntry({ parentPath: root, name: 'tool.exe', type: 'file' }), /Use .dv/);
});

test('authorization prevents sibling escape and permits exact-file rename without directory access', async t => {
  const { directory, root, service } = await fixture(t);
  const external = path.join(directory, 'external.txt');
  await fs.writeFile(external, 'outside');
  await assert.rejects(service.assertAuthorized(external), /add its folder/);
  await service.authorizeFile(external);
  assert.equal((await service.assertAuthorized(external)).type, 'file');
  await assert.rejects(service.createEntry({ parentPath: directory, name: 'unapproved.txt', type: 'file' }), /add its folder/);
  const renamed = await service.renameEntry({ path: external, name: 'renamed.txt' });
  assert.equal(await fs.readFile(renamed.path, 'utf8'), 'outside');
  await assert.rejects(service.assertAuthorized(external));
  assert.equal(isWithin(root, `${root}-other`), false);
  assert.equal(await service.getRelativePath(renamed.path), 'renamed.txt');
});

test('copy and cut preserve content, choose distinct names, and update history paths', async t => {
  const { root, service, store } = await fixture(t);
  const original = path.join(root, 'data.csv');
  await store.save(original, 'a,b\n1,2');
  await store.save(original, 'a,b\n3,4');
  store.state.historyPaths ||= {};
  store.state.historyPaths[keyFor(original)] = original;
  await service.authorizeFile(original);
  await service.setClipboard({ path: original, mode: 'copy' });
  const firstCopy = await service.pasteInto(root);
  const secondCopy = await service.pasteInto(root);
  assert.equal(firstCopy.name, 'data copy.csv');
  assert.equal(secondCopy.name, 'data copy 2.csv');
  assert.equal(await fs.readFile(original, 'utf8'), 'a,b\n3,4');
  const nested = await service.createEntry({ parentPath: root, name: 'Nested', type: 'directory' });
  await service.setClipboard({ path: original, mode: 'cut' });
  const moved = await service.pasteInto(nested.path);
  assert.equal(moved.oldPath, original);
  await assert.rejects(fs.stat(original), { code: 'ENOENT' });
  assert.equal(await fs.readFile(moved.path, 'utf8'), 'a,b\n3,4');
  assert.equal(service.getClipboard(), null);
  assert.equal(store.recent()[0].path, moved.path);
  assert.equal(store.history(moved.path).length, 2);
  assert.equal(store.history(original).length, 0);
  assert.equal(store.state.historyPaths[keyFor(moved.path)], moved.path);
});

test('nested folder operations remap descendants and refuse moving roots or folders into themselves', async t => {
  const { root, service, store } = await fixture(t);
  const nested = await service.createEntry({ parentPath: root, name: 'Nested', type: 'directory' });
  const child = await service.createEntry({ parentPath: nested.path, name: 'Child', type: 'directory' });
  const file = path.join(child.path, 'data.txt');
  await store.save(file, 'kept');
  await service.authorizeFile(file);
  await service.setClipboard({ path: nested.path, mode: 'copy' });
  await assert.rejects(service.pasteInto(child.path), /inside itself/);
  const copy = await service.pasteInto(root);
  assert.equal(await fs.readFile(path.join(copy.path, 'Child', 'data.txt'), 'utf8'), 'kept');
  const renamed = await service.renameEntry({ path: nested.path, name: 'Renamed' });
  const movedChild = path.join(renamed.path, 'Child', 'data.txt');
  assert.equal(store.recent()[0].path, movedChild);
  assert.equal(store.history(movedChild)[0].content, 'kept');
  assert.equal(await service.getRelativePath(movedChild), path.join('Renamed', 'Child', 'data.txt'));
  await assert.rejects(service.renameEntry({ path: root, name: 'No' }), /Remove this folder/);
  await assert.rejects(service.deleteEntry(root), /Remove this folder/);
  await assert.rejects(service.setClipboard({ path: root, mode: 'cut' }), /Remove this folder/);
});

test('cross-drive cut copies completely before removing its source, and failed copies leave source intact', async t => {
  const { root, service } = await fixture(t);
  const source = await service.createEntry({ parentPath: root, name: 'Source', type: 'directory' });
  const target = await service.createEntry({ parentPath: root, name: 'Target', type: 'directory' });
  await fs.writeFile(path.join(source.path, 'a.txt'), 'first');
  await fs.writeFile(path.join(source.path, 'b.txt'), 'second');
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (from === source.path) throw Object.assign(new Error('different drive'), { code: 'EXDEV' });
    return rename(from, to);
  });
  const copyFile = fs.copyFile;
  const mockedCopy = t.mock.method(fs, 'copyFile', async (from, to, options) => {
    if (path.basename(from) === 'b.txt') throw Object.assign(new Error('copy failed'), { code: 'EIO' });
    return copyFile(from, to, options);
  });
  await service.setClipboard({ path: source.path, mode: 'cut' });
  await assert.rejects(service.pasteInto(target.path), /copy failed/);
  assert.equal(await fs.readFile(path.join(source.path, 'a.txt'), 'utf8'), 'first');
  assert.equal(await fs.readFile(path.join(source.path, 'b.txt'), 'utf8'), 'second');
  assert.deepEqual(await fs.readdir(target.path), []);
  mockedCopy.mock.restore();
  const moved = await service.pasteInto(target.path);
  assert.equal(await fs.readFile(path.join(moved.path, 'a.txt'), 'utf8'), 'first');
  assert.equal(await fs.readFile(path.join(moved.path, 'b.txt'), 'utf8'), 'second');
  await assert.rejects(fs.stat(source.path), { code: 'ENOENT' });
});

test('renaming never replaces an existing file and case-only changes keep history', async t => {
  const { root, service, store } = await fixture(t);
  const first = path.join(root, 'alpha.txt'), second = path.join(root, 'beta.txt');
  await store.save(first, 'first');
  await fs.writeFile(second, 'second');
  await assert.rejects(service.renameEntry({ path: first, name: 'beta.txt' }), /already exists/);
  assert.equal(await fs.readFile(second, 'utf8'), 'second');
  await assert.rejects(service.renameEntry({ path: first, name: 'alpha.dv' }), /Keep the file extension/);
  const renamed = await service.renameEntry({ path: first, name: 'ALPHA.txt' });
  assert.equal((await fs.readdir(root)).includes('ALPHA.txt'), true);
  assert.equal(store.history(renamed.path)[0].content, 'first');
});

test('permanent deletion removes only the selected subtree and its recent/history entries', async t => {
  const { root, service, store } = await fixture(t);
  const nested = await service.createEntry({ parentPath: root, name: 'Remove', type: 'directory' });
  const file = path.join(nested.path, 'delete.txt'), kept = path.join(root, 'keep.txt');
  await store.save(file, 'delete');
  await store.save(kept, 'keep');
  await service.setClipboard({ path: file, mode: 'copy' });
  await service.deleteEntry(nested.path);
  await assert.rejects(fs.stat(nested.path), { code: 'ENOENT' });
  assert.equal(await fs.readFile(kept, 'utf8'), 'keep');
  assert.equal(store.history(file).length, 0);
  assert.equal(store.history(kept).length, 1);
  assert.equal(store.recent().some(item => item.path === file), false);
  assert.equal(service.getClipboard(), null);
});

test('linked directories cannot escape authorization or be copied or deleted recursively', async t => {
  const { directory, root, service } = await fixture(t);
  const outside = path.join(directory, 'outside');
  await fs.mkdir(outside);
  await fs.writeFile(path.join(outside, 'keep.txt'), 'safe');
  const nested = await service.createEntry({ parentPath: root, name: 'Nested', type: 'directory' });
  const link = path.join(nested.path, 'link');
  try { await fs.symlink(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Creating links requires privileges on this host.'); return; } throw error; }
  await assert.rejects(service.assertAuthorized(path.join(link, 'keep.txt')), /Linked/);
  await assert.rejects(service.deleteEntry(nested.path), /linked item/);
  await assert.rejects(service.addRoot(link), /Linked/);
  assert.equal(await fs.readFile(path.join(outside, 'keep.txt'), 'utf8'), 'safe');
});

test('folder search reads native content, reports line/column, and caps matches', async t => {
  const { root, service, store } = await fixture(t);
  await store.save(path.join(root, 'native.dv'), 'First line\nHello HELLO\nlast');
  await fs.writeFile(path.join(root, 'plain.txt'), 'hello\nworld');
  const result = await service.findInFolder({ path: root, query: 'hello' });
  assert.equal(result.matches.length, 3);
  const native = result.matches.filter(item => item.name === 'native.dv');
  assert.deepEqual(native.map(item => [item.line, item.column]), [[2, 1], [2, 7]]);
  const sensitive = await service.findInFolder({ path: root, query: 'HELLO', caseSensitive: true });
  assert.equal(sensitive.matches.length, 1);
  await fs.writeFile(path.join(root, 'large.txt'), 'match\n'.repeat(600));
  const limited = await service.findInFolder({ path: root, query: 'match' });
  assert.equal(limited.matches.length, 500);
  assert.equal(limited.truncated, true);
});

test('batch moves mixed files and folders while deduplicating selected descendants', async t => {
  const { root, service } = await fixture(t);
  const folder = await service.createEntry({ parentPath: root, name: 'Folder', type: 'directory' });
  const child = await service.createEntry({ parentPath: folder.path, name: 'Child', type: 'directory' });
  const target = await service.createEntry({ parentPath: root, name: 'Target', type: 'directory' });
  const nestedFile = path.join(child.path, 'nested.txt');
  const separateFile = path.join(root, 'separate.csv');
  await fs.writeFile(nestedFile, 'nested content');
  await fs.writeFile(separateFile, 'a,b\n1,2');
  const result = await service.moveEntries({ paths: [nestedFile, separateFile, folder.path, child.path, separateFile], destinationPath: target.path });
  assert.equal(result.failed.length, 0);
  assert.equal(result.moved.length, 2);
  assert.deepEqual(new Set(result.moved.map(item => item.oldPath)), new Set([folder.path, separateFile]));
  assert.equal(await fs.readFile(path.join(target.path, 'Folder', 'Child', 'nested.txt'), 'utf8'), 'nested content');
  assert.equal(await fs.readFile(path.join(target.path, 'separate.csv'), 'utf8'), 'a,b\n1,2');
  await assert.rejects(fs.stat(folder.path), { code: 'ENOENT' });
  await assert.rejects(fs.stat(separateFile), { code: 'ENOENT' });
  assert.ok(result.moved.every(item => item.mode === 'cut'));
});

test('batch moves reserve names across collisions and preserve same-parent drops', async t => {
  const { root, service } = await fixture(t);
  const first = await service.createEntry({ parentPath: root, name: 'First', type: 'directory' });
  const second = await service.createEntry({ parentPath: root, name: 'Second', type: 'directory' });
  const target = await service.createEntry({ parentPath: root, name: 'Target', type: 'directory' });
  const a = path.join(first.path, 'same.txt'), b = path.join(second.path, 'same.txt'), kept = path.join(target.path, 'same.txt');
  await fs.writeFile(a, 'first');await fs.writeFile(b, 'second');await fs.writeFile(kept, 'kept');
  await service.setClipboard({ path: kept, mode: 'copy' });
  const result = await service.moveEntries({ paths: [a, b, kept], destinationPath: target.path });
  assert.deepEqual(result.failed, []);
  assert.deepEqual(result.moved.map(item => item.name), ['same copy.txt', 'same copy 2.txt', 'same.txt']);
  assert.equal(result.moved[2].unchanged, true);
  assert.equal(await fs.readFile(kept, 'utf8'), 'kept');
  assert.equal(await fs.readFile(result.moved[0].path, 'utf8'), 'first');
  assert.equal(await fs.readFile(result.moved[1].path, 'utf8'), 'second');
  assert.deepEqual(service.getClipboard(), { path: kept, mode: 'copy', type: 'file' });
});

test('batch preflight rejects invalid selections before moving any valid item', async t => {
  const { directory, root, service } = await fixture(t);
  const validFile = path.join(root, 'valid.txt'), outside = path.join(directory, 'outside.txt');
  await fs.writeFile(validFile, 'keep valid');await fs.writeFile(outside, 'keep outside');
  const target = await service.createEntry({ parentPath: root, name: 'Target', type: 'directory' });
  await assert.rejects(service.moveEntries({ paths: [validFile, outside], destinationPath: target.path }), /add its folder/);
  await assert.rejects(service.moveEntries({ paths: [validFile, root], destinationPath: target.path }), /Remove this folder/);
  await assert.rejects(service.moveEntries({ paths: [validFile, target.path], destinationPath: target.path }), /itself/);
  const child = await service.createEntry({ parentPath: target.path, name: 'Child', type: 'directory' });
  await assert.rejects(service.moveEntries({ paths: [validFile, target.path], destinationPath: child.path }), /subfolders/);
  await assert.rejects(service.moveEntries({ paths: [validFile], destinationPath: directory }), /add its folder/);
  await assert.rejects(service.moveEntries({ paths: [], destinationPath: target.path }), /Choose between/);
  assert.equal(await fs.readFile(validFile, 'utf8'), 'keep valid');
  assert.equal(await fs.readFile(outside, 'utf8'), 'keep outside');
  assert.deepEqual(await fs.readdir(target.path), ['Child']);
});

test('batch folder moves remap document history and clipboard contents without consuming them', async t => {
  const { root, service, store } = await fixture(t);
  const folder = await service.createEntry({ parentPath: root, name: 'Folder', type: 'directory' });
  const target = await service.createEntry({ parentPath: root, name: 'Target', type: 'directory' });
  const file = path.join(folder.path, 'data.txt');
  await store.save(file, 'old');await store.save(file, 'new');
  await service.authorizeFile(file);
  await service.setClipboard({ path: file, mode: 'cut' });
  const result = await service.moveEntries({ paths: [folder.path], destinationPath: target.path });
  assert.deepEqual(result.failed, []);
  const movedFile = path.join(target.path, 'Folder', 'data.txt');
  assert.equal(store.recent()[0].path, movedFile);
  assert.deepEqual(store.history(movedFile).map(item => item.content), ['new', 'old']);
  assert.deepEqual(store.history(file), []);
  assert.equal(store.state.historyPaths[keyFor(movedFile)], movedFile);
  assert.equal((await service.assertAuthorized(movedFile)).path, movedFile);
  assert.deepEqual(service.getClipboard(), { path: movedFile, mode: 'cut', type: 'file' });
});

test('batch runtime failures return completed moves and errors while continuing later items', async t => {
  const { root, service } = await fixture(t);
  const target = await service.createEntry({ parentPath: root, name: 'Target', type: 'directory' });
  const files = ['first.txt', 'locked.txt', 'last.txt'].map(name => path.join(root, name));
  for (const file of files) await fs.writeFile(file, path.basename(file));
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (from === files[1]) throw Object.assign(new Error('The file is locked.'), { code: 'EBUSY' });
    return rename(from, to);
  });
  const result = await service.moveEntries({ paths: files, destinationPath: target.path });
  assert.deepEqual(result.moved.map(item => item.oldPath), [files[0], files[2]]);
  assert.deepEqual(result.failed, [{ path: files[1], message: 'The file is locked.' }]);
  assert.equal(await fs.readFile(files[1], 'utf8'), 'locked.txt');
  assert.equal(await fs.readFile(path.join(target.path, 'first.txt'), 'utf8'), 'first.txt');
  assert.equal(await fs.readFile(path.join(target.path, 'last.txt'), 'utf8'), 'last.txt');
});

test('batch cross-drive moves reuse copy verification and preserve the source on copy failure', async t => {
  const { root, service } = await fixture(t);
  const target = await service.createEntry({ parentPath: root, name: 'Target', type: 'directory' });
  const files = ['good.txt', 'bad.txt'].map(name => path.join(root, name));
  for (const file of files) await fs.writeFile(file, path.basename(file));
  const rename = fs.rename;
  t.mock.method(fs, 'rename', async (from, to) => {
    if (files.includes(from)) throw Object.assign(new Error('different drive'), { code: 'EXDEV' });
    return rename(from, to);
  });
  const copyFile = fs.copyFile;
  t.mock.method(fs, 'copyFile', async (from, to, flags) => {
    if (from === files[1]) throw Object.assign(new Error('Cannot copy the second file.'), { code: 'EIO' });
    return copyFile(from, to, flags);
  });
  const result = await service.moveEntries({ paths: files, destinationPath: target.path });
  assert.equal(result.moved.length, 1);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0].path, files[1]);
  await assert.rejects(fs.stat(files[0]), { code: 'ENOENT' });
  assert.equal(await fs.readFile(path.join(target.path, 'good.txt'), 'utf8'), 'good.txt');
  assert.equal(await fs.readFile(files[1], 'utf8'), 'bad.txt');
  await assert.rejects(fs.stat(path.join(target.path, 'bad.txt')), { code: 'ENOENT' });
});

test('a linked descendant in any selected folder invalidates the entire batch', async t => {
  const { directory, root, service } = await fixture(t);
  const outside = path.join(directory, 'outside');await fs.mkdir(outside);
  const folder = await service.createEntry({ parentPath: root, name: 'Folder', type: 'directory' });
  const target = await service.createEntry({ parentPath: root, name: 'Target', type: 'directory' });
  const validFile = path.join(root, 'keep.txt');await fs.writeFile(validFile, 'safe');
  try { await fs.symlink(outside, path.join(folder.path, 'link'), process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES'].includes(error.code)) { t.skip('Creating links requires privileges on this host.'); return; } throw error; }
  await assert.rejects(service.moveEntries({ paths: [validFile, folder.path], destinationPath: target.path }), /linked item/);
  assert.equal(await fs.readFile(validFile, 'utf8'), 'safe');
  assert.deepEqual(await fs.readdir(target.path), []);
});
