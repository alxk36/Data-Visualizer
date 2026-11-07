/** Binary pane layouts. Leaves reference shared documents by ID, never copy their text. */
let serial = 0;
const DIRECTIONS = new Set(['left', 'right', 'up', 'down']);
const EPSILON = 1e-9;

function makeId(prefix) {
  return `${prefix}-${globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${++serial}`}`;
}

export function createGroup(tabs = [], activeId = null) {
  const ids = [...new Set(tabs.filter(id => typeof id === 'string' && id.length))];
  return { type: 'group', id: makeId('group'), tabs: ids, activeId: ids.includes(activeId) ? activeId : ids[0] ?? null, pinned: [] };
}

export function createLayouts() {
  return { text: createGroup(), visualizer: createGroup() };
}

export function flattenGroups(root) {
  const groups = [];
  const visited = new Set();
  function walk(node) {
    if (!node || visited.has(node)) return;
    visited.add(node);
    if (node.type === 'group') groups.push(node);
    else if (node.type === 'split') { walk(node.first); walk(node.second); }
  }
  walk(root);
  return groups;
}

export function findGroup(root, id) {
  return flattenGroups(root).find(group => group.id === id) ?? null;
}

function cloneGroup(group) {
  return { ...group, tabs: [...group.tabs], pinned: [...(group.pinned || [])] };
}

function restoreActive(group, removedIndex = 0) {
  if (!group.tabs.includes(group.activeId)) group.activeId = group.tabs[Math.min(removedIndex, group.tabs.length - 1)] ?? null;
}

function pinnedSet(group) {
  return new Set((group.pinned || []).filter(id => group.tabs.includes(id)));
}

function normalizePinned(group) {
  const pins = pinnedSet(group);
  group.tabs = [...group.tabs.filter(id => pins.has(id)), ...group.tabs.filter(id => !pins.has(id))];
  group.pinned = group.tabs.filter(id => pins.has(id));
}

function replaceGroup(root, id, replacement) {
  if (!root) return root;
  if (root.type === 'group') return root.id === id ? replacement : root;
  if (root.type !== 'split') return root;
  const first = replaceGroup(root.first, id, replacement);
  const second = replaceGroup(root.second, id, replacement);
  if (first === root.first && second === root.second) return root;
  return { ...root, first, second };
}

/** Pinned tabs stay at the start; tab reorders are constrained to their pin section. */
export function reorderGroupTab(group, id, beforeId = null) {
  if (!group || group.type !== 'group' || !group.tabs.includes(id)) return false;
  if (beforeId != null && !group.tabs.includes(beforeId)) return false;
  if (id === beforeId) return true;
  normalizePinned(group);
  const pins = pinnedSet(group);
  const tabs = group.tabs.filter(tabId => tabId !== id);
  const boundary = tabs.filter(tabId => pins.has(tabId)).length;
  let index = beforeId == null ? tabs.length : tabs.indexOf(beforeId);
  index = pins.has(id) ? Math.min(index, boundary) : Math.max(index, boundary);
  tabs.splice(index, 0, id);
  group.tabs = tabs;
  group.pinned = tabs.filter(tabId => pins.has(tabId));
  return true;
}

export function pinTab(group, id, pinned = true) {
  if (!group || group.type !== 'group' || !group.tabs.includes(id)) return false;
  normalizePinned(group);
  const pins = pinnedSet(group);
  if (pins.has(id) === Boolean(pinned)) return true;
  const tabs = group.tabs.filter(tabId => tabId !== id);
  if (pinned) pins.add(id); else pins.delete(id);
  const boundary = tabs.filter(tabId => pins.has(tabId)).length;
  tabs.splice(boundary, 0, id);
  group.tabs = tabs;
  group.pinned = tabs.filter(tabId => pins.has(tabId));
  return true;
}

/** Copy or move one tab into a new leaf beside the selected group. */
export function splitGroup(root, groupId, docId, direction, { move = false } = {}) {
  const original = findGroup(root, groupId);
  if (!original || !DIRECTIONS.has(direction) || !original.tabs.includes(docId)) return null;
  const source = cloneGroup(original);
  const target = createGroup([docId], docId);
  if (source.pinned.includes(docId)) target.pinned = [docId];
  if (move) {
    const removedIndex = source.tabs.indexOf(docId);
    source.tabs = source.tabs.filter(id => id !== docId);
    source.pinned = source.pinned.filter(id => id !== docId);
    restoreActive(source, removedIndex);
  }
  const before = direction === 'left' || direction === 'up';
  const branch = {
    type: 'split', id: makeId('split'), axis: direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical', ratio: 0.5,
    first: before ? target : source, second: before ? source : target,
  };
  return { root: replaceGroup(root, groupId, branch), groupId: target.id };
}

/** Add a fresh group at an edge without inserting documents into the existing group. */
export function insertGroupAtEdge(root, targetGroupId, docIds, direction, { pinned = [] } = {}) {
  const original = findGroup(root, targetGroupId);
  if (!original || !DIRECTIONS.has(direction) || !Array.isArray(docIds) || !Array.isArray(pinned)) return null;
  if (docIds.some(id => typeof id !== 'string' || !id.length)) return null;
  const target = createGroup(docIds, docIds.at(-1));
  target.pinned = pinned.filter(id => target.tabs.includes(id));
  normalizePinned(target);
  const before = direction === 'left' || direction === 'up';
  const source = cloneGroup(original);
  const branch = {
    type: 'split', id: makeId('split'), axis: direction === 'left' || direction === 'right' ? 'horizontal' : 'vertical', ratio: 0.5,
    first: before ? target : source, second: before ? source : target,
  };
  return { root: replaceGroup(root, targetGroupId, branch), groupId: target.id };
}

/** Removing the sole group retains an empty workspace leaf. */
export function removeGroup(root, id) {
  if (!findGroup(root, id)) return root;
  if (root.type === 'group') return { ...root, tabs: [], activeId: null, pinned: [] };
  function remove(node) {
    if (node.type === 'group') return node.id === id ? null : node;
    const first = remove(node.first), second = remove(node.second);
    if (!first) return second;
    if (!second) return first;
    if (first === node.first && second === node.second) return node;
    return { ...node, first, second };
  }
  return remove(root);
}

/** Remove only tab references in this group, then collapse a newly empty group. */
export function closeGroupTabs(root, groupId, ids) {
  const original = findGroup(root, groupId);
  if (!original || !Array.isArray(ids)) return root;
  const closing = new Set(ids);
  if (!original.tabs.some(id => closing.has(id))) return root;
  const group = cloneGroup(original);
  const activeIndex = Math.max(0, group.tabs.indexOf(group.activeId));
  group.tabs = group.tabs.filter(id => !closing.has(id));
  group.pinned = group.pinned.filter(id => !closing.has(id));
  restoreActive(group, activeIndex);
  const updated = replaceGroup(root, groupId, group);
  return !group.tabs.length && flattenGroups(updated).length > 1 ? removeGroup(updated, groupId) : updated;
}

/** Edge dragging moves a tab into a new group and collapses an emptied source. */
export function dropTabToSplit(root, sourceGroupId, targetGroupId, docId, direction, { copy = false } = {}) {
  const source = findGroup(root, sourceGroupId), target = findGroup(root, targetGroupId);
  if (!source || !target || !DIRECTIONS.has(direction) || !source.tabs.includes(docId)) return null;
  if (!copy && sourceGroupId === targetGroupId && source.tabs.length === 1) return null;
  const pinned = (source.pinned || []).includes(docId) ? [docId] : [];
  const updated = copy ? root : closeGroupTabs(root, sourceGroupId, [docId]);
  return insertGroupAtEdge(updated, targetGroupId, [docId], direction, { pinned });
}

function insertIntoGroup(group, id, wasPinned, beforeId) {
  const pins = pinnedSet(group);
  if (wasPinned) pins.add(id);
  const tabs = group.tabs.filter(tabId => tabId !== id);
  const boundary = tabs.filter(tabId => pins.has(tabId)).length;
  let index = beforeId == null || beforeId === id ? tabs.length : tabs.indexOf(beforeId);
  index = pins.has(id) ? Math.min(index, boundary) : Math.max(index, boundary);
  tabs.splice(index, 0, id);
  group.tabs = tabs;
  group.pinned = tabs.filter(tabId => pins.has(tabId));
  group.activeId = id;
}

/** Move a shared document reference; the source collapses when its last tab moves. */
export function moveTabBetweenGroups(root, sourceId, targetId, docId, beforeId = null) {
  const originalSource = findGroup(root, sourceId), originalTarget = findGroup(root, targetId);
  if (!originalSource || !originalTarget || !originalSource.tabs.includes(docId)) return null;
  if (beforeId != null && !originalTarget.tabs.includes(beforeId)) return null;
  if (sourceId === targetId) {
    const group = cloneGroup(originalSource);
    if (!reorderGroupTab(group, docId, beforeId)) return null;
    group.activeId = docId;
    return { root: replaceGroup(root, sourceId, group), groupId: targetId };
  }
  const source = cloneGroup(originalSource), target = cloneGroup(originalTarget);
  const wasPinned = source.pinned.includes(docId);
  const removedIndex = source.tabs.indexOf(docId);
  source.tabs = source.tabs.filter(id => id !== docId);
  source.pinned = source.pinned.filter(id => id !== docId);
  restoreActive(source, removedIndex);
  normalizePinned(target);
  insertIntoGroup(target, docId, wasPinned, beforeId);
  let updated = replaceGroup(replaceGroup(root, sourceId, source), targetId, target);
  if (!source.tabs.length) updated = removeGroup(updated, sourceId);
  return { root: updated, groupId: targetId };
}

/** Normalized rectangles support spatial navigation regardless of nesting depth. */
export function layoutRects(root) {
  const rectangles = [];
  const visited = new Set();
  function walk(node, x, y, width, height) {
    if (!node || visited.has(node)) return;
    visited.add(node);
    if (node.type === 'group') { rectangles.push({ id: node.id, group: node, x, y, width, height }); return; }
    if (node.type !== 'split') return;
    const ratio = Number.isFinite(node.ratio) ? Math.max(0.05, Math.min(0.95, node.ratio)) : 0.5;
    if (node.axis === 'vertical') {
      walk(node.first, x, y, width, height * ratio);
      walk(node.second, x, y + height * ratio, width, height * (1 - ratio));
    } else {
      walk(node.first, x, y, width * ratio, height);
      walk(node.second, x + width * ratio, y, width * (1 - ratio), height);
    }
  }
  walk(root, 0, 0, 1, 1);
  return rectangles;
}

/** Prefer the nearest group sharing an edge projection, then nearest diagonal. */
export function moveToNeighbor(root, sourceGroupId, docId, direction) {
  if (!DIRECTIONS.has(direction)) return null;
  const rectangles = layoutRects(root);
  const source = rectangles.find(rect => rect.id === sourceGroupId);
  if (!source || !source.group.tabs.includes(docId)) return null;
  const horizontal = direction === 'left' || direction === 'right';
  const candidates = [];
  for (const candidate of rectangles) {
    if (candidate.id === sourceGroupId) continue;
    let gap;
    if (direction === 'right') gap = candidate.x - (source.x + source.width);
    else if (direction === 'left') gap = source.x - (candidate.x + candidate.width);
    else if (direction === 'down') gap = candidate.y - (source.y + source.height);
    else gap = source.y - (candidate.y + candidate.height);
    if (gap < -EPSILON) continue;
    const sourceStart = horizontal ? source.y : source.x;
    const sourceLength = horizontal ? source.height : source.width;
    const targetStart = horizontal ? candidate.y : candidate.x;
    const targetLength = horizontal ? candidate.height : candidate.width;
    const overlap = Math.min(sourceStart + sourceLength, targetStart + targetLength) - Math.max(sourceStart, targetStart);
    const offset = Math.abs(sourceStart + sourceLength / 2 - targetStart - targetLength / 2);
    candidates.push({ candidate, gap: Math.max(0, gap), overlap, offset });
  }
  candidates.sort((a, b) => Number(b.overlap > EPSILON) - Number(a.overlap > EPSILON) || a.gap - b.gap || a.offset - b.offset || b.overlap - a.overlap);
  return candidates.length ? moveTabBetweenGroups(root, sourceGroupId, candidates[0].candidate.id, docId) : null;
}
