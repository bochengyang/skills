import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectionRange, isSelected } from '../src/viewer-state.js';

const sel = (line, side = 'new', path = 'a.txt') => ({ path, side, anchor: line, head: line });

test('a selection that has not moved is a single line, not a range', () => {
  assert.equal(selectionRange(sel(4)), 4);
  assert.equal(selectionRange({ path: 'a.txt', side: 'new', anchor: 4, head: 4 }), 4);
});

test('dragging or shift-clicking downwards gives an ascending range', () => {
  assert.deepEqual(selectionRange({ path: 'a.txt', side: 'new', anchor: 4, head: 7 }), { start: 4, end: 7 });
});

test('dragging upwards still gives an ascending range', () => {
  assert.deepEqual(selectionRange({ path: 'a.txt', side: 'new', anchor: 7, head: 4 }), { start: 4, end: 7 });
});

test('selectionRange tolerates a missing selection', () => {
  assert.equal(selectionRange(null), null);
  assert.equal(selectionRange(undefined), null);
});

test('isSelected covers every line between the two ends, inclusive', () => {
  const s = { path: 'a.txt', side: 'new', anchor: 4, head: 7 };
  assert.deepEqual([3, 4, 5, 6, 7, 8].map((n) => isSelected(s, 'a.txt', 'new', n)), [false, true, true, true, true, false]);
});

test('isSelected works the same when the drag went upwards', () => {
  const s = { path: 'a.txt', side: 'new', anchor: 7, head: 4 };
  assert.deepEqual([4, 5, 7].map((n) => isSelected(s, 'a.txt', 'new', n)), [true, true, true]);
});

test('isSelected is confined to its own file and side', () => {
  const s = { path: 'a.txt', side: 'new', anchor: 4, head: 7 };
  assert.equal(isSelected(s, 'b.txt', 'new', 5), false);
  assert.equal(isSelected(s, 'a.txt', 'old', 5), false);
});

test('isSelected is false for a missing selection or a line without a number', () => {
  assert.equal(isSelected(null, 'a.txt', 'new', 5), false);
  assert.equal(isSelected({ path: 'a.txt', side: 'new', anchor: 4, head: 7 }, 'a.txt', 'new', null), false);
  assert.equal(isSelected({ path: 'a.txt', side: 'new', anchor: 4, head: 7 }, 'a.txt', 'new', undefined), false);
});
