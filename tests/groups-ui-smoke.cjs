const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { _electron: electron } = require(process.env.DV_PLAYWRIGHT_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
const run = path.join(output, `groups-${Date.now()}`);
let app;
const failures = [];

async function launch(label) {
  app = await electron.launch({
    executablePath: path.join(root, 'node_modules/electron/dist/electron.exe'),
    args: [root], env: { ...process.env, DV_USER_DATA_DIR: path.join(run, label) }, timeout: 30000,
  });
  const page = await app.firstWindow();
  page.on('pageerror', error => failures.push(error.message));
  page.on('console', message => { if (message.type() === 'error') failures.push(message.text()); });
  await page.waitForSelector('#welcome:not(.hidden)');
  return page;
}

async function stop() {
  if (!app) return;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(win => win.destroy())).catch(() => {});
  await app.close().catch(() => {});
  app = null;
}

const group = (page, id) => page.locator(`.editor-group[data-group-id="${id}"]`);
const tab = (page, groupId, name) => group(page, groupId).locator('.tab').filter({ has: page.locator('.tab-name', { hasText: name }) });
const editor = (page, groupId) => group(page, groupId).locator('textarea:visible');
const textGroups = page => page.locator('#text-groups .editor-group');
const visualGroups = page => page.locator('#visualizer-groups .editor-group');

async function context(page, tabLocator, action, subAction) {
  await tabLocator.click({ button: 'right' });
  await page.locator(`.tab-context-menu [data-tab-action="${action}"]`).click();
  if (subAction) await page.locator(`.tab-split-menu [data-tab-action="${subAction}"]`).click();
}

async function textIds(page) { return textGroups(page).evaluateAll(nodes => nodes.map(node => node.dataset.groupId)); }
async function names(page, id) { return group(page, id).locator('.tab-name').allTextContents(); }
async function activateTab(page, id, name) { await tab(page, id, name).click(); }

(async () => {
  await fs.mkdir(run, { recursive: true });
  let page = await launch('nested-profile');
  await page.getByRole('button', { name: 'Create new file' }).click();
  await page.locator('#editor').fill('alpha\n11');
  await page.keyboard.press('Control+n');
  await page.locator('#editor').fill('beta\n22');
  await page.keyboard.press('Control+n');
  await page.locator('#editor').fill('gamma\n33');
  const initialId = (await textIds(page))[0];
  const visualId = await visualGroups(page).first().getAttribute('data-group-id');
  const first = 'Untitled 1.dv', second = 'Untitled 2.dv', third = 'Untitled 3.dv';

  await tab(page, initialId, third).click({ button: 'right' });
  const labels = await page.locator('.tab-context-menu .menu-item > span').allTextContents();
  assert.deepEqual(labels, ['Close', 'Close Others', 'Close to the Right', 'Close Saved', 'Close All', 'Copy Path', 'Copy Relative Path', 'Reveal in File Explorer', 'Reveal in Explorer View', 'Pin', 'Split Right', 'Split & Move']);
  await page.keyboard.press('Escape');

  // Per-document editors retain their selection and undo history when tabs switch.
  await activateTab(page, initialId, first);
  await editor(page, initialId).evaluate(node => { node.focus(); node.setSelectionRange(2, 2); node.dispatchEvent(new Event('select')); });
  await activateTab(page, initialId, second);
  await activateTab(page, initialId, first);
  assert.equal(await editor(page, initialId).evaluate(node => node.selectionStart), 2);
  await page.keyboard.insertText('X');
  assert.equal(await editor(page, initialId).inputValue(), 'alXpha\n11');
  await activateTab(page, initialId, second);
  await activateTab(page, initialId, first);
  await page.keyboard.press('Control+z');
  assert.equal(await editor(page, initialId).inputValue(), 'alpha\n11');

  // First verify the duplicate-tab split command independently.
  await context(page, tab(page, initialId, third), 'split-right');
  await page.waitForFunction(() => document.querySelectorAll('#text-groups .editor-group').length === 2);
  const duplicate = (await textIds(page)).find(id => id !== initialId);
  assert.deepEqual(await names(page, duplicate), [third]);
  assert.equal(await visualGroups(page).count(), 1);
  await context(page, tab(page, duplicate, third), 'close');
  await page.waitForFunction(() => document.querySelectorAll('#text-groups .editor-group').length === 1);

  // Build top / bottom-left + bottom-right entirely inside the text pane.
  await context(page, tab(page, initialId, third), 'split-move', 'split-down');
  const bottomLeftId = (await textIds(page)).find(id => id !== initialId);
  await context(page, tab(page, bottomLeftId, third), 'split-move', 'split-right-move');
  const bottomRightId = (await textIds(page)).find(id => id !== initialId && id !== bottomLeftId);
  assert.equal(await textGroups(page).count(), 3);
  await tab(page, initialId, second).dragTo(group(page, bottomLeftId).locator('.group-content'));
  await page.waitForFunction(({ id, name }) => [...document.querySelectorAll(`.editor-group[data-group-id="${id}"] .tab-name`)].some(node => node.textContent === name), { id: bottomLeftId, name: second });
  assert.equal(await editor(page, initialId).inputValue(), 'alpha\n11');
  assert.equal(await editor(page, bottomLeftId).inputValue(), 'beta\n22');
  assert.equal(await editor(page, bottomRightId).inputValue(), 'gamma\n33');
  const geometry = await page.evaluate(({ top, left, right }) => {
    const rect = id => { const r = document.querySelector(`.editor-group[data-group-id="${id}"]`).getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
    const heading = document.querySelector('#text-pane-label').getBoundingClientRect();
    return { top: rect(top), left: rect(left), right: rect(right), headingBottom: heading.bottom, allTabTops: [...document.querySelectorAll('#text-groups .tab-bar')].map(node => node.getBoundingClientRect().top) };
  }, { top: initialId, left: bottomLeftId, right: bottomRightId });
  assert.ok(geometry.top.y < geometry.left.y);
  assert.ok(geometry.left.x < geometry.right.x);
  assert.ok(Math.abs(geometry.left.y - geometry.right.y) < 2);
  assert.ok(geometry.top.width > geometry.left.width * 1.8);
  assert.ok(geometry.allTabTops.every(y => y >= geometry.headingBottom));
  assert.equal(await visualGroups(page).count(), 1);
  assert.deepEqual(await names(page, visualId), [first, second, third]);
  await page.screenshot({ path: path.join(output, 'nested-groups.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(560, 480));
  await page.waitForFunction(() => innerWidth <= 560);
  assert.equal(await textGroups(page).count(), 3);
  assert.equal(await page.evaluate(() => document.body.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(output, 'nested-groups-minimum.png') });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1440, 920));

  // Visualizer groups can split without restructuring any of the text groups.
  await context(page, tab(page, visualId, third), 'split-right');
  assert.equal(await visualGroups(page).count(), 2);
  assert.equal(await textGroups(page).count(), 3);
  const visualDuplicate = await visualGroups(page).evaluateAll(nodes => nodes.find(node => node.dataset.groupId !== document.querySelector('#visualizer-groups .editor-group').dataset.groupId).dataset.groupId);
  await context(page, tab(page, visualDuplicate, third), 'close');
  assert.equal(await visualGroups(page).count(), 1);

  // Keyboard tab commands act on the visible pane, even if the other pane had focus.
  await activateTab(page, initialId, first);
  await page.locator('#layout-button').click();
  await page.getByRole('menuitem', { name: 'Visualizer only view', exact: true }).click();
  await page.keyboard.press('Control+\\');
  assert.equal(await visualGroups(page).count(), 2);
  assert.equal(await textGroups(page).count(), 3);
  await page.keyboard.press('Control+F4');
  assert.equal(await visualGroups(page).count(), 1);
  await page.locator('#layout-button').click();
  await page.getByRole('menuitem', { name: 'Text only view', exact: true }).click();
  await page.keyboard.press('Control+\\');
  assert.equal(await textGroups(page).count(), 4);
  assert.equal(await visualGroups(page).count(), 1);
  await page.keyboard.press('Control+F4');
  assert.equal(await textGroups(page).count(), 3);
  await page.locator('#layout-button').click();
  await page.getByRole('menuitem', { name: 'Split view', exact: true }).click();
  await page.locator('#home-button').click();
  await page.keyboard.press('Control+\\');
  await page.keyboard.press('Control+F4');
  assert.equal(await textGroups(page).count(), 3);
  assert.equal(await visualGroups(page).count(), 1);
  await page.locator('#file-list [data-doc]').filter({ hasText: first }).click();

  // Shared-document edits synchronize across two views without affecting other documents.
  await context(page, tab(page, bottomRightId, third), 'split-right');
  const sharedId = (await textIds(page)).find(id => ![initialId, bottomLeftId, bottomRightId].includes(id));
  // Selecting and replacing while focusing a different group must not restore stale selection.
  await editor(page, bottomRightId).fill('gamma focus regression\n44');
  assert.equal(await editor(page, bottomRightId).inputValue(), 'gamma focus regression\n44');
  assert.equal(await editor(page, sharedId).inputValue(), 'gamma focus regression\n44');
  await editor(page, bottomRightId).click();
  await page.keyboard.press('Control+a');
  await page.keyboard.insertText('gamma shared\n44');
  assert.equal(await editor(page, sharedId).inputValue(), 'gamma shared\n44');
  assert.equal(await editor(page, bottomLeftId).inputValue(), 'beta\n22');
  await editor(page, bottomRightId).press('Control+End');
  await page.keyboard.insertText('!');
  assert.equal(await editor(page, sharedId).inputValue(), 'gamma shared\n44!');
  await page.keyboard.press('Control+z');
  assert.equal(await editor(page, bottomRightId).inputValue(), 'gamma shared\n44');
  assert.equal(await editor(page, sharedId).inputValue(), 'gamma shared\n44');
  await context(page, tab(page, sharedId, third), 'close');
  assert.equal(await textGroups(page).count(), 3);

  // Moving Above uses the nested geometry and collapses only the emptied leaf.
  await context(page, tab(page, bottomRightId, third), 'split-move', 'move-up');
  assert.equal(await textGroups(page).count(), 2);
  assert.deepEqual(await names(page, initialId), [first, third]);
  assert.equal(await editor(page, initialId).inputValue(), 'gamma shared\n44');
  assert.equal(await editor(page, bottomLeftId).inputValue(), 'beta\n22');

  // Close the visualizer reference, then cancel closing the dirty final text reference.
  await context(page, tab(page, visualId, third), 'close');
  await app.evaluate(({ dialog }) => { globalThis.groupClosePrompts = 0; dialog.showMessageBox = async () => { globalThis.groupClosePrompts++; return { response: 2 }; }; });
  await context(page, tab(page, initialId, third), 'close');
  await page.waitForFunction(() => [...document.querySelectorAll('#text-groups textarea')].some(node => node.value === 'gamma shared\n44'));
  assert.equal(await app.evaluate(() => globalThis.groupClosePrompts), 1);
  assert.equal(await tab(page, initialId, third).count(), 1);
  assert.equal(await editor(page, initialId).inputValue(), 'gamma shared\n44');
  await stop();

  // Pin protects the tab from each bulk-close operation.
  page = await launch('pins-profile');
  const fixtures = ['Pinned.csv', 'Dirty.csv', 'Saved.csv'].map(name => path.join(run, name));
  for (const file of fixtures) await fs.writeFile(file, `name,value\n${path.basename(file)},1\n`);
  await app.evaluate(({ dialog }, filePaths) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths }); }, fixtures);
  await page.getByRole('button', { name: 'Open a file' }).click();
  await page.waitForFunction(() => document.querySelectorAll('#text-groups .tab').length === 3);
  const pinGroup = (await textIds(page))[0];
  await context(page, tab(page, pinGroup, 'Pinned.csv'), 'pin');
  assert.equal(await tab(page, pinGroup, 'Pinned.csv').getAttribute('class').then(value => value.includes('pinned')), true);
  await activateTab(page, pinGroup, 'Dirty.csv');
  await editor(page, pinGroup).fill('This document has unsaved edits.');
  for (const action of ['close-others', 'close-right', 'close-saved', 'close-all']) {
    if (action !== 'close-others') {
      await page.keyboard.press('Control+o');
      await page.waitForFunction(() => document.querySelectorAll('#text-groups .tab').length === 3);
    }
    await context(page, tab(page, pinGroup, 'Dirty.csv'), action);
    await page.waitForFunction(() => document.querySelectorAll('#text-groups .tab').length <= 2);
    assert.equal(await tab(page, pinGroup, 'Pinned.csv').count(), 1, `${action} must preserve pinned tab`);
    if (action === 'close-all') assert.deepEqual(await names(page, pinGroup), ['Pinned.csv']);
    else assert.deepEqual(await names(page, pinGroup), ['Pinned.csv', 'Dirty.csv']);
  }
  // A pin follows a tab when it moves between the two outer panes too.
  const destination=page.locator('#visualizer-groups .tab').filter({hasText:'Pinned.csv'}).first();
  await tab(page,pinGroup,'Pinned.csv').dragTo(destination);
  assert.equal(await page.locator('#visualizer-groups .tab.pinned').filter({hasText:'Pinned.csv'}).count(),1);
  assert.equal(await tab(page,pinGroup,'Pinned.csv').count(),0);
  assert.deepEqual(failures, []);
  console.log('Groups UI checks passed: exact context menu, nested split/move geometry, independent panes, shared edits, undo/cursor retention, drag between groups, directional move, pinned bulk closes, and canceled dirty final close.');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(stop);
