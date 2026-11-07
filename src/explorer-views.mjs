import { compareLines } from './compare.mjs';

const sessions = new WeakMap();
const IMAGE_DATA = /^data:image\/(?:png|jpeg|jpg|gif|webp|bmp|x-icon|vnd\.microsoft\.icon);base64,/i;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = String(text);
  return node;
}

function button(text, action, className = 'dv-view-button') {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', action);
  return node;
}

function folderName(folder) { return typeof folder === 'string' ? folder : folder?.name || folder?.path || 'Folder'; }

function dialogView(dialog, title, mode) {
  sessions.get(dialog)?.dispose?.();
  if (dialog.open) dialog.close();
  const token = {};
  sessions.set(dialog, token);
  dialog.classList.remove('dv-compare-dialog', 'dv-images-dialog', 'dv-search-dialog', 'dv-timeline-dialog');
  dialog.classList.add('dv-explorer-dialog', `dv-${mode}-dialog`);
  const container = element('div');
  container.id = 'dialog-content';
  const heading = element('div', 'dialog-heading');
  const titleNode = element('h2', '', title);
  titleNode.id = 'dv-view-title';
  const close = button('×', () => dialog.close(), 'icon-button');
  close.setAttribute('aria-label', 'Close dialog');
  heading.append(titleNode, close);
  const body = element('div', 'dialog-body dv-view-body');
  const error = element('div', 'dv-view-error hidden');
  error.setAttribute('role', 'alert');
  container.append(heading, error, body);
  dialog.replaceChildren(container);
  dialog.setAttribute('aria-labelledby', 'dv-view-title');
  const cleanup = () => {
    // A queued close event can arrive after this same dialog has been reopened.
    if (dialog.open) return;
    if (sessions.get(dialog) !== token) return;
    dialog.classList.remove('dv-explorer-dialog', `dv-${mode}-dialog`);
    dialog.removeAttribute('aria-labelledby');
    sessions.delete(dialog);
    token.dispose();
  };
  token.dispose = () => dialog.removeEventListener('close', cleanup);
  dialog.addEventListener('close', cleanup);
  dialog.showModal();
  const current = () => sessions.get(dialog) === token && dialog.open;
  const reportError = problem => {
    if (!current()) return;
    error.textContent = problem?.message || 'This action could not be completed.';
    error.classList.remove('hidden');
  };
  const run = async task => {
    error.classList.add('hidden');
    try { return await task(); } catch (problem) { reportError(problem); return null; }
  };
  return { body, heading, titleNode, current, run, reportError };
}

/** Read-only comparison. The caller decides whether to compare saved or editor content. */
export function openCompare({ dialog, first, second }) {
  const view = dialogView(dialog, 'Compare files', 'compare');
  const comparison = compareLines(first.content, second.content);
  const summary = element('div', 'dv-compare-summary');
  summary.append(element('span', '', comparison.identical ? 'The files are identical.' : comparison.lineEndingsOnly ? 'The text matches; line endings differ.' : `${comparison.removed} removed · ${comparison.added} added`));
  if (!comparison.exact) summary.append(element('small', '', 'Large files: changed sections are aligned by line number.'));
  const names = element('div', 'dv-compare-names');
  for (const file of [first, second]) {
    const label = element('div', '', file.name || file.path || 'Untitled');
    label.title = file.path || file.name || '';
    names.append(label);
  }
  const scroll = element('div', 'dv-compare-scroll');
  scroll.tabIndex = 0;
  scroll.setAttribute('aria-label', 'File differences');
  const table = element('div', 'dv-compare-table');
  table.setAttribute('role', 'table');
  scroll.append(table);
  const pagination = element('div', 'dv-view-pagination');
  let page = 0;
  const pageSize = 500;
  const pageCount = Math.ceil(comparison.rows.length / pageSize);
  const status = element('span');
  status.setAttribute('aria-live', 'polite');
  const previous = button('Previous', () => { page--; renderRows(); });
  const next = button('Next', () => { page++; renderRows(); });
  pagination.append(previous, status, next);
  function renderRows() {
    table.replaceChildren();
    const fragment = document.createDocumentFragment();
    for (const row of comparison.rows.slice(page * pageSize, (page + 1) * pageSize)) {
      const line = element('div', `dv-compare-row dv-diff-${row.kind}`);
      line.setAttribute('role', 'row');
      for (const [side, data] of [['left', row.left], ['right', row.right]]) {
        const cell = element('div', `dv-compare-cell dv-compare-${side}${data ? '' : ' dv-compare-gap'}`);
        cell.setAttribute('role', 'cell');
        const gutter = element('span', 'dv-compare-number', data?.number ?? '');
        gutter.setAttribute('aria-hidden', 'true');
        const text = element('code', '', data?.text ?? '');
        if (data) cell.setAttribute('aria-label', `${side === 'left' ? first.name : second.name}, line ${data.number}, ${row.kind}`);
        cell.append(gutter, text);
        line.append(cell);
      }
      fragment.append(line);
    }
    table.append(fragment);
    status.textContent = `Lines ${page * pageSize + 1}–${Math.min((page + 1) * pageSize, comparison.rows.length)} of ${comparison.rows.length}`;
    previous.disabled = page === 0;
    next.disabled = page + 1 >= pageCount;
    pagination.classList.toggle('hidden', pageCount <= 1);
    scroll.scrollTop = 0;
  }
  view.body.append(summary, names, scroll, pagination);
  renderRows();
  return comparison;
}

/** Folder thumbnail gallery; the onOpenImage callback reads a full local preview. */
export function openImageGallery({ dialog, folder, images, onOpenImage }) {
  const view = dialogView(dialog, 'Images Preview', 'images');
  const items = Array.isArray(images) ? images : [];
  const heading = element('div', 'dv-view-subtitle', folderName(folder));
  const gallery = element('div', 'dv-image-gallery');
  const detail = element('div', 'dv-image-detail hidden');
  let opening = false;
  for (const item of items) {
    const card = button('', async () => {
      if (opening) return;
      opening = true;
      card.disabled = true;
      const image = await view.run(() => onOpenImage(item.path));
      opening = false;
      card.disabled = false;
      if (!view.current() || !image) return;
      if (!IMAGE_DATA.test(image.dataUrl || '')) { view.reportError(new Error('This image could not be previewed.')); return; }
      const back = button('← All images', () => { detail.classList.add('hidden'); gallery.classList.remove('hidden'); heading.classList.remove('hidden'); card.focus(); });
      const imageTitle = element('div', 'dv-image-name', image.name || item.name);
      const picture = element('img', 'dv-image-full');
      picture.src = image.dataUrl;
      picture.alt = image.name || item.name;
      detail.replaceChildren(back, imageTitle, picture);
      gallery.classList.add('hidden'); heading.classList.add('hidden'); detail.classList.remove('hidden');
      back.focus();
    }, 'dv-image-card');
    card.title = item.path || item.name;
    const thumb = element('img');
    if (IMAGE_DATA.test(item.thumbnail || '')) thumb.src = item.thumbnail;
    thumb.alt = item.name;
    thumb.loading = 'lazy';
    card.append(thumb, element('span', '', item.name));
    gallery.append(card);
  }
  if (!items.length) gallery.append(element('p', 'dv-view-empty', 'No supported images were found in this folder.'));
  view.body.append(heading, gallery, detail);
}

/** Search results are plain text; clicking a match delegates navigation to the caller. */
export function openFolderSearch({ dialog, folder, onSearch, onOpenResult }) {
  const view = dialogView(dialog, 'Find in Folder', 'search');
  const subtitle = element('div', 'dv-view-subtitle', folderName(folder));
  const form = element('form', 'dv-folder-search');
  const input = element('input');
  input.placeholder = 'Find text in this folder…';
  input.setAttribute('aria-label', 'Find text in folder');
  input.autocomplete = 'off';
  const submit = element('button', 'dv-view-button', 'Find');
  submit.type = 'submit';
  form.append(input, submit);
  const status = element('div', 'dv-search-status', 'Search the text files in this folder and its subfolders.');
  status.setAttribute('role', 'status');
  const results = element('div', 'dv-search-results');
  let request = 0;
  form.addEventListener('submit', async event => {
    event.preventDefault();
    const query = input.value;
    if (!query.trim()) { input.focus(); return; }
    const currentRequest = ++request;
    submit.disabled = true;
    status.textContent = 'Searching…';
    results.replaceChildren();
    const response = await view.run(() => onSearch(query));
    if (!view.current() || request !== currentRequest) return;
    submit.disabled = false;
    if (!response) { status.textContent = 'Search could not be completed.'; return; }
    const matches = response.matches || [];
    status.textContent = `${matches.length}${response.truncated ? '+' : ''} matches in ${response.scanned ?? 0} files${response.truncated ? ' · Results limited; refine your search.' : ''}`;
    if (!matches.length) results.append(element('p', 'dv-view-empty', 'No matches found.'));
    for (const match of matches) {
      const result = button('', async () => {
        result.disabled = true;
        const success = await view.run(() => onOpenResult(match));
        result.disabled = false;
        if (success !== false && success !== null && view.current()) dialog.close();
      }, 'dv-search-result');
      const label = element('span', 'dv-search-location', `${match.name || match.path} · ${match.line}:${match.column}`);
      const snippet = element('code', '', match.text || '');
      result.title = match.path;
      result.append(label, snippet);
      results.append(result);
    }
  });
  view.body.append(subtitle, form, status, results);
  input.focus();
}

/** Timeline entries are newest first; callbacks may open a historical snapshot. */
export function openTimeline({ dialog, folder, entries, onOpen }) {
  const view = dialogView(dialog, 'Open Timeline', 'timeline');
  const subtitle = element('div', 'dv-view-subtitle', folderName(folder));
  const description = element('p', '', 'Saved versions from documents in this folder.');
  const list = element('div', 'dv-timeline-list');
  const ordered = [...(entries || [])].sort((a, b) => Date.parse(b.timestamp) - Date.parse(a.timestamp));
  for (const entry of ordered) {
    const row = element('div', 'dv-timeline-entry');
    const details = element('div');
    const name = element('strong', '', entry.name || entry.path || 'Document');
    name.title = entry.path || '';
    const stamp = new Date(entry.timestamp);
    const date = element('small', '', Number.isNaN(stamp.getTime()) ? 'Saved version' : stamp.toLocaleString());
    details.append(name, date);
    const open = button('Open version', async () => {
      open.disabled = true;
      const success = await view.run(() => onOpen(entry));
      open.disabled = false;
      if (success !== false && success !== null && view.current()) dialog.close();
    });
    row.append(details, open);
    list.append(row);
  }
  if (!ordered.length) list.append(element('p', 'dv-view-empty', 'No saved versions yet. Save a document in this folder to begin its timeline.'));
  view.body.append(subtitle, description, list);
}
