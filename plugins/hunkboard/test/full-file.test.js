import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDiff } from '../src/parser.js';
import { fullFileLines, focusTarget } from '../src/viewer-state.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}.diff`, import.meta.url), 'utf8');
const shape = (lines) => lines.map((l) => [l.type, l.content, l.oldLine, l.newLine]);

test('fullFileLines: a modified file becomes one continuous list with every unchanged line as context', () => {
  const [file] = parseDiff(fx('modify')).files;
  const lines = fullFileLines(file, { old: 'alpha\nbeta\ngamma\n', new: 'alpha\nbeta modified\ngamma\ndelta added\n' });
  assert.deepEqual(shape(lines), [
    ['context', 'alpha', 1, 1],
    ['del', 'beta', 2, null],
    ['add', 'beta modified', null, 2],
    ['context', 'gamma', 3, 3],
    ['add', 'delta added', null, 4],
  ]);
});

test('fullFileLines: lines before, between and after hunks are filled from the new content with both numbers', () => {
  const [file] = parseDiff(fx('multi-hunk')).files;
  const seq = (n) => Array.from({ length: n }, (_, i) => `line${i + 1}`);
  const oldText = seq(20).join('\n') + '\n';
  const newText = oldText.replace('line2\n', 'line2 changed\n').replace('line17\n', 'line17 changed\n');
  const lines = fullFileLines(file, { old: oldText, new: newText });
  assert.equal(lines.length, 22, '20 lines + 2 extra del rows');
  assert.deepEqual(shape(lines).slice(0, 4), [
    ['context', 'line1', 1, 1],
    ['del', 'line2', 2, null],
    ['add', 'line2 changed', null, 2],
    ['context', 'line3', 3, 3],
  ]);
  assert.deepEqual(shape(lines)[12], ['context', 'line12', 12, 12], 'gap between hunks is context');
  assert.deepEqual(shape(lines).slice(-2), [
    ['context', 'line19', 19, 19],
    ['context', 'line20', 20, 20],
  ]);
  const changed = lines.filter((l) => l.type !== 'context');
  assert.deepEqual(changed.map((l) => l.content), ['line2', 'line2 changed', 'line17', 'line17 changed']);
});

test('fullFileLines: hunk line objects are reused by reference so comments and word-diff pairing still apply', () => {
  const [file] = parseDiff(fx('modify')).files;
  const lines = fullFileLines(file, { old: 'alpha\nbeta\ngamma\n', new: 'alpha\nbeta modified\ngamma\ndelta added\n' });
  assert.equal(lines[1], file.hunks[0].lines[1]);
  assert.equal(lines[2], file.hunks[0].lines[2]);
});

test('fullFileLines: added and deleted files come straight from the hunk', () => {
  const [added] = parseDiff(fx('added-untracked')).files;
  assert.deepEqual(shape(fullFileLines(added, { old: null, new: 'brand new file\nsecond\n' })), [
    ['add', 'brand new file', null, 1],
    ['add', 'second', null, 2],
  ]);
  const [deleted] = parseDiff(fx('delete')).files;
  assert.deepEqual(shape(fullFileLines(deleted, { old: 'to be deleted\n', new: null })), [
    ['del', 'to be deleted', 1, null],
  ]);
});

test('fullFileLines: trailing context past the last hunk is appended even without a trailing newline', () => {
  const [file] = parseDiff(fx('modify')).files;
  const lines = fullFileLines(file, { old: 'alpha\nbeta\ngamma\nz1\nz2', new: 'alpha\nbeta modified\ngamma\ndelta added\nz1\nz2' });
  assert.deepEqual(shape(lines).slice(-2), [
    ['context', 'z1', 4, 5],
    ['context', 'z2', 5, 6],
  ]);
});

test('fullFileLines returns null when full content is unavailable, so the caller falls back to hunks', () => {
  const [file] = parseDiff(fx('modify')).files;
  assert.equal(fullFileLines(file, undefined), null);
  assert.equal(fullFileLines(file, { old: null, new: null, truncated: true }), null);
  assert.equal(fullFileLines(file, { old: null, new: null, binary: true }), null);
  const [bin] = parseDiff(fx('binary')).files;
  assert.equal(fullFileLines(bin, { old: null, new: null, binary: true }), null);
});

test('fullFileLines: a mode-only change with content shows the whole file as context', () => {
  const [file] = parseDiff(fx('mode-change')).files;
  const lines = fullFileLines(file, { old: '#!/bin/sh\necho hi\n', new: '#!/bin/sh\necho hi\n' });
  assert.deepEqual(shape(lines), [
    ['context', '#!/bin/sh', 1, 1],
    ['context', 'echo hi', 2, 2],
  ]);
});

test('focusTarget reads and writes the #file= hash', () => {
  assert.equal(focusTarget('#file=src/modify.txt'), 'src/modify.txt');
  assert.equal(focusTarget('#file=dir%20with%20space%2Fmy%20file.txt'), 'dir with space/my file.txt');
  assert.equal(focusTarget('#file='), null);
  assert.equal(focusTarget('#file-3'), null);
  assert.equal(focusTarget(''), null);
  assert.equal(focusTarget(undefined), null);
  assert.equal(focusTarget.toHash('dir with space/my file.txt'), '#file=dir%20with%20space%2Fmy%20file.txt');
  assert.equal(focusTarget.toHash(null), '');
});
