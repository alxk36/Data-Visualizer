const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { _electron: electron } = require(process.env.DV_PLAYWRIGHT_PATH || 'playwright');

const root = path.resolve(__dirname, '..');
const output = path.join(root, 'test-results');
const run = path.join(output, `explorer-${randomUUID()}`);
const profile = path.join(run, 'profile');
const workspace = path.join(run, 'Workspace Alpha');
const secondRoot = path.join(run, 'Workspace Beta');
let app, page;
const errors = [];
const css = value => String(value).replaceAll('\\', '\\\\').replaceAll('"', '\\"');
const exists = async value => fs.stat(value).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; });
async function waitUntil(check, message) {
  const until = Date.now() + 6000;
  while (!await check()) {
    if (Date.now() > until) throw new Error(message);
    await new Promise(resolve => setTimeout(resolve, 30));
  }
}
function row(value, kind) {
  return page.locator(`#file-list [data-entry-path="${css(value)}"]${kind ? `[data-entry-kind="${kind}"]` : ''}`).last();
}
const menu = () => page.locator('.explorer-context-menu');
async function context(value, kind, action) {
  await row(value, kind).click({ button: 'right' });
  await menu().waitFor({ state: 'visible' });
  if (action) await menu().locator(`[data-explorer-action="${action}"]`).click();
}
async function nameAction(value, kind, action, name) {
  await context(value, kind, action);
  await page.locator('#entry-name').fill(name);
  await page.locator('#dialog .entry-name-form button[type=submit]').click();
  await page.locator('#dialog[open]').waitFor({ state: 'hidden' });
}
async function closeDialog() {
  await page.locator('#dialog').getByRole('button', { name: 'Close dialog', exact: true }).click();
  await page.locator('#dialog[open]').waitFor({ state: 'hidden' });
}
async function nativeOpen(value) {
  await app.evaluate((_electron, selected) => { globalThis.__dvNextOpen = selected; }, value);
}
async function launch() {
  app = await electron.launch({ executablePath: path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe'), args: [root], env: { ...process.env, DV_USER_DATA_DIR: profile }, timeout: 30000 });
  page = await app.firstWindow();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForSelector('#welcome:not(.hidden)');
  await app.evaluate(({ dialog, shell, clipboard }) => {
    globalThis.__dvNextOpen = null;
    globalThis.__dvDeleteResponse = 0;
    globalThis.__dvDialogs = [];
    globalThis.__dvCopied = [];
    globalThis.__dvRevealed = [];
    dialog.showOpenDialog = async () => ({ canceled: !globalThis.__dvNextOpen, filePaths: globalThis.__dvNextOpen ? [globalThis.__dvNextOpen] : [] });
    dialog.showMessageBox = async (_window, options) => {
      globalThis.__dvDialogs.push(options);
      return { response: options.title === 'Delete permanently' ? globalThis.__dvDeleteResponse : options.title === 'Unsaved changes' ? 2 : 0 };
    };
    clipboard.writeText = value => { globalThis.__dvCopied.push(value); };
    shell.showItemInFolder = value => { globalThis.__dvRevealed.push(value); };
  });
}
async function shutdown() {
  if (!app) return;
  // Every document and profile in this test belongs to this unique fixture directory.
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy())).catch(() => {});
  await app.close().catch(() => {});
  app = null;
}

(async () => {
  await fs.mkdir(path.join(workspace, 'Samples'), { recursive: true });
  await fs.mkdir(secondRoot, { recursive: true });
  await fs.writeFile(path.join(workspace, 'a.csv'), 'name,value\nNorth,10\nSouth,20\n');
  await fs.writeFile(path.join(workspace, 'b.csv'), 'name,value\nNorth,12\nWest,30\n');
  await fs.writeFile(path.join(workspace, 'Samples', 'search.csv'), 'name,value\nneedle,42\n');
  await fs.writeFile(path.join(secondRoot, 'keep.txt'), 'This file remains when its workspace root is removed.');
  await fs.copyFile(path.join(root, 'assets', 'icon.png'), path.join(workspace, 'preview.png'));
  await launch();
  await nativeOpen(workspace);
  await page.locator('#open-folder-button').click();
  await row(workspace, 'root').waitFor();

  await context(workspace, 'root');
  assert.deepEqual(await menu().locator('button > span').allTextContents(), ['New File…', 'New Folder…', 'Reveal in File Explorer', 'Open in Images Preview', 'Add Folder to Workspace…', 'Remove Folder from Workspace', 'Open Timeline', 'Paste', 'Copy Path']);
  await page.screenshot({ path: path.join(output, 'explorer-menu.png') });
  await page.keyboard.press('Escape');
  await context(path.join(workspace, 'Samples'), 'folder');
  assert.deepEqual(await menu().locator('button > span').allTextContents(), ['New File…', 'New Folder…', 'Reveal in File Explorer', 'Find in Folder…', 'Cut', 'Copy', 'Paste', 'Copy Path', 'Copy Relative Path', 'Rename…', 'Delete Permanently']);
  await page.keyboard.press('Escape');
  await context(path.join(workspace, 'a.csv'), 'file');
  assert.deepEqual(await menu().locator('button > span').allTextContents(), ['Reveal in File Explorer', 'Select for Compare', 'Cut', 'Copy', 'Copy Path', 'Copy Relative Path', 'Rename…', 'Delete Permanently']);
  await page.keyboard.press('Escape');

  const created = path.join(workspace, 'Created');
  await nameAction(workspace, 'root', 'new-folder', 'Created');
  assert.equal((await fs.stat(created)).isDirectory(), true);
  await nameAction(created, 'folder', 'new-file', 'fresh.csv');
  const firstVersion = 'sample,value\nneedle,42\n';
  const secondVersion = 'sample,value\nneedle,57\n';
  const unsaved = 'sample,value\nunsaved buffer,99\n';
  await page.locator('#editor').fill(firstVersion);
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => document.querySelector('#status-message').textContent === 'Saved locally');
  await page.locator('#editor').fill(secondVersion);
  await page.keyboard.press('Control+s');
  await page.waitForFunction(() => document.querySelector('#status-message').textContent === 'Saved locally');
  await page.locator('#editor').fill(unsaved);
  const renamed = path.join(created, 'renamed.csv');
  await nameAction(path.join(created, 'fresh.csv'), 'file', 'rename', 'renamed.csv');
  assert.equal(await exists(path.join(created, 'fresh.csv')), false);
  assert.equal(await fs.readFile(renamed, 'utf8'), secondVersion);
  assert.equal(await page.locator('#editor').inputValue(), unsaved);
  assert.match(await page.locator('#status-message').textContent(), /Unsaved/);

  await context(renamed, 'file', 'copy-path');
  await waitUntil(async () => await app.evaluate(() => globalThis.__dvCopied.length) === 1, 'Copy Path did not reach the clipboard');
  assert.equal(await app.evaluate(() => globalThis.__dvCopied.at(-1)), renamed);
  await context(renamed, 'file', 'copy-relative');
  await waitUntil(async () => await app.evaluate(() => globalThis.__dvCopied.length) === 2, 'Copy Relative Path did not reach the clipboard');
  assert.equal(await app.evaluate(() => globalThis.__dvCopied.at(-1)), path.join('Created', 'renamed.csv'));
  await context(renamed, 'file', 'reveal');
  await waitUntil(async () => await app.evaluate(() => globalThis.__dvRevealed.length) === 1, 'Reveal did not reach the native file explorer');
  assert.equal(await app.evaluate(() => globalThis.__dvRevealed[0]), renamed);

  await context(renamed, 'file', 'copy');
  await context(workspace, 'root', 'paste');
  const copied = path.join(workspace, 'renamed.csv');
  await row(copied, 'file').waitFor();
  assert.equal(await fs.readFile(copied, 'utf8'), secondVersion);
  await context(copied, 'file', 'cut');
  await context(created, 'folder', 'paste');
  await row(path.join(created, 'renamed copy.csv'), 'file').waitFor();
  assert.equal(await exists(copied), false);

  await context(created, 'folder', 'copy');
  await context(workspace, 'root', 'paste');
  const folderCopy = path.join(workspace, 'Created copy');
  await row(folderCopy, 'folder').waitFor();
  assert.equal(await fs.readFile(path.join(folderCopy, 'renamed.csv'), 'utf8'), secondVersion);
  await nameAction(folderCopy, 'folder', 'rename', 'Archive');
  const archive = path.join(workspace, 'Archive');
  await context(archive, 'folder', 'delete');
  await waitUntil(async () => await app.evaluate(() => globalThis.__dvDialogs.some(item => item.title === 'Delete permanently')), 'Delete confirmation not shown');
  assert.equal(await exists(archive), true);
  const confirmation = await app.evaluate(() => globalThis.__dvDialogs.find(item => item.title === 'Delete permanently'));
  assert.ok(confirmation.detail.includes(archive));
  assert.match(confirmation.detail, /everything inside/);
  await app.evaluate(() => { globalThis.__dvDeleteResponse = 1; });
  await context(archive, 'folder', 'delete');
  await waitUntil(async () => !await exists(archive), 'Confirmed temporary folder deletion did not complete');
  await row(archive, 'folder').waitFor({ state: 'hidden' });

  await context(path.join(workspace, 'a.csv'), 'file', 'compare');
  await context(path.join(workspace, 'b.csv'), 'file');
  assert.equal(await menu().locator('[data-explorer-action=compare] > span').textContent(), 'Compare with Selected');
  await menu().locator('[data-explorer-action=compare]').click();
  await page.locator('.dv-compare-dialog[open]').waitFor();
  assert.match(await page.locator('.dv-compare-summary').textContent(), /removed.*added/);
  assert.equal(await page.locator('.dv-compare-names').textContent(), 'a.csvb.csv');
  await page.screenshot({ path: path.join(output, 'explorer-compare.png') });
  await closeDialog();

  await context(path.join(workspace, 'Samples'), 'folder', 'find-folder');
  await page.getByRole('textbox', { name: 'Find text in folder' }).fill('needle');
  await page.locator('.dv-folder-search').getByRole('button', { name: 'Find', exact: true }).click();
  await page.locator('.dv-search-result').waitFor();
  assert.equal(await page.locator('.dv-search-result').count(), 1);
  await page.locator('.dv-search-result').click();
  await page.locator('#dialog[open]').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#editor').inputValue(), 'name,value\nneedle,42\n');
  assert.equal(await page.locator('#editor').evaluate(node => node.selectionStart), 'name,value\n'.length);

  await context(workspace, 'root', 'timeline');
  await page.locator('.dv-timeline-dialog[open]').waitFor();
  const revisions = page.locator('.dv-timeline-entry').filter({ hasText: 'renamed.csv' });
  assert.ok(await revisions.count() >= 3);
  await page.screenshot({ path: path.join(output, 'explorer-timeline.png') });
  await revisions.nth(1).getByRole('button', { name: 'Open version' }).click();
  await page.locator('#dialog[open]').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#editor').inputValue(), firstVersion);
  assert.match(await page.locator('#window-title').textContent(), /version/i);
  await row(renamed, 'file').click();
  assert.equal(await page.locator('#editor').inputValue(), unsaved);
  assert.equal(await fs.readFile(renamed, 'utf8'), secondVersion);

  await context(workspace, 'root', 'images');
  await page.locator('.dv-images-dialog[open]').waitFor();
  const thumbnail = page.locator('.dv-image-card img');
  assert.equal(await thumbnail.count(), 1);
  await thumbnail.evaluate(image => image.decode());
  assert.ok(await thumbnail.evaluate(image => image.naturalWidth > 0));
  await page.screenshot({ path: path.join(output, 'explorer-images.png') });
  await page.locator('.dv-image-card').click();
  await page.locator('.dv-image-full').waitFor();
  await page.locator('.dv-image-full').evaluate(image => image.decode());
  assert.equal(await page.locator('.dv-image-full').getAttribute('alt'), 'preview.png');
  await closeDialog();

  await nativeOpen(secondRoot);
  await context(workspace, 'root', 'add-root');
  await row(secondRoot, 'root').waitFor();
  let stored = JSON.parse(await fs.readFile(path.join(profile, 'documents-v1.json'), 'utf8'));
  assert.ok(stored.workspaceRoots.some(value => value.toLowerCase() === secondRoot.toLowerCase()));
  await shutdown();
  await launch();
  await row(secondRoot, 'root').waitFor();
  await context(secondRoot, 'root', 'remove-root');
  await row(secondRoot, 'root').waitFor({ state: 'hidden' });
  assert.equal(await fs.readFile(path.join(secondRoot, 'keep.txt'), 'utf8'), 'This file remains when its workspace root is removed.');
  stored = JSON.parse(await fs.readFile(path.join(profile, 'documents-v1.json'), 'utf8'));
  assert.equal(stored.workspaceRoots.some(value => value.toLowerCase() === secondRoot.toLowerCase()), false);
  assert.deepEqual(errors, []);
  console.log('Explorer UI checks passed: exact menus, create, dirty rename, file and folder clipboard, permanent-delete cancel/confirm, path copy, reveal, compare, search navigation, historical version, native image gallery, and persistent workspace roots.');
  console.log(`Temporary fixtures: ${run}`);
})().catch(async error => {
  console.error(error);
  if (page) await page.screenshot({ path: path.join(output, 'explorer-failure.png') }).catch(() => {});
  process.exitCode = 1;
}).finally(shutdown);
