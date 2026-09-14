import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectionFromLines } from '../src/viewer-state.js';

const L = (path, side, line) => ({ path, side, line });

test('a selection inside one file and side spans from its first line to its last', () => {
  const entries = [L('a.txt', 'new', 12), L('a.txt', 'new', 13), L('a.txt', 'new', 14)];
  assert.deepEqual(selectionFromLines(entries), { path: 'a.txt', side: 'new', anchor: 12, head: 14 });
});

test('a selection touching a single line is still a valid one-line selection', () => {
  assert.deepEqual(selectionFromLines([L('a.txt', 'old', 7)]), { path: 'a.txt', side: 'old', anchor: 7, head: 7 });
});

test('lines are ordered by number, not by the order the DOM happened to yield them', () => {
  const entries = [L('a.txt', 'new', 14), L('a.txt', 'new', 12), L('a.txt', 'new', 13)];
  assert.deepEqual(selectionFromLines(entries), { path: 'a.txt', side: 'new', anchor: 12, head: 14 });
});

test('dragging across both columns keeps the side the selection started on', () => {
  const entries = [L('a.txt', 'new', 12), L('a.txt', 'old', 12), L('a.txt', 'new', 13), L('a.txt', 'old', 13)];
  assert.deepEqual(selectionFromLines(entries), { path: 'a.txt', side: 'new', anchor: 12, head: 13 });
});

test('dragging past the end of a file keeps the file the selection started in', () => {
  const entries = [L('a.txt', 'new', 20), L('b.txt', 'new', 1), L('b.txt', 'new', 2)];
  assert.deepEqual(selectionFromLines(entries), { path: 'a.txt', side: 'new', anchor: 20, head: 20 });
});

test('gaps are spanned, because a comment covers a contiguous range', () => {
  const entries = [L('a.txt', 'new', 3), L('a.txt', 'new', 9)];
  assert.deepEqual(selectionFromLines(entries), { path: 'a.txt', side: 'new', anchor: 3, head: 9 });
});

test('nothing selectable yields null', () => {
  assert.equal(selectionFromLines([]), null);
  assert.equal(selectionFromLines(null), null);
  assert.equal(selectionFromLines(undefined), null);
});

test('entries without a usable line number are ignored', () => {
  const entries = [L('a.txt', 'new', null), L('a.txt', 'new', 5), L('a.txt', 'new', undefined), L('a.txt', 'new', 6)];
  assert.deepEqual(selectionFromLines(entries), { path: 'a.txt', side: 'new', anchor: 5, head: 6 });
  assert.equal(selectionFromLines([L('a.txt', 'new', null)]), null);
});
