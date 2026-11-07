/** Document and pane state; independent of the desktop bridge and the DOM. */
import {createLayouts,flattenGroups,findGroup,closeGroupTabs} from './groups.mjs';
let nextId = 0;

const paneFields = {
  text: { tabs: 'textTabs', active: 'activeTextId' },
  visualizer: { tabs: 'visualizerTabs', active: 'activeVisualizerId' },
};

function fieldsFor(pane) {
  return paneFields[pane] ?? null;
}

function pathKey(path) {
  if (typeof path !== 'string' || !path) return null;
  const normalized = path.replaceAll('\\', '/').replace(/\/+$/, '');
  return /^[a-z]:\//i.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized;
}

function makeId() {
  return globalThis.crypto?.randomUUID?.() ?? `document-${Date.now()}-${++nextId}`;
}

function findDocument(state, id) {
  return state.documents.find((document) => document.id === id) ?? null;
}

function restoreActive(state, pane, removedIndex = 0) {
  const fields = fieldsFor(pane);
  const tabs = state[fields.tabs];
  if (!tabs.includes(state[fields.active])) {
    state[fields.active] = tabs[Math.min(removedIndex, tabs.length - 1)] ?? null;
  }
}

export function createDocument({ id, name, path = null, content = '' } = {}) {
  const text = String(content ?? '');
  return {
    id: id || makeId(),
    name: name || (path ? path.split(/[\\/]/).pop() : 'Untitled.dv'),
    path: path || null,
    content: text,
    savedContent: text,
    dirty: false,
  };
}

export function createWorkspace() {
  const layouts=createLayouts();
  const state={
    documents: [],
    layouts,
    activeGroups:{text:layouts.text.id,visualizer:layouts.visualizer.id},
    layout: 'split',
    focusMode: false,
    explorerOpen: true,
    splitRatio: 0.5,
  };
  for(const [pane,fields] of Object.entries(paneFields)){
    Object.defineProperty(state,fields.tabs,{enumerable:true,get(){return activeGroup(state,pane).tabs;},set(value){activeGroup(state,pane).tabs=value;}});
    Object.defineProperty(state,fields.active,{enumerable:true,get(){return activeGroup(state,pane).activeId;},set(value){activeGroup(state,pane).activeId=value;}});
  }
  return state;
}

export function activeGroup(state,pane='text'){
  const group=findGroup(state.layouts[pane],state.activeGroups[pane])||flattenGroups(state.layouts[pane])[0];
  state.activeGroups[pane]=group.id;
  return group;
}

/** Reopening a file preserves unsaved text and restores its tabs in both panes. */
export function openDocument(state, input = {}) {
  const key = pathKey(input.path);
  let document = (key && state.documents.find((entry) => pathKey(entry.path) === key))
    || (input.id && findDocument(state, input.id));
  if (!document) {
    document = createDocument(input);
    state.documents.push(document);
  }
  for (const pane of Object.keys(paneFields)) {
    const fields = paneFields[pane];
    if (!state[fields.tabs].includes(document.id)) state[fields.tabs].push(document.id);
    state[fields.active] = document.id;
  }
  return document;
}

export function updateContent(state, id, content) {
  const document = findDocument(state, id);
  if (!document) return null;
  document.content = String(content ?? '');
  document.dirty = document.content !== document.savedContent;
  return document;
}

/** The caller is responsible for confirming the loss of unsaved edits. */
export function closeDocument(state, id) {
  if (!findDocument(state, id)) return false;
  state.documents = state.documents.filter((document) => document.id !== id);
  for (const pane of Object.keys(paneFields)) {
    for(const group of flattenGroups(state.layouts[pane]))state.layouts[pane]=closeGroupTabs(state.layouts[pane],group.id,[id]);
    activeGroup(state,pane);
  }
  return true;
}

/** Move a tab before targetId, or to the end when targetId is omitted. */
export function reorderTab(state, pane, id, targetId = null) {
  const fields = fieldsFor(pane);
  if (!fields || !state[fields.tabs].includes(id)) return false;
  if (id === targetId) return true;
  if (targetId != null && !state[fields.tabs].includes(targetId)) return false;
  const tabs = state[fields.tabs].filter((tabId) => tabId !== id);
  const targetIndex = targetId == null ? tabs.length : tabs.indexOf(targetId);
  tabs.splice(targetIndex, 0, id);
  state[fields.tabs] = tabs;
  return true;
}

/** Move between panes without removing the document from the explorer. */
export function moveTab(state, id, fromPane, toPane, targetId = null) {
  const from = fieldsFor(fromPane);
  const to = fieldsFor(toPane);
  if (!from || !to || !findDocument(state, id) || !state[from.tabs].includes(id)) return false;
  if (fromPane === toPane) return reorderTab(state, fromPane, id, targetId);
  if (targetId != null && targetId !== id && !state[to.tabs].includes(targetId)) return false;
  const removedIndex = state[from.tabs].indexOf(id);
  const targetTabs = state[to.tabs].filter((tabId) => tabId !== id);
  const targetIndex = targetId == null || targetId === id
    ? targetTabs.length
    : targetTabs.indexOf(targetId);
  targetTabs.splice(targetIndex, 0, id);
  state[to.tabs] = targetTabs;
  state[from.tabs] = state[from.tabs].filter((tabId) => tabId !== id);
  state[to.active] = id;
  restoreActive(state, fromPane, removedIndex);
  return true;
}

export function setLayout(state, layout) {
  if (!['split', 'text', 'visualizer'].includes(layout)) return false;
  state.layout = layout;
  return true;
}

export function markSaved(state, id, { path, name, content } = {}) {
  const document = findDocument(state, id);
  if (!document) return null;
  if (path !== undefined) document.path = path || null;
  if (name) document.name = name;
  else if (path) document.name = path.split(/[\\/]/).pop();
  document.savedContent = typeof content === 'string' ? content : document.content;
  document.dirty = document.content !== document.savedContent;
  return document;
}

export function activeDocument(state, pane = 'text') {
  const fields = fieldsFor(pane);
  return fields ? findDocument(state, state[fields.active]) : null;
}

/** A final newline creates a real blank line, and an empty editor has line 1. */
export function lineCount(content) {
  return String(content ?? '').split(/\r\n|\n|\r/).length;
}

/** Preferences intentionally exclude document text, paths, and dirty state. */
export function serializePreferences(state) {
  return {
    layout: ['split', 'text', 'visualizer'].includes(state.layout) ? state.layout : 'split',
    focusMode: Boolean(state.focusMode),
    explorerOpen: Boolean(state.explorerOpen),
    splitRatio: Number.isFinite(state.splitRatio)
      ? Math.min(0.8, Math.max(0.2, state.splitRatio))
      : 0.5,
  };
}
