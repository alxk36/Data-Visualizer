const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { _electron: electron } = require(process.env.DV_PLAYWRIGHT_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const manifest = require('../package.json');
const packaged = process.env.DV_PACKAGED === '1';
const run = path.join(root, 'test-results', `edge-drag-${randomUUID()}`);
const profile = path.join(run, 'profile');
const workspace = path.join(run, 'Workspace');
let app, page;
const errors = [];
const css = value => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
const group = id => page.locator(`.editor-group[data-group-id="${id}"]`);
const tabs = id => group(id).locator('.tab');
const tab = (id, name) => tabs(id).filter({ has: page.locator('.tab-name', { hasText: name }) });
const editor = id => group(id).locator('textarea:visible');
const ids = pane => page.locator(`#${pane}-groups .editor-group`).evaluateAll(nodes => nodes.map(node => node.dataset.groupId));
const names = id => group(id).locator('.tab-name').allTextContents();
const row = file => page.locator(`#file-list [data-entry-path="${css(file)}"]`).last();

async function waitUntil(check, message) {
  const deadline = Date.now() + 6000;
  while (!await check()) {
    if (Date.now() > deadline) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
async function geometry(id) { return group(id).boundingBox(); }
function near(actual, expected, label, tolerance = 4) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: expected ${expected}, received ${actual}`);
}
async function assertHeaders() {
  for (const pane of ['text', 'visualizer']) {
    const positions = await page.locator(`#${pane}-pane`).evaluate(node => {
      const heading = node.querySelector('.pane-toolbar').getBoundingClientRect();
      return { headingBottom: heading.bottom, tabTops: [...node.querySelectorAll('.group-tab-bar')].map(bar => bar.getBoundingClientRect().top) };
    });
    assert.ok(positions.tabTops.every(top => top >= positions.headingBottom - 1), `${pane} tabs overlap their pane heading`);
  }
}
async function dragWithPreview(source, targetId, direction, { previewDirection = direction, cancel = false, copy = false } = {}) {
  const destination = group(targetId).locator('.group-content');
  await source.scrollIntoViewIfNeeded();
  await destination.scrollIntoViewIfNeeded();
  const sourceBox = await source.boundingBox();
  const targetBox = await destination.boundingBox();
  assert.ok(sourceBox && targetBox);
  const start = { x: sourceBox.x + Math.min(25, sourceBox.width / 3), y: sourceBox.y + sourceBox.height / 2 };
  const end = {
    x: targetBox.x + targetBox.width * (direction === 'left' ? .12 : direction === 'right' ? .88 : .5),
    y: targetBox.y + targetBox.height * (direction === 'up' ? .12 : direction === 'down' ? .88 : .5),
  };
  if (copy) await page.keyboard.down('Control');
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  try {
    await page.mouse.move(start.x + 12, start.y + 2, { steps: 3 });
    await page.mouse.move(end.x, end.y, { steps: 12 });
    await page.mouse.move(end.x + 1, end.y, { steps: 2 });
    const preview = destination.locator(`.group-drop-preview[data-direction="${previewDirection}"]`);
    await preview.waitFor({ state: 'visible' });
    const box = await preview.boundingBox();
    const expected = { ...targetBox };
    if (previewDirection === 'left' || previewDirection === 'right') {
      expected.width /= 2;
      if (previewDirection === 'right') expected.x += expected.width;
    } else if (previewDirection === 'up' || previewDirection === 'down') {
      expected.height /= 2;
      if (previewDirection === 'down') expected.y += expected.height;
    }
    for (const field of ['x', 'y', 'width', 'height']) near(box[field], expected[field], `${direction} preview ${field}`, 8);
    assert.ok(box.y >= targetBox.y - 1, 'Drop preview extends over the tab bar');
    if (cancel) await page.keyboard.press('Escape');
  } finally {
    await page.mouse.up();
    if (copy) await page.keyboard.up('Control');
  }
  await waitUntil(async () => await page.locator('.group-drop-preview:visible').count() === 0, 'Drop preview remained visible after release');
}
async function newDocument(content) {
  await page.locator('#pane-new-button').click();
  await page.locator('#editor').fill(content);
}
async function expectNewGroup(previous, pane = 'text') {
  await waitUntil(async () => (await ids(pane)).length === previous.length + 1, `Expected a new ${pane} split`);
  return (await ids(pane)).find(id => !previous.includes(id));
}

(async () => {
  await fs.mkdir(workspace, { recursive: true });
  const fileOne = path.join(workspace, 'edge-one.csv');
  const fileTwo = path.join(workspace, 'edge-two.csv');
  await fs.writeFile(fileOne, 'name,value\none,1\n');
  await fs.writeFile(fileTwo, 'name,value\ntwo,2\n');
  app = await electron.launch({
    executablePath: packaged
      ? path.join(root, manifest.build.directories.output, 'win-unpacked', `${manifest.build.productName}.exe`)
      : path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'),
    args: packaged ? [`--user-data-dir=${profile}`] : [root],
    env: { ...process.env, DV_USER_DATA_DIR: profile }, timeout: 30000,
  });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('#welcome:not(.hidden)');
  await app.evaluate(({ BrowserWindow, dialog }, selected) => {
    BrowserWindow.getAllWindows()[0].setSize(1440, 920);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [selected] });
    dialog.showMessageBox = async () => ({ response: 2 });
  }, workspace);
  await page.getByRole('button', { name: 'Create new file' }).click();
  await page.locator('#editor').fill('alpha dirty buffer\n11');
  const first = 'Untitled 1.dv', second = 'Untitled 2.dv', third = 'Untitled 3.dv', fourth = 'Untitled 4.dv';
  const initial = (await ids('text'))[0];
  const visual = (await ids('visualizer'))[0];
  await tab(initial, first).click({ button: 'right' });
  await page.locator('.tab-context-menu [data-tab-action="pin"]').click();
  await newDocument('beta dirty buffer\n22');

  // Match the recording: one tab becomes a right split, then the left group's last tab moves below it.
  await dragWithPreview(tab(initial, second), initial, 'left', { cancel: true });
  assert.deepEqual(await ids('text'), [initial]);
  assert.deepEqual(await names(initial), [first, second]);
  await dragWithPreview(tab(initial, second), initial, 'right');
  const right = await expectNewGroup([initial]);
  assert.deepEqual(await names(initial), [first]);
  assert.deepEqual(await names(right), [second]);
  const leftBox = await geometry(initial), rightBox = await geometry(right);
  assert.ok(leftBox.x + leftBox.width < rightBox.x + 1);
  near(leftBox.y, rightBox.y, 'First split row');
  assert.equal(await editor(right).inputValue(), 'beta dirty buffer\n22');
  assert.equal((await ids('visualizer')).length, 1);
  // A sole tab cannot split away from itself and leave a redundant empty group.
  await dragWithPreview(tab(right, second), right, 'right', { previewDirection: 'center' });
  assert.equal((await ids('text')).length, 2);
  await dragWithPreview(tab(initial, first), right, 'down');
  await waitUntil(async () => (await ids('text')).length === 2 && !await group(initial).count(), 'Emptied left source did not collapse');
  const bottom = (await ids('text')).find(id => id !== right);
  const topBox = await geometry(right), bottomBox = await geometry(bottom);
  assert.ok(topBox.y + topBox.height < bottomBox.y + 1);
  near(topBox.x, bottomBox.x, 'Collapsed source alignment');
  near(topBox.width, bottomBox.width, 'Collapsed source width');
  const paneBox = await page.locator('#text-groups').boundingBox();
  near(topBox.width, paneBox.width, 'Top group fills text pane');
  assert.equal(await tab(bottom, first).evaluate(node => node.classList.contains('pinned')), true);
  assert.equal(await tab(bottom, first).locator('.tab-close').textContent(), '•');
  assert.equal(await editor(bottom).inputValue(), 'alpha dirty buffer\n11');

  // Left and up drops nest in the existing lower group without changing the full-width top group.
  await newDocument('gamma dirty buffer\n33');
  const beforeLeft = await ids('text');
  await dragWithPreview(tab(bottom, third), bottom, 'left');
  const bottomLeft = await expectNewGroup(beforeLeft);
  const lowerLeftBox = await geometry(bottomLeft), lowerRightBox = await geometry(bottom);
  assert.ok(lowerLeftBox.x + lowerLeftBox.width < lowerRightBox.x + 1);
  near(lowerLeftBox.y, lowerRightBox.y, 'Nested lower row');
  near((await geometry(right)).width, paneBox.width, 'Top group remains full width');
  await tab(bottom, first).click();
  await newDocument('delta dirty buffer\n44');
  const beforeUp = await ids('text');
  await dragWithPreview(tab(bottom, fourth), bottom, 'up');
  const middleRight = await expectNewGroup(beforeUp);
  const upperNested = await geometry(middleRight), lowerNested = await geometry(bottom);
  assert.ok(upperNested.y + upperNested.height < lowerNested.y + 1);
  near(upperNested.x, lowerNested.x, 'Nested right column');
  near(upperNested.width, lowerNested.width, 'Nested right widths');
  assert.equal(await editor(middleRight).inputValue(), 'delta dirty buffer\n44');
  assert.equal(await editor(bottomLeft).inputValue(), 'gamma dirty buffer\n33');
  assert.deepEqual(await names(visual), [first, second, third, fourth]);
  await assertHeaders();

  // Center drops merge and collapse the emptied source; tab-bar drops remain plain reordering.
  await dragWithPreview(tab(bottomLeft, third), right, 'center');
  await waitUntil(async () => (await ids('text')).length === 3 && !await group(bottomLeft).count(), 'Center drop introduced an unnecessary split');
  assert.deepEqual(await names(right), [second, third]);
  assert.equal(await editor(right).inputValue(), 'gamma dirty buffer\n33');
  await tab(right, third).dragTo(tab(right, second));
  await waitUntil(async () => (await names(right)).join('|') === `${third}|${second}`, 'Tab-bar drop did not reorder');
  assert.equal((await ids('text')).length, 3);
  assert.equal(await page.locator('.group-drop-preview:visible').count(), 0);

  // Visualizer edge drops only split the visualizer; every text group keeps its geometry and edits.
  const textBeforeVisual = await Promise.all((await ids('text')).map(async id => [id, await geometry(id)]));
  await dragWithPreview(tab(visual, fourth), visual, 'right');
  const visualRight = await expectNewGroup([visual], 'visualizer');
  assert.deepEqual(await names(visualRight), [fourth]);
  for (const [id, previous] of textBeforeVisual) {
    const current = await geometry(id);
    for (const field of ['x', 'y', 'width', 'height']) near(current[field], previous[field], `Independent text ${field}`);
  }
  assert.equal(await editor(bottom).inputValue(), 'alpha dirty buffer\n11');
  assert.equal(await editor(middleRight).inputValue(), 'delta dirty buffer\n44');

  // A selected Explorer batch opens together in one new edge group, with no filesystem moves.
  await page.locator('#open-folder-button').click();
  await row(fileOne).waitFor();
  await row(fileOne).click({ modifiers: ['Control'] });
  await row(fileTwo).click({ modifiers: ['Control'] });
  const beforeFiles = await ids('text');
  await dragWithPreview(row(fileOne), right, 'right');
  const filesGroup = await expectNewGroup(beforeFiles);
  assert.deepEqual(await names(filesGroup), ['edge-one.csv', 'edge-two.csv']);
  assert.equal(await editor(filesGroup).inputValue(), 'name,value\ntwo,2\n');
  assert.equal(await fs.readFile(fileOne, 'utf8'), 'name,value\none,1\n');
  assert.equal(await fs.readFile(fileTwo, 'utf8'), 'name,value\ntwo,2\n');
  assert.equal((await ids('visualizer')).length, 2);

  // Ctrl-copy can split a sole tab while retaining its source; its pin follows a later cross-pane move.
  const beforeCopy = await ids('text');
  await dragWithPreview(tab(bottom, first), bottom, 'left', { copy: true });
  const copiedGroup = await expectNewGroup(beforeCopy);
  assert.deepEqual(await names(bottom), [first]);
  assert.deepEqual(await names(copiedGroup), [first]);
  assert.equal(await tab(copiedGroup, first).evaluate(node => node.classList.contains('pinned')), true);
  assert.equal(await editor(copiedGroup).inputValue(), 'alpha dirty buffer\n11');
  assert.equal(await editor(bottom).inputValue(), 'alpha dirty buffer\n11');
  const beforeCrossPane = await ids('visualizer');
  await dragWithPreview(tab(copiedGroup, first), visualRight, 'up');
  const visualPinned = await expectNewGroup(beforeCrossPane, 'visualizer');
  assert.equal((await ids('text')).length, beforeCopy.length);
  assert.equal(await group(copiedGroup).count(), 0);
  assert.deepEqual(await names(visualPinned), [first]);
  assert.equal(await tab(visualPinned, first).evaluate(node => node.classList.contains('pinned')), true);
  assert.equal(await tab(visualPinned, first).locator('.tab-close').textContent(), '•');
  assert.equal(await editor(bottom).inputValue(), 'alpha dirty buffer\n11');
  await assertHeaders();
  assert.deepEqual(errors, []);
  console.log(`Edge drag checks passed (${packaged ? 'packaged' : 'development'}): four half-pane previews, cancel cleanup, recording's right-to-bottom source collapse, nested splits, dirty and pinned tab preservation, center merge, tab-bar reorder, independent pane layouts, Explorer batch edge drop, sole-tab Ctrl-copy, and cross-pane edge move.`);
  console.log(`Temporary fixtures: ${run}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => {
  if (!app) return;
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await app.close().catch(() => {});
});
