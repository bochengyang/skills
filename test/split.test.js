import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDiff } from '../src/parser.js';
import { toSplitRows } from '../src/split.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}.diff`, import.meta.url), 'utf8');
const L = (type, content, oldLine, newLine) => ({ type, content, oldLine, newLine });
const hunk = (lines) => ({ oldStart: 1, oldLines: 0, newStart: 1, newLines: 0, section: '', lines });

test('context lines occupy both sides with the same line object', () => {
  const ctx = L('context', 'same', 5, 7);
  const rows = toSplitRows(hunk([ctx]));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].left, ctx);
  assert.equal(rows[0].right, ctx);
});

test('an adjacent del/add block pairs up line by line', () => {
  const [f] = parseDiff(fx('modify')).files;
  const rows = toSplitRows(f.hunks[0]);
  assert.deepEqual(
    rows.map((r) => [r.left && r.left.content, r.right && r.right.content]),
    [
      ['alpha', 'alpha'],
      ['beta', 'beta modified'],
      ['gamma', 'gamma'],
      [null, 'delta added'],
    ],
  );
  assert.equal(rows[1].left.type, 'del');
  assert.equal(rows[1].right.type, 'add');
});

test('more deletions than additions pad the right side with null', () => {
  const rows = toSplitRows(hunk([L('del', 'a', 1, null), L('del', 'b', 2, null), L('add', 'c', null, 1)]));
  assert.deepEqual(
    rows.map((r) => [r.left && r.left.content, r.right && r.right.content]),
    [['a', 'c'], ['b', null]],
  );
});

test('more additions than deletions pad the left side with null', () => {
  const rows = toSplitRows(hunk([L('del', 'a', 1, null), L('add', 'b', null, 1), L('add', 'c', null, 2)]));
  assert.deepEqual(
    rows.map((r) => [r.left && r.left.content, r.right && r.right.content]),
    [['a', 'b'], [null, 'c']],
  );
});

test('blocks separated by context are never paired across the context line', () => {
  const rows = toSplitRows(hunk([L('add', 'x', null, 1), L('context', 'y', 1, 2), L('del', 'z', 2, null)]));
  assert.deepEqual(
    rows.map((r) => [r.left && r.left.content, r.right && r.right.content]),
    [[null, 'x'], ['y', 'y'], ['z', null]],
  );
});

test('adds that come before dels inside one block still pair (git never emits this, but be safe)', () => {
  const rows = toSplitRows(hunk([L('add', 'n', null, 1), L('del', 'o', 1, null)]));
  assert.deepEqual(
    rows.map((r) => [r.left && r.left.content, r.right && r.right.content]),
    [['o', 'n']],
  );
});

test('empty hunk gives no rows; input lines array is not mutated', () => {
  assert.deepEqual(toSplitRows(hunk([])), []);
  const lines = [L('del', 'a', 1, null), L('add', 'b', null, 1)];
  const snapshot = JSON.stringify(lines);
  toSplitRows(hunk(lines));
  assert.equal(JSON.stringify(lines), snapshot);
});

test('row count for the multi-hunk fixture equals context + max(del, add) per block', () => {
  const [f] = parseDiff(fx('multi-hunk')).files;
  assert.equal(toSplitRows(f.hunks[0]).length, 5);
  assert.equal(toSplitRows(f.hunks[1]).length, 7);
});
