const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { _electron: electron } = require(process.env.DV_PLAYWRIGHT_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
const run = path.join(output, `explorer-drag-${randomUUID()}`);
const workspace = path.join(run, 'Drag Workspace');
const profile = path.join(run, 'profile');
const packaged = process.env.DV_PACKAGED === '1';
const manifest = require('../package.json');
const css = value => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
const normalize = value => value.replaceAll('\\', '/').toLowerCase();
const exists = async value => fs.stat(value).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
let app, page;
const errors = [];

function row(value, kind) {
  return page.locator(`#file-list [data-entry-path="${css(value)}"]${kind ? `[data-entry-kind="${kind}"]` : ''}`).last();
}
async function selectedPaths() {
  return page.locator('#file-list .selected[data-entry-path]').evaluateAll(nodes => [...new Set(nodes.map(node => node.dataset.entryPath.replaceAll('\\', '/').toLowerCase()))].sort());
}
async function assertSelection(paths) {
  assert.deepEqual(await selectedPaths(), paths.map(normalize).sort());
}
async function waitUntil(check, message) {
  const until = Date.now() + 6000;
  while (!await check()) {
    if (Date.now() > until) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}
async function syntheticDrop(paths, destination) {
  const transfer = await page.evaluateHandle(items => {
    const data = new DataTransfer();
    data.setData('application/x-dv-explorer', JSON.stringify({ paths: items }));
    return data;
  }, paths);
  try {
    await row(destination).dispatchEvent('dragover', { dataTransfer: transfer });
    await row(destination).dispatchEvent('drop', { dataTransfer: transfer });
  } finally { await transfer.dispose(); }
}
const textGroup = id => page.locator(`#text-groups .editor-group[data-group-id="${id}"]`);
const groupTab = (id, name) => textGroup(id).locator('.tab').filter({ has: page.locator('.tab-name', { hasText: name }) });
const textGroupIds = () => page.locator('#text-groups .editor-group').evaluateAll(nodes => nodes.map(node => node.dataset.groupId));
async function splitRight(groupId, name) {
  const before = await textGroupIds();
  await groupTab(groupId, name).click({ button: 'right' });
  await page.locator('.tab-context-menu [data-tab-action="split-right"]').click();
  await waitUntil(async () => (await textGroupIds()).length === before.length + 1, 'Split did not create a text group');
  return (await textGroupIds()).find(id => !before.includes(id));
}
async function releaseDelayedOpen() {
  await app.evaluate(() => {
    if (!globalThis.__dvReleaseOpen) throw new Error('No file open is waiting');
    const release = globalThis.__dvReleaseOpen;
    globalThis.__dvReleaseOpen = null;
    release();
  });
}

(async () => {
  const range = path.join(workspace, 'Range');
  const rangeTarget = path.join(workspace, 'Range Target');
  const bundle = path.join(workspace, 'Bundle');
  const target = path.join(workspace, 'Target');
  const guard = path.join(workspace, 'Guard');
  const guardInner = path.join(guard, 'Inner');
  const alpha = path.join(workspace, 'alpha.csv');
  const beta = path.join(workspace, 'beta.csv');
  const child = path.join(bundle, 'child.csv');
  const standalone = path.join(run, 'standalone.csv');
  const visible = path.join(workspace, 'visible.csv');
  const slowSwitch = path.join(workspace, 'slow-switch.csv');
  const slowClose = path.join(workspace, 'slow-close.csv');
  for (const folder of [range, rangeTarget, bundle, target, guardInner]) await fs.mkdir(folder, { recursive: true });
  for (const name of ['a.csv', 'b.csv', 'c.csv']) await fs.writeFile(path.join(range, name), `${name}\nrange fixture\n`);
  await fs.writeFile(alpha, 'name,value\nalpha,1\n');
  await fs.writeFile(beta, 'name,value\nbeta source,2\n');
  await fs.writeFile(child, 'name,value\nbundle child,3\n');
  await fs.writeFile(path.join(target, 'beta.csv'), 'existing destination must remain\n');
  await fs.writeFile(path.join(guardInner, 'keep.csv'), 'guard content\n');
  await fs.writeFile(standalone, 'standalone file must stay outside the workspace\n');
  await fs.writeFile(visible, 'only this visibly selected file should move\n');
  await fs.writeFile(slowSwitch, 'opening stays in the group where the file was dropped\n');
  await fs.writeFile(slowClose, 'a closed destination falls back to a surviving group\n');
  app = await electron.launch({
    executablePath: packaged
      ? path.join(root, manifest.build.directories.output, 'win-unpacked', `${manifest.build.productName}.exe`)
      : path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: packaged ? [`--user-data-dir=${profile}`] : [root],
    env: { ...process.env, DV_USER_DATA_DIR: profile },
    timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('#welcome:not(.hidden)');
  await app.evaluate(({ dialog }, selected) => {
    globalThis.__dvNextOpen = selected;
    globalThis.__dvDialogs = [];
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [globalThis.__dvNextOpen] });
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__dvDialogs.push(options);
      return { response: options.title === 'Unsaved changes' ? 2 : 0 };
    };
  }, workspace);
  await page.locator('#open-folder-button').click();
  await row(workspace, 'root').waitFor();
  assert.equal((await page.locator('.canvas-tag').textContent()).trim(), 'Data Visualizer');

  // A Shift range spans sibling rows; Ctrl toggles an individual item without losing the range.
  const a = path.join(range, 'a.csv'), b = path.join(range, 'b.csv'), c = path.join(range, 'c.csv');
  await row(a, 'file').click();
  await row(c, 'file').click({ modifiers: ['Shift'] });
  await assertSelection([a, b, c]);
  await row(b, 'file').click({ modifiers: ['Control'] });
  await assertSelection([a, c]);
  await row(b, 'file').click({ modifiers: ['Control'] });
  await assertSelection([a, b, c]);
  // Explorer multi-selection keeps its existing editor-drop behavior.
  await row(a, 'file').dragTo(page.locator('#editor-surface'));
  await page.waitForFunction(() => document.querySelectorAll('#text-tabs .tab').length === 3);
  for (const name of ['a.csv', 'b.csv', 'c.csv']) assert.equal(await page.locator('#text-tabs .tab').filter({ hasText: name }).count(), 1);
  await assertSelection([a, b, c]);
  await row(a, 'file').dragTo(row(rangeTarget, 'folder'));
  await row(path.join(rangeTarget, 'c.csv'), 'file').waitFor();
  for (const name of ['a.csv', 'b.csv', 'c.csv']) {
    assert.equal(await exists(path.join(range, name)), false);
    assert.equal(await fs.readFile(path.join(rangeTarget, name), 'utf8'), `${name}\nrange fixture\n`);
  }

  // A dirty open file and a whole folder can move together; selected descendants move once.
  const unsaved = 'name,value\nalpha unsaved buffer,99\n';
  await row(alpha, 'file').click();
  await page.waitForFunction(() => document.querySelector('#editor')?.value === 'name,value\nalpha,1\n' && document.querySelector('#window-title').textContent === 'alpha.csv');
  await page.locator('#editor').fill(unsaved);
  await row(bundle, 'folder').click({ modifiers: ['Control'] });
  await row(child, 'file').click({ modifiers: ['Control'] });
  await assertSelection([alpha, bundle, child]);
  await row(alpha, 'file').dragTo(row(target, 'folder'));
  const movedAlpha = path.join(target, 'alpha.csv');
  const movedBundle = path.join(target, 'Bundle');
  await row(movedAlpha, 'file').waitFor();
  await row(movedBundle, 'folder').waitFor();
  assert.equal(await exists(alpha), false);
  assert.equal(await exists(bundle), false);
  assert.equal(await exists(path.join(target, 'child.csv')), false);
  assert.equal(await fs.readFile(path.join(movedBundle, 'child.csv'), 'utf8'), 'name,value\nbundle child,3\n');
  await row(movedAlpha, 'file').click();
  assert.equal(await page.locator('#editor').inputValue(), unsaved);
  assert.match(await page.locator('#status-message').textContent(), /Unsaved/);
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => document.querySelector('#status-message').textContent === 'Saved locally');
  assert.equal(await fs.readFile(movedAlpha, 'utf8'), unsaved);
  assert.equal(await exists(alpha), false);

  // A same-name destination is retained while the moved source receives a fresh name.
  await row(beta, 'file').click();
  await row(beta, 'file').dragTo(row(target, 'folder'));
  const collisionCopy = path.join(target, 'beta copy.csv');
  await row(collisionCopy, 'file').waitFor();
  assert.equal(await exists(beta), false);
  assert.equal(await fs.readFile(path.join(target, 'beta.csv'), 'utf8'), 'existing destination must remain\n');
  assert.equal(await fs.readFile(collisionCopy, 'utf8'), 'name,value\nbeta source,2\n');

  // Invalid drag payloads cannot move a folder into itself or move a workspace root.
  await syntheticDrop([guard], guardInner);
  await waitUntil(async () => await page.locator('.drop-folder-target').count() === 0, 'Invalid descendant target remained highlighted');
  assert.equal(await fs.readFile(path.join(guardInner, 'keep.csv'), 'utf8'), 'guard content\n');
  assert.equal(await exists(path.join(guardInner, 'Guard')), false);
  await syntheticDrop([workspace], target);
  await waitUntil(async () => await page.locator('.drop-folder-target').count() === 0, 'Invalid root target remained highlighted');
  assert.equal(await exists(workspace), true);
  assert.equal(await exists(path.join(target, 'Drag Workspace')), false);
  // The bridge also rejects forged batches before any valid member is moved.
  const rejection = await page.evaluate(async ({ source, bad, destinationPath }) => {
    try { await window.dv.moveEntries({ paths: [source, bad], destinationPath }); return null; }
    catch (error) { return error.message; }
  }, { source: collisionCopy, bad: workspace, destinationPath: rangeTarget });
  assert.ok(rejection);
  assert.equal(await exists(collisionCopy), true);
  assert.equal(await exists(path.join(rangeTarget, 'beta copy.csv')), false);
  // Closing a standalone document removes its selection before a later additive drag.
  await app.evaluate((_electron, selected) => { globalThis.__dvNextOpen = selected; }, standalone);
  await page.keyboard.press('Control+o');
  await row(standalone, 'file').waitFor();
  await row(standalone, 'file').click();
  await assertSelection([standalone]);
  await page.keyboard.press('Control+w');
  await row(standalone, 'file').waitFor({ state: 'hidden' });
  await row(visible, 'file').click({ modifiers: ['Control'] });
  await assertSelection([visible]);
  await row(visible, 'file').dragTo(row(target, 'folder'));
  const movedVisible = path.join(target, 'visible.csv');
  await row(movedVisible, 'file').waitFor();
  assert.equal(await exists(visible), false);
  assert.equal(await fs.readFile(movedVisible, 'utf8'), 'only this visibly selected file should move\n');
  assert.equal(await fs.readFile(standalone, 'utf8'), 'standalone file must stay outside the workspace\n');
  assert.equal(await exists(path.join(target, 'standalone.csv')), false);

  // Focus is not selection: after toggling the last item off, destructive shortcuts do nothing.
  await row(movedVisible, 'file').click();
  await page.waitForFunction(() => document.querySelector('#window-title').textContent === 'visible.csv');
  await row(movedVisible, 'file').click({ modifiers: ['Control'] });
  await assertSelection([]);
  const dialogsBefore = await app.evaluate(() => globalThis.__dvDialogs.length);
  const clipboardBefore = await page.evaluate(() => window.dv.getFileClipboard());
  for (const shortcut of ['Delete', 'F2', 'Control+x']) {
    await page.keyboard.press(shortcut);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    assert.equal(await page.locator('#dialog[open]').count(), 0, `${shortcut} opened an in-app dialog without a selected file`);
    assert.equal(await app.evaluate(() => globalThis.__dvDialogs.length), dialogsBefore, `${shortcut} opened a native dialog without a selected file`);
    assert.deepEqual(await page.evaluate(() => window.dv.getFileClipboard()), clipboardBefore, `${shortcut} changed the file clipboard without a selected file`);
    assert.equal(await fs.readFile(movedVisible, 'utf8'), 'only this visibly selected file should move\n');
    await assertSelection([]);
  }
  // The focused unselected row remains usable through its context menu and arrow navigation.
  await page.keyboard.press('Shift+F10');
  await page.locator('.explorer-context-menu:not(.hidden)').waitFor();
  await assertSelection([movedVisible]);
  await page.keyboard.press('Escape');
  await row(movedVisible, 'file').click({ modifiers: ['Control'] });
  await assertSelection([]);
  await page.keyboard.press('ArrowUp');
  assert.equal((await selectedPaths()).length, 1);
  assert.equal(await page.evaluate(() => document.activeElement.matches('#file-list .selected[data-entry-path]')), true);

  // A mixed saved/new-document selection cannot silently drop its unsaved member during a move.
  const originalGroup = (await textGroupIds())[0];
  const destinationGroup = await splitRight(originalGroup, 'visible.csv');
  await groupTab(originalGroup, 'visible.csv').click();
  await page.keyboard.press('Control+n');
  const draftName = 'Untitled 1.dv';
  const draftContent = 'new unsaved document stays intact\n';
  await textGroup(originalGroup).locator('textarea:visible').fill(draftContent);
  const draftRow = page.locator('#file-list [data-entry-kind="file"]:not([data-entry-path])').filter({ hasText: draftName });
  await draftRow.click();
  const savedMixed = path.join(guardInner, 'keep.csv');
  await row(savedMixed, 'file').click({ modifiers: ['Control'] });
  assert.equal(await page.locator('#file-list .selected:not([data-entry-path])').count(), 1);
  await assertSelection([savedMixed]);
  await row(savedMixed, 'file').dragTo(row(rangeTarget, 'folder'));
  await page.waitForFunction(() => document.querySelector('#toast').textContent === 'Save new documents before moving them into folders.');
  assert.equal(await fs.readFile(savedMixed, 'utf8'), 'guard content\n');
  assert.equal(await exists(path.join(rangeTarget, 'keep.csv')), false);
  assert.equal(await draftRow.count(), 1);
  assert.equal(await textGroup(originalGroup).locator('textarea:visible').inputValue(), draftContent);
  // The same selection still opens both documents when dropped into an editor group.
  await row(savedMixed, 'file').dragTo(textGroup(destinationGroup).locator('.group-content'));
  await groupTab(destinationGroup, draftName).waitFor();
  await groupTab(destinationGroup, 'keep.csv').waitFor();
  await groupTab(destinationGroup, draftName).click();
  assert.equal(await textGroup(destinationGroup).locator('textarea:visible').inputValue(), draftContent);

  // Hold real file reads at the IPC boundary so a group switch can occur before the open completes.
  await app.evaluate(({ ipcMain }) => {
    const original = ipcMain._invokeHandlers.get('dv:open-paths');
    if (typeof original !== 'function') throw new Error('Expected the original file-open handler');
    globalThis.__dvReleaseOpen = null;
    ipcMain.removeHandler('dv:open-paths');
    ipcMain.handle('dv:open-paths', async (...args) => {
      const documents = await original(...args);
      await new Promise(resolve => { globalThis.__dvReleaseOpen = resolve; });
      return documents;
    });
  });
  await row(slowSwitch, 'file').dragTo(textGroup(destinationGroup).locator('.group-content'));
  await waitUntil(() => app.evaluate(() => typeof globalThis.__dvReleaseOpen === 'function'), 'Delayed file read did not start');
  await groupTab(originalGroup, 'visible.csv').click();
  await releaseDelayedOpen();
  await groupTab(destinationGroup, 'slow-switch.csv').waitFor();
  assert.equal(await groupTab(originalGroup, 'slow-switch.csv').count(), 0, 'Delayed drop followed the current group instead of its original destination');
  assert.equal(await textGroup(destinationGroup).locator('textarea:visible').inputValue(), 'opening stays in the group where the file was dropped\n');

  // If the destination disappears during the read, use the surviving active group without losing data.
  const closingGroup = await splitRight(originalGroup, 'visible.csv');
  await row(slowClose, 'file').dragTo(textGroup(closingGroup).locator('.group-content'));
  await waitUntil(() => app.evaluate(() => typeof globalThis.__dvReleaseOpen === 'function'), 'Second delayed file read did not start');
  await groupTab(closingGroup, 'visible.csv').locator('.tab-close').click();
  await textGroup(closingGroup).waitFor({ state: 'hidden' });
  await groupTab(originalGroup, 'visible.csv').click();
  await releaseDelayedOpen();
  await groupTab(originalGroup, 'slow-close.csv').waitFor();
  assert.equal(await textGroup(originalGroup).locator('textarea:visible').inputValue(), 'a closed destination falls back to a surviving group\n');
  assert.equal(await textGroup(closingGroup).count(), 0);
  assert.equal(await page.locator('#text-groups .tab-name').filter({ hasText: 'slow-close.csv' }).count(), 1);
  assert.deepEqual(errors, []);
  console.log(`Explorer drag checks passed (${packaged ? 'packaged' : 'development'}): Shift range, Ctrl toggle, mixed file/folder batch, parent-child deduplication, dirty-buffer remapping and save, collision preservation, invalid/root drop protection, stale selection cleanup, empty-selection keyboard guards, unsaved mixed-drop protection, and delayed group-drop targeting.`);
  console.log(`Temporary fixtures: ${run}`);
})().catch(async error => {
  console.error(error);
  process.exitCode = 1;
}).finally(async () => {
  if (!app) return;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await app.close().catch(() => {});
});
