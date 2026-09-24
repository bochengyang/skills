import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDiff } from '../src/parser.js';
import { statusMark } from '../src/viewer-state.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}.diff`, import.meta.url), 'utf8');
const first = (name) => parseDiff(fx(name)).files[0];

test('each git status maps to one letter and a spoken label', () => {
  assert.deepEqual(statusMark(first('modify')), { letter: 'M', label: 'Modified' });
  assert.deepEqual(statusMark(first('added-untracked')), { letter: 'A', label: 'Added' });
  assert.deepEqual(statusMark(first('delete')), { letter: 'D', label: 'Deleted' });
  assert.deepEqual(statusMark(first('rename-modified')), { letter: 'R', label: 'Renamed' });
  assert.deepEqual(statusMark(first('rename-pure')), { letter: 'R', label: 'Renamed' });
});

test('a binary file keeps its own status letter, not a separate one', () => {
  const binary = first('binary');
  assert.equal(binary.isBinary, true);
  assert.deepEqual(statusMark(binary), { letter: 'M', label: 'Modified' });
});

test('a mode-only change is still modified', () => {
  assert.deepEqual(statusMark(first('mode-change')), { letter: 'M', label: 'Modified' });
});

test('every file in the combined fixture gets a single uppercase letter', () => {
  const marks = parseDiff(fx('combined')).files.map(statusMark);
  assert.equal(marks.length, 10);
  for (const mark of marks) {
    assert.match(mark.letter, /^[MADR]$/);
    assert.match(mark.label, /^[A-Z][a-z]+$/);
  }
  assert.deepEqual(marks.map((m) => m.letter), ['M', 'M', 'M', 'A', 'M', 'D', 'M', 'M', 'M', 'R']);
});

test('an unknown status falls back to M rather than throwing', () => {
  assert.deepEqual(statusMark({ status: 'copied' }), { letter: 'M', label: 'Modified' });
  assert.deepEqual(statusMark({}), { letter: 'M', label: 'Modified' });
});
