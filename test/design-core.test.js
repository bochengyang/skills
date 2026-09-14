import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDiff } from '../src/parser.js';
import { reviewProgress, modeChangeLabel } from '../src/viewer-state.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}.diff`, import.meta.url), 'utf8');
const files = (n = 4) => Array.from({ length: n }, (_, i) => ({ path: `f${i}.txt` }));

test('progress counts the files marked as viewed', () => {
  const seen = new Set(['f0.txt', 'f2.txt']);
  assert.deepEqual(reviewProgress(files(4), (f) => seen.has(f.path)), {
    viewed: 2, total: 4, ratio: 0.5, complete: false,
  });
});

test('progress is complete only when every file has been viewed', () => {
  assert.deepEqual(reviewProgress(files(3), () => true), { viewed: 3, total: 3, ratio: 1, complete: true });
  assert.deepEqual(reviewProgress(files(3), () => false), { viewed: 0, total: 3, ratio: 0, complete: false });
});

test('an empty review is not complete and never divides by zero', () => {
  assert.deepEqual(reviewProgress([], () => true), { viewed: 0, total: 0, ratio: 0, complete: false });
  assert.deepEqual(reviewProgress(null, () => true), { viewed: 0, total: 0, ratio: 0, complete: false });
});

test('the ratio is exact, not rounded, so the bar can be positioned precisely', () => {
  const { ratio } = reviewProgress(files(3), (f) => f.path === 'f0.txt');
  assert.ok(Math.abs(ratio - 1 / 3) < 1e-12);
});

test('a permission change is stated in words, not in octal', () => {
  assert.equal(modeChangeLabel({ oldMode: '100644', newMode: '100755' }), 'Made executable');
  assert.equal(modeChangeLabel({ oldMode: '100755', newMode: '100644' }), 'No longer executable');
  assert.equal(modeChangeLabel({ oldMode: '100644', newMode: '120000' }), 'Became a symlink');
  assert.equal(modeChangeLabel({ oldMode: '120000', newMode: '100644' }), 'No longer a symlink');
});

test('the mode-change fixture reads as words', () => {
  const [file] = parseDiff(fx('mode-change')).files;
  assert.deepEqual([file.oldMode, file.newMode], ['100644', '100755']);
  assert.equal(modeChangeLabel(file), 'Made executable');
});

test('an unfamiliar pair falls back to the raw modes rather than lying', () => {
  assert.equal(modeChangeLabel({ oldMode: '100644', newMode: '160000' }), 'Mode 100644 → 160000');
  assert.equal(modeChangeLabel({ oldMode: '100755', newMode: '120000' }), 'Mode 100755 → 120000');
});

test('no mode change means nothing to say', () => {
  assert.equal(modeChangeLabel({ oldMode: '100644', newMode: '100644' }), null);
  assert.equal(modeChangeLabel({ oldMode: '100644' }), null);
  assert.equal(modeChangeLabel({ newMode: '100755' }), null);
  assert.equal(modeChangeLabel({}), null);
  const [added] = parseDiff(fx('added-untracked')).files;
  assert.equal(modeChangeLabel(added), null, 'a new file is not a permission change');
});
