import test from 'node:test';
import assert from 'node:assert/strict';
import {
  activeDocument, activeGroup, closeDocument, createDocument, createWorkspace, lineCount,
  markSaved, moveTab, openDocument, reorderTab, serializePreferences,
  setLayout, updateContent,
} from '../src/model.mjs';
import {splitGroup,flattenGroups,findGroup,pinTab} from '../src/groups.mjs';

test('new workspace opens a document in both independently active panes', () => {
  const state = createWorkspace();
  assert.equal(activeDocument(state), null);
  const document = openDocument(state, { name: 'dataset.csv', content: 'x,y\n1,2' });
  assert.deepEqual(state.textTabs, [document.id]);
  assert.deepEqual(state.visualizerTabs, [document.id]);
  assert.equal(activeDocument(state, 'text'), document);
  assert.equal(activeDocument(state, 'visualizer'), document);
  assert.equal(document.dirty, false);
});

test('reopening a Windows file deduplicates case and slash differences without losing edits', () => {
  const state = createWorkspace();
  const document = openDocument(state, { path: 'C:\\Data\\sample.csv', content: 'original' });
  updateContent(state, document.id, 'unsaved');
  const reopened = openDocument(state, { path: 'c:/data/SAMPLE.csv', content: 'disk version' });
  assert.equal(reopened, document);
  assert.equal(reopened.content, 'unsaved');
  assert.equal(reopened.dirty, true);
  assert.equal(state.documents.length, 1);
  assert.equal(state.textTabs.length, 1);
});

test('dirty status follows content and saves establish the new comparison point', () => {
  const state = createWorkspace();
  const document = openDocument(state, { content: 'before' });
  updateContent(state, document.id, 'after');
  assert.equal(document.dirty, true);
  updateContent(state, document.id, 'before');
  assert.equal(document.dirty, false);
  updateContent(state, document.id, 'after');
  markSaved(state, document.id, { path: 'C:\\Data\\renamed.dv' });
  assert.equal(document.name, 'renamed.dv');
  assert.equal(document.savedContent, 'after');
  assert.equal(document.dirty, false);
  updateContent(state, document.id, 'before');
  assert.equal(document.dirty, true);
});

test('closing an active middle tab selects the next tab in each pane', () => {
  const state = createWorkspace();
  const docs = ['a', 'b', 'c'].map((id) => openDocument(state, { id }));
  state.activeTextId = docs[1].id;
  state.activeVisualizerId = docs[0].id;
  assert.equal(closeDocument(state, docs[1].id), true);
  assert.equal(activeDocument(state).id, 'c');
  assert.equal(activeDocument(state, 'visualizer').id, 'a');
  closeDocument(state, 'c');
  assert.equal(activeDocument(state).id, 'a');
  closeDocument(state, 'a');
  assert.equal(activeDocument(state), null);
  assert.deepEqual(state.documents, []);
});

test('edits made during an asynchronous save remain dirty against the saved snapshot', () => {
  const state = createWorkspace();
  const document = openDocument(state, { content: 'initial' });
  updateContent(state, document.id, 'save started');
  const savedSnapshot = document.content;
  updateContent(state, document.id, 'newer edit');
  markSaved(state, document.id, { path: 'C:\\Data\\saved.dv', content: savedSnapshot });
  assert.equal(document.content, 'newer edit');
  assert.equal(document.savedContent, 'save started');
  assert.equal(document.dirty, true);
  updateContent(state, document.id, 'save started');
  assert.equal(document.dirty, false);
  markSaved(state, document.id, { content: '' });
  assert.equal(document.savedContent, '');
  assert.equal(document.dirty, true);
});

test('tab order is independent, supports append, and rejects invalid targets without mutation', () => {
  const state = createWorkspace();
  ['a', 'b', 'c'].forEach((id) => openDocument(state, { id }));
  assert.equal(reorderTab(state, 'text', 'c', 'a'), true);
  assert.deepEqual(state.textTabs, ['c', 'a', 'b']);
  assert.deepEqual(state.visualizerTabs, ['a', 'b', 'c']);
  reorderTab(state, 'text', 'c');
  assert.deepEqual(state.textTabs, ['a', 'b', 'c']);
  assert.equal(reorderTab(state, 'text', 'a', 'missing'), false);
  assert.deepEqual(state.textTabs, ['a', 'b', 'c']);
});

test('moving to an already represented pane does not duplicate or lose the document', () => {
  const state = createWorkspace();
  ['a', 'b'].forEach((id) => openDocument(state, { id }));
  assert.equal(moveTab(state, 'b', 'text', 'visualizer', 'a'), true);
  assert.deepEqual(state.textTabs, ['a']);
  assert.deepEqual(state.visualizerTabs, ['b', 'a']);
  assert.equal(activeDocument(state).id, 'a');
  assert.equal(activeDocument(state, 'visualizer').id, 'b');
  assert.equal(state.documents.length, 2);
  openDocument(state, { id: 'b' });
  assert.deepEqual(state.textTabs, ['a', 'b']);
  assert.deepEqual(state.visualizerTabs, ['b', 'a']);
});

test('moving the sole tab across panes preserves a valid empty source', () => {
  const state = createWorkspace();
  openDocument(state, { id: 'a' });
  moveTab(state, 'a', 'text', 'visualizer');
  assert.equal(activeDocument(state), null);
  assert.equal(activeDocument(state, 'visualizer').id, 'a');
  moveTab(state, 'a', 'visualizer', 'text');
  assert.equal(activeDocument(state).id, 'a');
  assert.equal(activeDocument(state, 'visualizer'), null);
});

test('line numbers represent real lines including CRLF and trailing newlines', () => {
  assert.equal(lineCount(''), 1);
  assert.equal(lineCount('one'), 1);
  assert.equal(lineCount('one\ntwo\n'), 3);
  assert.equal(lineCount('one\r\ntwo\r\n'), 3);
  assert.equal(lineCount('one\rtwo'), 2);
});

test('preferences contain no document data and constrain invalid layout and ratio', () => {
  const state = createWorkspace();
  openDocument(state, { content: 'private content', path: 'C:\\private.csv' });
  assert.equal(setLayout(state, 'text'), true);
  assert.equal(setLayout(state, 'unexpected'), false);
  state.splitRatio = 9;
  assert.deepEqual(serializePreferences(state), {
    layout: 'text', focusMode: false, explorerOpen: true, splitRatio: 0.8,
  });
  state.splitRatio = Number.NaN;
  assert.equal(serializePreferences(state).splitRatio, 0.5);
});

test('invalid document and pane requests are harmless', () => {
  const state = createWorkspace();
  assert.equal(updateContent(state, 'missing', 'text'), null);
  assert.equal(markSaved(state, 'missing'), null);
  assert.equal(closeDocument(state, 'missing'), false);
  assert.equal(moveTab(state, 'missing', 'text', 'other'), false);
  assert.equal(activeDocument(state, 'other'), null);
  assert.equal(createDocument().name, 'Untitled.dv');
  assert.notEqual(createDocument().id, createDocument().id);
});

test('global document close removes every nested reference and repairs both pane selections', () => {
  const state=createWorkspace();
  const docs=['a','b','c'].map(id=>openDocument(state,{id,content:id}));
  updateContent(state,'b','unsaved b');
  const textFirst=activeGroup(state).id;
  const textSplit=splitGroup(state.layouts.text,textFirst,'a','right');
  state.layouts.text=textSplit.root;
  const nested=splitGroup(state.layouts.text,textSplit.groupId,'a','down');
  state.layouts.text=nested.root;
  state.activeGroups.text=nested.groupId;
  const visualSplit=splitGroup(state.layouts.visualizer,activeGroup(state,'visualizer').id,'a','left');
  state.layouts.visualizer=visualSplit.root;
  state.activeGroups.visualizer=visualSplit.groupId;
  for(const pane of ['text','visualizer'])for(const group of flattenGroups(state.layouts[pane]))pinTab(group,'a');
  assert.equal(closeDocument(state,'a'),true);
  assert.deepEqual(state.documents.map(doc=>doc.id),['b','c']);
  assert.equal(docs[1].content,'unsaved b');
  assert.equal(docs[1].dirty,true);
  for(const pane of ['text','visualizer']){
    const groups=flattenGroups(state.layouts[pane]);
    assert.equal(groups.length,1);
    for(const group of groups){assert.ok(!group.tabs.includes('a'));assert.ok(!group.pinned.includes('a'));assert.notEqual(group.activeId,'a');}
    assert.ok(groups.includes(activeGroup(state,pane)));
    assert.equal(activeDocument(state,pane).id,'c');
  }
});

test('legacy active-tab aliases read and write only the selected nested group', () => {
  const state=createWorkspace();
  openDocument(state,{id:'a'});openDocument(state,{id:'b'});
  const originalId=activeGroup(state).id;
  const result=splitGroup(state.layouts.text,originalId,'a','right');
  state.layouts.text=result.root;
  state.activeGroups.text=result.groupId;
  assert.deepEqual(state.textTabs,['a']);
  state.textTabs=['a','b'];state.activeTextId='b';
  assert.equal(findGroup(state.layouts.text,result.groupId).activeId,'b');
  assert.equal(activeDocument(state).id,'b');
  state.textTabs=['a'];state.activeTextId='a';
  assert.deepEqual(findGroup(state.layouts.text,originalId).tabs,['a','b']);
  assert.equal(findGroup(state.layouts.text,originalId).activeId,'b');
  closeDocument(state,'a');
  assert.equal(state.activeGroups.text,originalId);
  assert.deepEqual(state.textTabs,['b']);
  assert.equal(state.activeTextId,'b');
});
