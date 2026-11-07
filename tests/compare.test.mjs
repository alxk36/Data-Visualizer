import test from 'node:test';
import assert from 'node:assert/strict';
import { compareLines } from '../src/compare.mjs';

test('insertions preserve alignment and original line numbers', () => {
  const result = compareLines('a\nb\nc', 'a\nnew\nb\nc');
  assert.deepEqual(result.rows.map(row => row.kind), ['equal', 'added', 'equal', 'equal']);
  assert.equal(result.rows[2].left.number, 2);
  assert.equal(result.rows[2].right.number, 3);
  assert.equal(result.added, 1);
  assert.equal(result.removed, 0);
});

test('replacement blocks are paired without hiding unchanged lines', () => {
  const result = compareLines('top\nold A\nold B\nbottom', 'top\nnew A\nbottom');
  assert.deepEqual(result.rows.map(row => row.kind), ['equal', 'changed', 'removed', 'equal']);
  assert.equal(result.removed, 2);
  assert.equal(result.added, 1);
  assert.equal(result.rows.at(-1).right.number, 3);
});

test('repeated lines are matched by the longest common subsequence', () => {
  const result = compareLines('a\nb\na\nc', 'a\na\nb\nc');
  assert.equal(result.added, 1);
  assert.equal(result.removed, 1);
  assert.equal(result.rows.filter(row => row.kind === 'equal').length, 3);
});

test('empty documents and final newlines are represented as real lines', () => {
  assert.equal(compareLines('', '').rows.length, 1);
  assert.equal(compareLines('', '').identical, true);
  assert.equal(compareLines('text', 'text\n').added, 1);
  assert.equal(compareLines('text', 'text\n').rows.at(-1).right.text, '');
});

test('line-ending changes are reported without fabricated text edits', () => {
  const result = compareLines('a\r\nb\r\n', 'a\nb\n');
  assert.equal(result.lineEndingsOnly, true);
  assert.equal(result.identical, false);
  assert.equal(result.added + result.removed, 0);
});

test('large comparisons preserve content while bounding diff memory', () => {
  const first = 'prefix\nleft1\nleft2\nsuffix';
  const second = 'prefix\nright1\nright2\nsuffix';
  const result = compareLines(first, second, { maxCells: 1 });
  assert.equal(result.exact, false);
  assert.equal(result.rows.map(row => row.left?.text).filter(value => value !== undefined).join('\n'), first);
  assert.equal(result.rows.map(row => row.right?.text).filter(value => value !== undefined).join('\n'), second);
  assert.equal(result.rows[0].kind, 'equal');
  assert.equal(result.rows.at(-1).kind, 'equal');
});
