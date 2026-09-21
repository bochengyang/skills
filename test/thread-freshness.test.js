import { test } from 'node:test';
import assert from 'node:assert/strict';
import { threadFreshness } from '../src/viewer-state.js';
import { createThread, formatPrompt } from '../src/comments-core.js';

// A thread is anchored to a line number of the diff it was written on. Once the code
// moves, that number points at something else. The snapshot taken when the comment was
// written is the only thing that can tell a reader — human or agent — whether the anchor
// still holds. `lines` is the side's content indexed by line number minus one, exactly
// what the viewer builds for a file; null means the file is no longer in the diff.
const T0 = '2026-09-07T01:00:00.000Z';
const at = (line, codeSnapshot) =>
  createThread({ id: 't', filePath: 'f.js', side: 'new', line, body: 'b', author: 'u', codeSnapshot, now: T0 });

test('a snapshot that still matches the line is current', () => {
  assert.equal(threadFreshness(at(2, 'beta'), ['alpha', 'beta', 'gamma']), 'current');
});

test('a snapshot that no longer matches the line is outdated', () => {
  assert.equal(threadFreshness(at(2, 'beta'), ['alpha', 'BETA changed', 'gamma']), 'outdated');
});

test('a range is compared as a whole', () => {
  const lines = ['alpha', 'beta', 'gamma', 'delta'];
  assert.equal(threadFreshness(at({ start: 2, end: 3 }, 'beta\ngamma'), lines), 'current');
  assert.equal(threadFreshness(at({ start: 2, end: 3 }, 'beta\nGAMMA'), lines), 'outdated');
});

test('a line that no longer exists on that side, or a file no longer in the diff, is missing', () => {
  assert.equal(threadFreshness(at(5, 'beta'), ['alpha', 'beta']), 'missing');
  assert.equal(threadFreshness(at({ start: 2, end: 3 }, 'beta\ngamma'), ['alpha', 'beta']), 'missing');
  assert.equal(threadFreshness(at(2, 'beta'), null), 'missing');
  // Lines the viewer never saw (outside every hunk) are holes in the array, not strings.
  const sparse = []; sparse[4] = 'five';
  assert.equal(threadFreshness(at(2, 'beta'), sparse), 'missing');
});

test('a thread without a snapshot cannot be judged and is treated as current', () => {
  assert.equal(threadFreshness(at(2), ['alpha', 'x']), 'current');
  assert.equal(threadFreshness(at(9, undefined), []), 'current');
});

test('line-ending and trailing-whitespace noise does not make a thread outdated', () => {
  assert.equal(threadFreshness(at(1, 'beta\r\n'), ['beta']), 'current');
  assert.equal(threadFreshness(at(1, 'beta'), ['beta  ']), 'current');
  assert.equal(threadFreshness(at({ start: 1, end: 2 }, 'a\r\nb\r\n'), ['a', 'b']), 'current');
});

test('formatPrompt keeps its shape when every thread is current', () => {
  const t = at(2, 'beta');
  assert.equal(formatPrompt([t], { freshness: () => 'current' }), formatPrompt([t]));
});

test('formatPrompt moves stale threads under a heading and drops their line numbers', () => {
  const fresh = at(2, 'beta');
  const stale = createThread({
    id: 's', filePath: 'g.js', side: 'new', line: { start: 14, end: 15 }, body: 'move this',
    author: 'u', codeSnapshot: 'line14\nline15', now: T0,
  });
  const gone = createThread({
    id: 'm', filePath: 'h.js', side: 'old', line: 3, body: 'delete this', author: 'u',
    codeSnapshot: 'old line', now: T0,
  });
  const state = { t: 'current', s: 'outdated', m: 'missing' };
  const out = formatPrompt([fresh, stale, gone], { freshness: (thread) => state[thread.id] });
  const [current, rest] = out.split('\n\n## ');
  assert.equal(current, 'f.js:L2 (new) [t]\n> beta\nu: b');
  assert.ok(rest, 'stale threads get their own section');
  assert.match(rest, /^Outdated/, 'the heading says what these are');
  assert.match(rest, /line number/i, 'and tells the reader not to trust the numbers');
  const staleBlock = rest.slice(rest.indexOf('g.js'));
  assert.doesNotMatch(staleBlock, /L14/, 'no line number on a stale thread');
  assert.match(staleBlock, /g\.js \(new\) \[s\]\n> line14\n> line15\nu: move this/);
  assert.match(staleBlock, /h\.js \(old\) \[m\]\n> old line\nu: delete this/);
});

test('formatPrompt with only stale threads still opens with the heading, never a blank line', () => {
  const stale = at(2, 'beta');
  const out = formatPrompt([stale], { freshness: () => 'outdated' });
  assert.match(out, /^## Outdated/);
});
