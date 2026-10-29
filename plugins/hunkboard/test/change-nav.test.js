import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDiff } from '../src/parser.js';
import { changeBlocks, changeStep, fullFileLines } from '../src/viewer-state.js';

// The whole-file view shows every line of a file, so in a long file the few changed lines are
// easy to lose. These helpers give the viewer the places to jump to: `changeBlocks` finds every
// run of consecutive changed lines in a list of diff lines (the rows the viewer renders, in
// order), and `changeStep` picks the block to go to from where the reader is.
//
// A block is { start, end, kind }: inclusive indexes into the lines array, and 'add', 'del' or
// 'mixed' by the kinds of line in it. A deletion followed directly by an addition is one block
// (a replacement), not two.

const fx = (name) => readFileSync(new URL(`./fixtures/${name}.diff`, import.meta.url), 'utf8');
const ctx = (content = 'x') => ({ type: 'context', content });
const add = (content = '+') => ({ type: 'add', content });
const del = (content = '-') => ({ type: 'del', content });

test('no lines, or only context, means no blocks', () => {
  assert.deepEqual(changeBlocks([]), []);
  assert.deepEqual(changeBlocks([ctx(), ctx(), ctx()]), []);
});

test('consecutive changed lines form one block; context splits blocks', () => {
  const lines = [ctx(), add(), add(), ctx(), ctx(), del(), ctx()];
  assert.deepEqual(changeBlocks(lines), [
    { start: 1, end: 2, kind: 'add' },
    { start: 5, end: 5, kind: 'del' },
  ]);
});

test('a deletion directly followed by an addition is a single mixed block', () => {
  assert.deepEqual(changeBlocks([ctx(), del(), del(), add(), ctx()]), [{ start: 1, end: 3, kind: 'mixed' }]);
});

test('a block may start on the first line or end on the last', () => {
  assert.deepEqual(changeBlocks([add(), ctx(), del()]), [
    { start: 0, end: 0, kind: 'add' },
    { start: 2, end: 2, kind: 'del' },
  ]);
  assert.deepEqual(changeBlocks([add(), add()]), [{ start: 0, end: 1, kind: 'add' }]);
});

test('the blocks of a real whole-file view sit where the hunks were', () => {
  const [file] = parseDiff(fx('multi-hunk')).files;
  const seq = (n) => Array.from({ length: n }, (_, i) => `line${i + 1}`);
  const oldText = seq(20).join('\n') + '\n';
  const newText = oldText.replace('line2\n', 'line2 changed\n').replace('line17\n', 'line17 changed\n');
  const lines = fullFileLines(file, { old: oldText, new: newText });
  assert.deepEqual(changeBlocks(lines), [
    { start: 1, end: 2, kind: 'mixed' },
    { start: 17, end: 18, kind: 'mixed' },
  ]);
});

// `changeStep(blocks, from, direction)`: `from` is the index of the row at the top of the
// viewport (just under the sticky bars); direction is +1 for next, -1 for previous. It returns
// the index into `blocks` of the block to scroll to, or null when there is none that way.
// Next means the first block that starts below the top row; previous means the last block that
// starts above it, so pressing previous while part-way through a block first returns to the
// start of that block, and pressing it again goes to the block before.
const blocks = [
  { start: 10, end: 12, kind: 'add' },
  { start: 40, end: 40, kind: 'del' },
  { start: 70, end: 75, kind: 'mixed' },
];

test('from above every block: next is the first block, previous is nothing', () => {
  assert.equal(changeStep(blocks, 0, 1), 0);
  assert.equal(changeStep(blocks, 0, -1), null);
});

test('from exactly the start of a block: next is the following block, previous the one before', () => {
  assert.equal(changeStep(blocks, 40, 1), 2);
  assert.equal(changeStep(blocks, 40, -1), 0);
  assert.equal(changeStep(blocks, 10, -1), null);
});

test('from part-way through a block: previous returns to the start of that block', () => {
  assert.equal(changeStep(blocks, 73, -1), 2);
  assert.equal(changeStep(blocks, 73, 1), null);
});

test('from between two blocks, both directions find the neighbours', () => {
  assert.equal(changeStep(blocks, 25, 1), 1);
  assert.equal(changeStep(blocks, 25, -1), 0);
});

test('from below every block: next is nothing, previous is the last block', () => {
  assert.equal(changeStep(blocks, 200, 1), null);
  assert.equal(changeStep(blocks, 200, -1), 2);
});

test('no blocks means nowhere to go', () => {
  assert.equal(changeStep([], 0, 1), null);
  assert.equal(changeStep([], 0, -1), null);
});
