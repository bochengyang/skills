import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commentColumns } from '../src/viewer-state.js';

test('in the side-by-side layout a comment occupies only its own half', () => {
  assert.deepEqual(commentColumns('split', 'old'), { start: 1, span: 3 });
  assert.deepEqual(commentColumns('split', 'new'), { start: 4, span: 3 });
});

test('the two halves never overlap and together cover the six columns', () => {
  const left = commentColumns('split', 'old');
  const right = commentColumns('split', 'new');
  assert.equal(left.start + left.span, right.start, 'the halves meet exactly');
  assert.equal(right.start + right.span, 7, 'together they end at the grid edge');
});

test('in the single-column layout a comment spans the whole row', () => {
  assert.deepEqual(commentColumns('inline', 'old'), { start: 1, span: 4 });
  assert.deepEqual(commentColumns('inline', 'new'), { start: 1, span: 4 });
});

test('an unknown side falls back to the new half rather than throwing', () => {
  assert.deepEqual(commentColumns('split', undefined), { start: 4, span: 3 });
  assert.deepEqual(commentColumns('split', 'both'), { start: 4, span: 3 });
});

test('an unknown layout is treated as a single column', () => {
  assert.deepEqual(commentColumns(undefined, 'new'), { start: 1, span: 4 });
});
