import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDiff } from '../src/parser.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}.diff`, import.meta.url), 'utf8');

test('empty input yields no files', () => {
  assert.deepEqual(parseDiff(''), { files: [] });
  assert.deepEqual(parseDiff(fx('empty')), { files: [] });
});

test('modified file: paths, status, counts', () => {
  const { files } = parseDiff(fx('modify'));
  assert.equal(files.length, 1);
  const f = files[0];
  assert.equal(f.path, 'src/modify.txt');
  assert.equal(f.oldPath, 'src/modify.txt');
  assert.equal(f.newPath, 'src/modify.txt');
  assert.equal(f.status, 'modified');
  assert.equal(f.isBinary, false);
  assert.equal(f.additions, 2);
  assert.equal(f.deletions, 1);
  assert.equal(f.hunks.length, 1);
});

test('modified file: hunk range and per-line numbering', () => {
  const [f] = parseDiff(fx('modify')).files;
  const h = f.hunks[0];
  assert.deepEqual(
    { oldStart: h.oldStart, oldLines: h.oldLines, newStart: h.newStart, newLines: h.newLines },
    { oldStart: 1, oldLines: 3, newStart: 1, newLines: 4 },
  );
  assert.deepEqual(h.lines.map((l) => [l.type, l.content, l.oldLine, l.newLine]), [
    ['context', 'alpha', 1, 1],
    ['del', 'beta', 2, null],
    ['add', 'beta modified', null, 2],
    ['context', 'gamma', 3, 3],
    ['add', 'delta added', null, 4],
  ]);
});

test('multiple hunks: independent numbering and section text after @@', () => {
  const [f] = parseDiff(fx('multi-hunk')).files;
  assert.equal(f.hunks.length, 2);
  assert.equal(f.hunks[0].section, '');
  assert.equal(f.hunks[1].oldStart, 14);
  assert.equal(f.hunks[1].newStart, 14);
  assert.equal(f.hunks[1].section, 'line13');
  const changed = f.hunks[1].lines.find((l) => l.type === 'add');
  assert.deepEqual([changed.content, changed.oldLine, changed.newLine], ['line17 changed', null, 17]);
  assert.equal(f.additions, 2);
  assert.equal(f.deletions, 2);
});

test('deleted file', () => {
  const [f] = parseDiff(fx('delete')).files;
  assert.equal(f.status, 'deleted');
  assert.equal(f.path, 'src/delete.txt');
  assert.equal(f.oldPath, 'src/delete.txt');
  assert.equal(f.newPath, null);
  assert.equal(f.additions, 0);
  assert.equal(f.deletions, 1);
});

test('added file (from git add -N on an untracked file)', () => {
  const [f] = parseDiff(fx('added-untracked')).files;
  assert.equal(f.status, 'added');
  assert.equal(f.oldPath, null);
  assert.equal(f.newPath, 'src/added.txt');
  assert.equal(f.path, 'src/added.txt');
  assert.deepEqual(f.hunks[0].lines.map((l) => l.newLine), [1, 2]);
});

test('rename with modification: similarity, both paths, display path is the new one', () => {
  const [f] = parseDiff(fx('rename-modified')).files;
  assert.equal(f.status, 'renamed');
  assert.equal(f.oldPath, 'src/big.txt');
  assert.equal(f.newPath, 'src/renamed-big.txt');
  assert.equal(f.path, 'src/renamed-big.txt');
  assert.equal(f.similarity, 95);
  assert.equal(f.hunks.length, 1);
  assert.equal(f.hunks[0].section, 'renamed content line 11');
  assert.equal(f.additions, 1);
  assert.equal(f.deletions, 1);
});

test('pure rename has no hunks and 100% similarity', () => {
  const [f] = parseDiff(fx('rename-pure')).files;
  assert.equal(f.status, 'renamed');
  assert.equal(f.similarity, 100);
  assert.equal(f.oldPath, 'src/pure.txt');
  assert.equal(f.newPath, 'src/pure-renamed.txt');
  assert.deepEqual(f.hunks, []);
  assert.equal(f.additions, 0);
  assert.equal(f.deletions, 0);
});

test('binary file', () => {
  const [f] = parseDiff(fx('binary')).files;
  assert.equal(f.isBinary, true);
  assert.equal(f.path, 'docs/img.png');
  assert.equal(f.status, 'modified');
  assert.deepEqual(f.hunks, []);
});

test('mode change only', () => {
  const [f] = parseDiff(fx('mode-change')).files;
  assert.equal(f.path, 'bin.sh');
  assert.equal(f.oldMode, '100644');
  assert.equal(f.newMode, '100755');
  assert.equal(f.status, 'modified');
  assert.equal(f.isBinary, false);
  assert.deepEqual(f.hunks, []);
});

test('path with spaces: git appends a tab after the path on ---/+++ lines', () => {
  const [f] = parseDiff(fx('path-with-space')).files;
  assert.equal(f.path, 'dir with space/my file.txt');
  assert.equal(f.oldPath, 'dir with space/my file.txt');
  assert.equal(f.newPath, 'dir with space/my file.txt');
  assert.equal(f.hunks[0].lines[1].content, 'spaced file changed');
});

test('"\\ No newline at end of file" marks the preceding line instead of becoming a line', () => {
  const [f] = parseDiff(fx('no-newline-eof')).files;
  const lines = f.hunks[0].lines;
  assert.equal(lines.length, 2);
  assert.deepEqual(lines.map((l) => [l.type, l.noNewline === true]), [['del', true], ['add', true]]);
  assert.equal(lines[0].content, 'no newline at end');
  assert.equal(lines[1].content, 'no newline at end, changed');
});

test('CRLF content keeps the carriage return', () => {
  const [f] = parseDiff(fx('crlf')).files;
  const add = f.hunks[0].lines.find((l) => l.type === 'add');
  assert.equal(add.content, 'crlf line 2 changed\r');
  const ctx = f.hunks[0].lines[0];
  assert.equal(ctx.content, 'crlf line 1\r');
});

test('lines with no noNewline marker do not carry the property as true', () => {
  const [f] = parseDiff(fx('modify')).files;
  for (const l of f.hunks[0].lines) assert.notEqual(l.noNewline, true);
});

test('combined diff: every file in order with the right status and totals', () => {
  const { files } = parseDiff(fx('combined'));
  assert.deepEqual(files.map((f) => f.path), [
    'bin.sh',
    'dir with space/my file.txt',
    'docs/img.png',
    'src/added.txt',
    'src/crlf.txt',
    'src/delete.txt',
    'src/modify.txt',
    'src/multi.txt',
    'src/noeol.txt',
    'src/renamed-big.txt',
  ]);
  assert.deepEqual(files.map((f) => f.status), [
    'modified', 'modified', 'modified', 'added', 'modified',
    'deleted', 'modified', 'modified', 'modified', 'renamed',
  ]);
  const totals = files.reduce(
    (a, f) => ({ add: a.add + f.additions, del: a.del + f.deletions }),
    { add: 0, del: 0 },
  );
  assert.deepEqual(totals, { add: 10, del: 8 });
});

test('parser is pure: same input twice gives equal output, input untouched', () => {
  const text = fx('combined');
  assert.deepEqual(parseDiff(text), parseDiff(text));
  assert.equal(text, fx('combined'));
});
