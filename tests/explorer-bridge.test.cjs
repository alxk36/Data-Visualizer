'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { installExplorerBridge } = require('../electron/explorer-bridge.cjs');
const { DocumentStore, keyFor } = require('../electron/document-store.cjs');

async function setup(t) {
  const base = path.resolve(__dirname, '..', 'test-results');
  const root = path.join(base, `bridge-${randomUUID()}`);
  await fs.mkdir(root, { recursive: true });
  t.after(async () => {
    const resolved = path.resolve(root);
    assert.ok(resolved.startsWith(`${base}${path.sep}`));
    await fs.rm(resolved, { recursive: true, force: true });
  });
  const handlers = new Map();
  const calls = { delete: [], dialogs: [], copied: [], revealed: [] };
  const files = new Map([[root, { path: root, name: path.basename(root), type: 'directory' }]]);
  let response = 0;
  const service = {
    inspectPath: async value => {
      if (files.has(value)) return files.get(value);
      if (!path.relative(root, value).startsWith('..')) {
        const info = await fs.lstat(value);
        if (!info.isSymbolicLink()) return { path: value, name: path.basename(value), type: info.isDirectory() ? 'directory' : 'file' };
      }
      throw new Error('Unauthorized path');
    },
    listRootPaths: async () => [root],
    deleteEntry: async value => { calls.delete.push(value); return { path: value, type: files.get(value)?.type || 'file' }; },
    getRelativePath: async value => path.relative(root, value),
  };
  const store = new DocumentStore(path.join(root, '.state'));
  const image = { isEmpty: () => false, getSize: () => ({ width: 800, height: 600 }), resize: () => image, toDataURL: () => 'data:image/png;base64,cHJldmlldw==' };
  const electron = {
    dialog: { showMessageBox: async (_window, options) => { calls.dialogs.push(options); return { response }; } },
    shell: { showItemInFolder: value => calls.revealed.push(value) },
    clipboard: { writeText: value => calls.copied.push(value) },
    nativeImage: { createFromPath: () => image },
  };
  const bridge = installExplorerBridge({ registerHandler: (channel, fn) => handlers.set(channel, fn), service, store, getWindow: () => ({}), electron });
  return { root, handlers, files, store, service, bridge, calls, respond: value => { response = value; } };
}

test('permanent deletion defaults to cancel, identifies recursive deletion, and protects roots', async t => {
  const fixture = await setup(t);
  const folder = path.join(fixture.root, 'Nested');
  fixture.files.set(folder, { path: folder, name: 'Nested', type: 'directory' });
  assert.equal(await fixture.handlers.get('dv:delete-entry')(folder), null);
  assert.deepEqual(fixture.calls.delete, []);
  assert.equal(fixture.calls.dialogs[0].defaultId, 0);
  assert.match(fixture.calls.dialogs[0].detail, /everything inside/);
  assert.ok(fixture.calls.dialogs[0].detail.includes(folder));
  fixture.respond(1);
  assert.equal((await fixture.handlers.get('dv:delete-entry')(folder)).path, folder);
  assert.deepEqual(fixture.calls.delete, [folder]);
  await assert.rejects(fixture.handlers.get('dv:delete-entry')(fixture.root), /workspace root/);
  assert.equal(fixture.calls.dialogs.length, 2);
});

test('path copying validates the selected item and relative workspace before touching the system clipboard', async t => {
  const fixture = await setup(t);
  const file = path.join(fixture.root, 'Nested', 'data.csv');
  fixture.files.set(file, { path: file, name: 'data.csv', type: 'file' });
  const copy = fixture.handlers.get('dv:copy-path');
  assert.equal(await copy({ path: file, relativeTo: fixture.root }), path.join('Nested', 'data.csv'));
  assert.equal(await copy({ path: file }), file);
  assert.deepEqual(fixture.calls.copied, [path.join('Nested', 'data.csv'), file]);
  await assert.rejects(copy({ path: file, relativeTo: path.dirname(fixture.root) }), /Unauthorized/);
  assert.equal(fixture.calls.copied.length, 2);
});

test('folder timeline includes revisions older than the recent-files list and excludes other roots', async t => {
  const fixture = await setup(t);
  const file = path.join(fixture.root, 'old.csv');
  const outside = path.join(path.dirname(fixture.root), 'outside.csv');
  fixture.store.record(file, 'old saved content');
  fixture.store.record(outside, 'unrelated content');
  fixture.store.state.recent = [];
  const timeline = await fixture.handlers.get('dv:folder-timeline')(fixture.root);
  assert.equal(timeline.length, 1);
  assert.equal(timeline[0].path, file);
  assert.equal(timeline[0].content, 'old saved content');
  assert.equal(fixture.store.state.historyPaths[keyFor(file)], file);
});

test('image gallery previews raster files, skips hidden files and bounds large galleries', async t => {
  const fixture = await setup(t);
  await Promise.all(Array.from({ length: 121 }, (_, i) => fs.writeFile(path.join(fixture.root, `image-${i}.png`), 'test image')));
  await fs.writeFile(path.join(fixture.root, 'unsafe.svg'), '<svg/>');
  await fs.writeFile(path.join(fixture.root, '.hidden.png'), 'test image');
  const gallery = await fixture.handlers.get('dv:folder-images')(fixture.root);
  assert.equal(gallery.images.length, 120);
  assert.equal(gallery.truncated, true);
  assert.ok(gallery.images.every(image => image.thumbnail.startsWith('data:image/png;') && image.name.endsWith('.png') && !image.name.startsWith('.')));
  await assert.rejects(fixture.handlers.get('dv:open-image')(path.join(fixture.root, 'unsafe.svg')), /Supported image previews/);
});

test('drag moves wait for pending saves and preserve partial-result details', async t => {
  const fixture = await setup(t);
  const events = [];
  let releaseSave;
  const saved = new Promise(resolve => { releaseSave = resolve; });
  const pendingSave = fixture.bridge.runMutation(async () => { events.push('save started'); await saved; events.push('save finished'); });
  const input = { paths: [path.join(fixture.root, 'a.csv'), path.join(fixture.root, 'b.csv')], destinationPath: path.join(fixture.root, 'Target') };
  const result = { moved: [{ oldPath: input.paths[0], path: path.join(input.destinationPath, 'a.csv'), name: 'a.csv', type: 'file', mode: 'cut' }], failed: [{ path: input.paths[1], message: 'The file is locked.' }] };
  fixture.service.moveEntries = async received => { assert.deepEqual(received, input); events.push('move started'); return result; };
  const moving = fixture.handlers.get('dv:move-entries')(input);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['save started']);
  releaseSave();
  await pendingSave;
  assert.deepEqual(await moving, result);
  assert.deepEqual(events, ['save started', 'save finished', 'move started']);
});

test('an invalid drag batch rejects without blocking later mutations', async t => {
  const fixture = await setup(t);
  fixture.service.moveEntries = async () => { throw new Error('A folder cannot move inside itself.'); };
  await assert.rejects(fixture.handlers.get('dv:move-entries')({ paths: [fixture.root], destinationPath: fixture.root }), /inside itself/);
  assert.equal(await fixture.bridge.runMutation(async () => 'later save completed'), 'later save completed');
});
