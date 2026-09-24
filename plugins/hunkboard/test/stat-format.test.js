import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDiff } from '../src/parser.js';
import { formatStat } from '../src/viewer-state.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}.diff`, import.meta.url), 'utf8');
const first = (name) => parseDiff(fx(name)).files[0];

test('a changed file renders both counts with a real minus sign, not a hyphen', () => {
  assert.deepEqual(formatStat(first('modify')), { additions: '+2', deletions: '−1' });
  assert.deepEqual(formatStat(first('multi-hunk')), { additions: '+2', deletions: '−2' });
  assert.equal(formatStat(first('modify')).deletions.charCodeAt(0), 0x2212);
});

test('one-sided changes still show the zero side, so the columns line up', () => {
  assert.deepEqual(formatStat(first('added-untracked')), { additions: '+2', deletions: '−0' });
  assert.deepEqual(formatStat(first('delete')), { additions: '+0', deletions: '−1' });
});

test('nothing to count renders nothing: binary, mode-only and pure renames return null', () => {
  assert.equal(formatStat(first('binary')), null);
  assert.equal(formatStat(first('mode-change')), null);
  assert.equal(formatStat(first('rename-pure')), null);
});

test('a directory node from the tree formats the same way as a file', () => {
  assert.deepEqual(formatStat({ additions: 9, deletions: 7 }), { additions: '+9', deletions: '−7' });
  assert.equal(formatStat({ additions: 0, deletions: 0 }), null);
  assert.equal(formatStat({}), null);
});

test('large counts are not abbreviated', () => {
  assert.deepEqual(formatStat({ additions: 1234, deletions: 56 }), { additions: '+1234', deletions: '−56' });
});
