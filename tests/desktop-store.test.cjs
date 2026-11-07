'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { DocumentStore, decodeDocument, encodeDocument, readFolder, validateText } = require('../electron/document-store.cjs');

async function temporaryStore(t) {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'dv-desktop-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const store = new DocumentStore(path.join(directory, 'state'));
  await store.initialize();
  return { directory, store };
}

test('native documents preserve exact Unicode text through save, reopen and restart', async t => {
  const { directory, store } = await temporaryStore(t);
  const filePath = path.join(directory, 'Measurements.dv');
  const content = 'region,value\n東京,42\n\n"quoted"\t🟢';
  await store.save(filePath, content);
  const file = await store.read(filePath);
  assert.equal(file.content, content);
  assert.equal(JSON.parse(await fs.readFile(filePath, 'utf8')).format, 'data-visualizer');
  const restarted = new DocumentStore(path.join(directory, 'state'));
  await restarted.initialize();
  assert.equal(restarted.recent()[0].path, filePath);
  assert.equal(restarted.history(filePath)[0].content, content);
});

test('saving a source file retains raw text and preserves the prior disk revision', async t => {
  const { directory, store } = await temporaryStore(t);
  const filePath = path.join(directory, 'Data.csv');
  await fs.writeFile(filePath, 'a,b\n1,2');
  await store.save(filePath, 'a,b\n3,4');
  assert.equal(await fs.readFile(filePath, 'utf8'), 'a,b\n3,4');
  assert.deepEqual(store.history(filePath).map(item => item.content), ['a,b\n3,4', 'a,b\n1,2']);
  await store.save(filePath, 'a,b\n3,4');
  assert.equal(store.history(filePath).length, 2);
});

test('failed saves leave original content intact', async t => {
  const { directory, store } = await temporaryStore(t);
  const filePath = path.join(directory, 'Data.txt');
  await fs.writeFile(filePath, 'safe');
  await assert.rejects(store.save(filePath, 'binary\0data'), /binary/);
  assert.equal(await fs.readFile(filePath, 'utf8'), 'safe');
  assert.deepEqual((await fs.readdir(directory)).filter(name => name.endsWith('.tmp')), []);
});

test('unsupported containers and binary input are rejected without replacing data', () => {
  assert.throws(() => decodeDocument('{"content":"hi"}', 'x.dv'), /unsupported/);
  assert.throws(() => decodeDocument('{bad}', 'x.dv'), /not a valid/);
  assert.throws(() => validateText('abc\0def'), /binary/);
  assert.equal(decodeDocument(encodeDocument('', 'empty.dv'), 'empty.dv'), '');
});

test('folder explorer includes supported text files and nested directories only', async t => {
  const { directory } = await temporaryStore(t);
  await fs.mkdir(path.join(directory, 'Nested'));
  await fs.mkdir(path.join(directory, 'node_modules'));
  await fs.writeFile(path.join(directory, 'Nested', 'data.csv'), 'a,b');
  await fs.writeFile(path.join(directory, 'notes.md'), '# Hello');
  await fs.writeFile(path.join(directory, 'ignored.exe'), 'no');
  await fs.writeFile(path.join(directory, '.hidden.txt'), 'no');
  const folder = await readFolder(directory);
  assert.equal(folder.entries.some(item => item.name === 'ignored.exe'), false);
  assert.equal(folder.entries.some(item => item.name === '.hidden.txt'), false);
  assert.equal(folder.entries.some(item => item.name === 'node_modules'), false);
  assert.equal(folder.entries.find(item => item.name === 'Nested').children[0].name, 'data.csv');
});

test('revision history is bounded and returned snapshots cannot mutate the store', async t => {
  const { directory, store } = await temporaryStore(t);
  const filePath = path.join(directory, 'Versions.txt');
  for (let index = 0; index < 25; index++) store.record(filePath, `Revision ${index}`);
  const history = store.history(filePath);
  assert.equal(history.length, 20);
  assert.equal(history[0].content, 'Revision 24');
  history[0].content = 'mutation';
  assert.equal(store.history(filePath)[0].content, 'Revision 24');
});
