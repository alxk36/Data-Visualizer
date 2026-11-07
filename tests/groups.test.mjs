import test from 'node:test';
import assert from 'node:assert/strict';
import { createGroup, createLayouts, flattenGroups, findGroup, splitGroup, insertGroupAtEdge, dropTabToSplit, removeGroup, moveToNeighbor, moveTabBetweenGroups, reorderGroupTab, pinTab, closeGroupTabs, layoutRects } from '../src/groups.mjs';

function nestedLayout() {
  const top = createGroup(['one', 'two', 'three'], 'two');
  const lower = splitGroup(top, top.id, 'two', 'down');
  const lowerRight = splitGroup(lower.root, lower.groupId, 'two', 'right');
  return { root: lowerRight.root, topId: top.id, bottomLeftId: lower.groupId, bottomRightId: lowerRight.groupId };
}

test('layouts are independent and group tabs are unique shared document IDs', () => {
  const layouts = createLayouts();
  assert.notEqual(layouts.text.id, layouts.visualizer.id);
  const input = ['a', 'a', 'b'];
  const group = createGroup(input, 'b');
  input.push('c');
  assert.deepEqual(group.tabs, ['a', 'b']);
  assert.equal(group.activeId, 'b');
  assert.deepEqual(group.pinned, []);
});

test('top/bottom plus bottom left/right keeps nested geometry and shared references', () => {
  const { root, topId, bottomLeftId, bottomRightId } = nestedLayout();
  assert.equal(root.axis, 'vertical');
  assert.equal(root.second.axis, 'horizontal');
  const rects = layoutRects(root);
  assert.deepEqual(rects.map(({ id, x, y, width, height }) => ({ id, x, y, width, height })), [
    { id: topId, x: 0, y: 0, width: 1, height: 0.5 },
    { id: bottomLeftId, x: 0, y: 0.5, width: 0.5, height: 0.5 },
    { id: bottomRightId, x: 0.5, y: 0.5, width: 0.5, height: 0.5 },
  ]);
  assert.equal(flattenGroups(root).filter(group => group.tabs.includes('two')).length, 3);
  assert.equal(findGroup(root, topId).activeId, 'two');
});

test('splits in every direction place the new group correctly without mutating inputs', () => {
  for (const direction of ['left', 'right', 'up', 'down']) {
    const group = createGroup(['a', 'b'], 'a');
    const result = splitGroup(group, group.id, 'a', direction);
    assert.deepEqual(group.tabs, ['a', 'b']);
    const before = ['left', 'up'].includes(direction);
    assert.equal(result.root[before ? 'first' : 'second'].id, result.groupId);
    assert.equal(result.root.axis, ['left', 'right'].includes(direction) ? 'horizontal' : 'vertical');
    assert.equal(findGroup(result.root, group.id).activeId, 'a');
  }
});

test('explicit split-and-move retains an empty source and transfers the pin', () => {
  const group = createGroup(['a'], 'a');
  pinTab(group, 'a');
  const result = splitGroup(group, group.id, 'a', 'right', { move: true });
  assert.equal(flattenGroups(result.root).length, 2);
  assert.deepEqual(findGroup(result.root, group.id).tabs, []);
  assert.equal(findGroup(result.root, group.id).activeId, null);
  assert.deepEqual(findGroup(result.root, result.groupId).pinned, ['a']);
  assert.deepEqual(group.tabs, ['a']);
});

test('edge drops split the selected tab from its group in every direction', () => {
  for (const direction of ['left', 'right', 'up', 'down']) {
    const source = createGroup(['a', 'b', 'c'], 'b');
    pinTab(source, 'b');
    const before = structuredClone(source);
    const dropped = dropTabToSplit(source, source.id, source.id, 'b', direction);
    const newFirst = direction === 'left' || direction === 'up';
    assert.equal(dropped.root[newFirst ? 'first' : 'second'].id, dropped.groupId);
    assert.equal(dropped.root.axis, ['left', 'right'].includes(direction) ? 'horizontal' : 'vertical');
    assert.deepEqual(findGroup(dropped.root, source.id).tabs, ['a', 'c']);
    assert.equal(findGroup(dropped.root, source.id).activeId, 'a');
    assert.deepEqual(findGroup(dropped.root, dropped.groupId).tabs, ['b']);
    assert.deepEqual(findGroup(dropped.root, dropped.groupId).pinned, ['b']);
    assert.equal(findGroup(dropped.root, dropped.groupId).activeId, 'b');
    assert.deepEqual(source, before);
  }
});

test('a sole tab cannot move to its own edge but can be copied there', () => {
  const source = createGroup(['a']);
  pinTab(source, 'a');
  const before = structuredClone(source);
  for (const direction of ['left', 'right', 'up', 'down']) {
    assert.equal(dropTabToSplit(source, source.id, source.id, 'a', direction), null);
    const copied = dropTabToSplit(source, source.id, source.id, 'a', direction, { copy: true });
    assert.equal(flattenGroups(copied.root).length, 2);
    assert.deepEqual(findGroup(copied.root, source.id).tabs, ['a']);
    assert.deepEqual(findGroup(copied.root, copied.groupId).pinned, ['a']);
  }
  assert.deepEqual(source, before);
});

test('cross-group edge moves collapse a sole-tab source while retaining the target', () => {
  for (const direction of ['left', 'right', 'up', 'down']) {
    const source = createGroup(['a']);
    pinTab(source, 'a');
    const layout = insertGroupAtEdge(source, source.id, ['b', 'c'], 'right');
    const before = structuredClone(layout.root);
    const dropped = dropTabToSplit(layout.root, source.id, layout.groupId, 'a', direction);
    assert.equal(flattenGroups(dropped.root).length, 2);
    assert.equal(findGroup(dropped.root, source.id), null);
    assert.deepEqual(findGroup(dropped.root, layout.groupId).tabs, ['b', 'c']);
    assert.equal(findGroup(dropped.root, layout.groupId).activeId, 'c');
    assert.deepEqual(findGroup(dropped.root, dropped.groupId).pinned, ['a']);
    assert.equal(dropped.root[['left', 'up'].includes(direction) ? 'first' : 'second'].id, dropped.groupId);
    assert.deepEqual(layout.root, before);
  }
});

test('nested edge moves preserve surrounding geometry and existing duplicate references', () => {
  const { root, topId, bottomLeftId, bottomRightId } = nestedLayout();
  root.ratio = 0.3;
  const before = structuredClone(root);
  const dropped = dropTabToSplit(root, bottomRightId, bottomLeftId, 'two', 'up');
  assert.equal(dropped.root.id, root.id);
  assert.equal(dropped.root.ratio, 0.3);
  assert.equal(dropped.root.first.id, topId);
  assert.equal(dropped.root.second.axis, 'vertical');
  assert.equal(dropped.root.second.first.id, dropped.groupId);
  assert.equal(dropped.root.second.second.id, bottomLeftId);
  assert.equal(findGroup(dropped.root, bottomRightId), null);
  assert.equal(flattenGroups(dropped.root).filter(group => group.tabs.includes('two')).length, 3);
  assert.deepEqual(root, before);
});

test('cross-group edge copies retain the source while moving other tabs retains its active tab', () => {
  const source = createGroup(['a', 'b', 'c'], 'b');
  const layout = insertGroupAtEdge(source, source.id, ['d'], 'down');
  const copied = dropTabToSplit(layout.root, source.id, layout.groupId, 'a', 'left', { copy: true });
  assert.equal(flattenGroups(copied.root).length, 3);
  assert.deepEqual(findGroup(copied.root, source.id).tabs, ['a', 'b', 'c']);
  const moved = dropTabToSplit(layout.root, source.id, layout.groupId, 'a', 'right');
  assert.equal(flattenGroups(moved.root).length, 3);
  assert.deepEqual(findGroup(moved.root, source.id).tabs, ['b', 'c']);
  assert.equal(findGroup(moved.root, source.id).activeId, 'b');
  assert.deepEqual(findGroup(moved.root, layout.groupId).tabs, ['d']);
});

test('external edge groups deduplicate documents, normalize pins, and allow deferred content', () => {
  const original = createGroup(['existing']);
  const docs = ['a', 'b', 'a', 'c'];
  const pins = ['c', 'b', 'missing', 'c'];
  const inserted = insertGroupAtEdge(original, original.id, docs, 'right', { pinned: pins });
  const target = findGroup(inserted.root, inserted.groupId);
  assert.deepEqual(target.tabs, ['b', 'c', 'a']);
  assert.deepEqual(target.pinned, ['b', 'c']);
  assert.equal(target.activeId, 'c');
  assert.deepEqual(findGroup(inserted.root, original.id).tabs, ['existing']);
  assert.deepEqual(docs, ['a', 'b', 'a', 'c']);
  assert.deepEqual(pins, ['c', 'b', 'missing', 'c']);
  const empty = insertGroupAtEdge(original, original.id, [], 'down');
  assert.deepEqual(findGroup(empty.root, empty.groupId).tabs, []);
  assert.equal(findGroup(empty.root, empty.groupId).activeId, null);
});

test('invalid edge drops never remove source tabs or modify the original layout', () => {
  const source = createGroup(['a', 'b']);
  const layout = insertGroupAtEdge(source, source.id, ['c'], 'down');
  const before = structuredClone(layout.root);
  for (const [sourceId, targetId, docId, direction] of [
    ['missing', layout.groupId, 'a', 'left'],
    [source.id, 'missing', 'a', 'left'],
    [source.id, layout.groupId, 'missing', 'left'],
    [source.id, layout.groupId, 'a', 'center'],
  ]) assert.equal(dropTabToSplit(layout.root, sourceId, targetId, docId, direction), null);
  assert.equal(insertGroupAtEdge(layout.root, 'missing', ['a'], 'right'), null);
  assert.equal(insertGroupAtEdge(layout.root, source.id, ['a'], 'center'), null);
  assert.equal(insertGroupAtEdge(layout.root, source.id, null, 'right'), null);
  assert.equal(insertGroupAtEdge(layout.root, source.id, ['a', 7], 'right'), null);
  assert.equal(insertGroupAtEdge(layout.root, source.id, [''], 'right'), null);
  assert.deepEqual(layout.root, before);
});

test('pinning and reordering preserve a stable pinned prefix', () => {
  const group = createGroup(['a', 'b', 'c', 'd'], 'd');
  pinTab(group, 'c'); pinTab(group, 'a');
  assert.deepEqual(group.tabs, ['c', 'a', 'b', 'd']);
  reorderGroupTab(group, 'd', 'c');
  assert.deepEqual(group.tabs, ['c', 'a', 'd', 'b']);
  reorderGroupTab(group, 'c');
  assert.deepEqual(group.tabs, ['a', 'c', 'd', 'b']);
  pinTab(group, 'a', false);
  assert.deepEqual(group.tabs, ['c', 'a', 'd', 'b']);
  assert.deepEqual(group.pinned, ['c']);
  assert.equal(group.activeId, 'd');
});

test('moving an existing target reference deduplicates and preserves pin ordering', () => {
  const source = createGroup(['a', 'b'], 'a');
  pinTab(source, 'a');
  const split = splitGroup(source, source.id, 'b', 'right');
  const target = findGroup(split.root, split.groupId);
  target.tabs.push('a', 'c'); pinTab(target, 'b');
  const moved = moveTabBetweenGroups(split.root, source.id, target.id, 'a', 'c');
  assert.deepEqual(findGroup(moved.root, target.id).tabs, ['b', 'a', 'c']);
  assert.deepEqual(findGroup(moved.root, target.id).pinned, ['b', 'a']);
  assert.deepEqual(findGroup(moved.root, source.id).tabs, ['b']);
  assert.equal(findGroup(moved.root, source.id).activeId, 'b');
  assert.equal(findGroup(moved.root, target.id).activeId, 'a');
  assert.deepEqual(findGroup(split.root, source.id).tabs, ['a', 'b']);
});

test('neighbor movement uses spatial geometry instead of flat traversal order', () => {
  const { root, topId, bottomLeftId, bottomRightId } = nestedLayout();
  const right = moveToNeighbor(root, bottomLeftId, 'two', 'right');
  assert.equal(right.groupId, bottomRightId);
  assert.equal(findGroup(right.root, bottomLeftId), null);
  const up = moveToNeighbor(root, bottomRightId, 'two', 'up');
  assert.equal(up.groupId, topId);
  assert.equal(findGroup(up.root, bottomRightId), null);
  assert.equal(moveToNeighbor(root, topId, 'two', 'right'), null);
  assert.equal(moveToNeighbor(root, topId, 'two', 'up'), null);
});

test('directional movement accounts for split ratios and favors aligned neighbors', () => {
  const left = createGroup(['a', 'b']);
  const right = splitGroup(left, left.id, 'a', 'right');
  const bottom = splitGroup(right.root, right.groupId, 'a', 'down');
  bottom.root.ratio = 0.3;
  bottom.root.second.ratio = 0.7;
  const rects = layoutRects(bottom.root);
  assert.equal(rects[1].x, 0.3);
  assert.equal(rects[2].y, 0.7);
  const moved = moveToNeighbor(bottom.root, left.id, 'b', 'right');
  assert.equal(moved.groupId, right.groupId);
});

test('close/remove collapses only the necessary branch and never destroys other references', () => {
  const { root, topId, bottomLeftId, bottomRightId } = nestedLayout();
  const closed = closeGroupTabs(root, bottomRightId, ['two']);
  assert.equal(closed.type, 'split');
  assert.equal(closed.second.id, bottomLeftId);
  assert.equal(findGroup(closed, topId).tabs.includes('two'), true);
  const single = removeGroup(closed, topId);
  assert.equal(single.id, bottomLeftId);
  const empty = closeGroupTabs(single, bottomLeftId, ['two']);
  assert.equal(empty.id, bottomLeftId);
  assert.deepEqual(empty.tabs, []);
  assert.equal(empty.activeId, null);
});

test('closing tabs repairs active selection and pinned references', () => {
  const group = createGroup(['a', 'b', 'c'], 'b');
  pinTab(group, 'a'); pinTab(group, 'b');
  const updated = closeGroupTabs(group, group.id, ['a', 'b']);
  assert.deepEqual(updated.tabs, ['c']);
  assert.deepEqual(updated.pinned, []);
  assert.equal(updated.activeId, 'c');
  assert.deepEqual(group.tabs, ['a', 'b', 'c']);
});

test('invalid operations leave valid trees unchanged', () => {
  const group = createGroup(['a']);
  assert.equal(splitGroup(group, group.id, 'missing', 'right'), null);
  assert.equal(splitGroup(group, group.id, 'a', 'diagonal'), null);
  assert.equal(moveTabBetweenGroups(group, group.id, 'missing', 'a'), null);
  assert.equal(moveToNeighbor(group, group.id, 'a', 'down'), null);
  assert.equal(removeGroup(group, 'missing'), group);
  assert.equal(closeGroupTabs(group, group.id, ['missing']), group);
  assert.equal(reorderGroupTab(group, 'a', 'missing'), false);
  assert.equal(pinTab(group, 'missing'), false);
  assert.deepEqual(group.tabs, ['a']);
});
