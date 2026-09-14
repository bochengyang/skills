import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDiff } from '../src/parser.js';
import { createThread } from '../src/comments-core.js';
import {
  resolveDataBase,
  hashString,
  fileContentHash,
  viewedKey,
  mergeThreads,
  buildCommentsDocument,
  threadsEndingAt,
  gapLines,
  pickLanguage,
  totals,
} from '../src/viewer-state.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}.diff`, import.meta.url), 'utf8');
const T0 = '2026-09-07T01:00:00.000Z';
const T1 = '2026-09-07T01:05:00.000Z';
const loc = (href) => {
  const u = new URL(href);
  return { href: u.href, pathname: u.pathname, search: u.search, origin: u.origin };
};

test('resolveDataBase: no ?ns → the directory the page was served from', () => {
  assert.equal(resolveDataBase(loc('https://h/demo/main/')), 'https://h/demo/main/');
  assert.equal(resolveDataBase(loc('https://h/demo/main/index.html')), 'https://h/demo/main/');
  assert.equal(resolveDataBase(loc('https://h/viewer.html')), 'https://h/');
});

test('resolveDataBase: ?ns=repo/branch is relative to the viewer location, always with a trailing slash', () => {
  assert.equal(resolveDataBase(loc('http://localhost:8000/viewer.html?ns=demo/main')), 'http://localhost:8000/demo/main/');
  assert.equal(resolveDataBase(loc('http://localhost:8000/viewer.html?ns=demo/main/')), 'http://localhost:8000/demo/main/');
  assert.equal(resolveDataBase(loc('http://localhost:8000/board/viewer.html?ns=./demo/main')), 'http://localhost:8000/board/demo/main/');
  assert.equal(resolveDataBase(loc('http://localhost:8000/viewer.html?ns=dir%20with%20space/feat-x')), 'http://localhost:8000/dir%20with%20space/feat-x/');
});

test('hashString is deterministic, 8 hex chars, and sensitive to input', () => {
  const a = hashString('alpha\nbeta');
  assert.match(a, /^[0-9a-f]{8}$/);
  assert.equal(a, hashString('alpha\nbeta'));
  assert.notEqual(a, hashString('alpha\nbeta '));
  assert.notEqual(hashString(''), hashString('0'));
});

test('fileContentHash changes when the hunks change, not when unrelated metadata does', () => {
  const [a] = parseDiff(fx('modify')).files;
  const [b] = parseDiff(fx('modify')).files;
  assert.equal(fileContentHash(a), fileContentHash(b));
  b.additions = 99;
  assert.equal(fileContentHash(a), fileContentHash(b), 'counts are derived, not content');
  const [c] = parseDiff(fx('multi-hunk')).files;
  assert.notEqual(fileContentHash(a), fileContentHash(c));
  const [bin] = parseDiff(fx('binary')).files;
  assert.match(fileContentHash(bin), /^[0-9a-f]{8}$/);
});

test('viewedKey namespaces by data base, path and content hash', () => {
  const k = viewedKey('https://h/demo/main/', 'src/modify.txt', 'abcd1234');
  assert.equal(k, 'hunkboard:viewed:https://h/demo/main/:src/modify.txt:abcd1234');
});

test('mergeThreads unions by id, newer updatedAt wins, ordered by createdAt', () => {
  const mk = (id, createdAt) => createThread({ id, filePath: 'f', side: 'new', line: 1, body: 'b', author: 'u', now: createdAt });
  const remoteOld = mk('x', T0);
  const localNewer = { ...mk('x', T0), updatedAt: T1, messages: [...remoteOld.messages, { id: 'm2', author: 'u', body: 'reply', createdAt: T1 }] };
  const onlyRemote = mk('r', '2026-09-07T00:30:00.000Z');
  const onlyLocal = mk('l', '2026-09-07T02:00:00.000Z');
  const merged = mergeThreads([remoteOld, onlyRemote], [localNewer, onlyLocal]);
  assert.deepEqual(merged.map((t) => t.id), ['r', 'x', 'l']);
  assert.equal(merged[1].messages.length, 2);
  assert.equal(mergeThreads([], []).length, 0);
  assert.equal(mergeThreads(null, [onlyLocal]).length, 1);
});

test('buildCommentsDocument matches comments.schema.json top level', () => {
  const t = createThread({ id: 'a', filePath: 'f', side: 'new', line: 1, body: 'b', author: 'u', now: T1 });
  const s = createThread({ id: 'b', filePath: 'f', side: 'new', line: 2, body: 'c', author: 'u', now: T0 });
  const doc = buildCommentsDocument([t, s], T1);
  assert.deepEqual(Object.keys(doc).sort(), ['threads', 'updatedAt', 'version']);
  assert.equal(doc.version, 1);
  assert.equal(doc.updatedAt, T1);
  assert.deepEqual(doc.threads.map((x) => x.id), ['b', 'a']);
  assert.equal(Object.hasOwn(doc.threads[0], 'resolution'), false, 'viewer-only fields never reach the wire');
});

test('threadsEndingAt anchors a range comment at its last line, on its own side only', () => {
  const single = createThread({ id: 's', filePath: 'f', side: 'new', line: 4, body: 'b', author: 'u', now: T0 });
  const range = createThread({ id: 'r', filePath: 'f', side: 'old', line: { start: 2, end: 4 }, body: 'b', author: 'u', now: T0 });
  const other = createThread({ id: 'o', filePath: 'g', side: 'new', line: 4, body: 'b', author: 'u', now: T0 });
  const all = [single, range, other];
  assert.deepEqual(threadsEndingAt(all, 'f', 'new', 4).map((t) => t.id), ['s']);
  assert.deepEqual(threadsEndingAt(all, 'f', 'old', 4).map((t) => t.id), ['r']);
  assert.deepEqual(threadsEndingAt(all, 'f', 'old', 2), []);
  assert.deepEqual(threadsEndingAt(all, 'g', 'new', 4).map((t) => t.id), ['o']);
});

test('gapLines builds context lines from full file content for the hidden region between hunks', () => {
  const text = 'a\nb\nc\nd\n';
  assert.deepEqual(gapLines(text, 2, 3, 5), [
    { type: 'context', content: 'b', oldLine: 5, newLine: 2 },
    { type: 'context', content: 'c', oldLine: 6, newLine: 3 },
  ]);
  assert.deepEqual(gapLines('x\ny', 1, 2, 1), [
    { type: 'context', content: 'x', oldLine: 1, newLine: 1 },
    { type: 'context', content: 'y', oldLine: 2, newLine: 2 },
  ]);
  assert.deepEqual(gapLines(text, 3, 2, 1), []);
  assert.deepEqual(gapLines(text, 4, 9, 4), [{ type: 'context', content: 'd', oldLine: 4, newLine: 4 }], 'clamps to the file end');
  assert.deepEqual(gapLines('r1\r\nr2\r\n', 1, 1, 1), [{ type: 'context', content: 'r1\r', oldLine: 1, newLine: 1 }]);
});

test('pickLanguage maps extensions and well-known filenames to highlight.js names', () => {
  assert.equal(pickLanguage('src/app.js'), 'javascript');
  assert.equal(pickLanguage('src/app.mjs'), 'javascript');
  assert.equal(pickLanguage('src/App.TSX'), 'typescript');
  assert.equal(pickLanguage('a/b.py'), 'python');
  assert.equal(pickLanguage('values.yaml'), 'yaml');
  assert.equal(pickLanguage('x.yml'), 'yaml');
  assert.equal(pickLanguage('package.json'), 'json');
  assert.equal(pickLanguage('bin/run.sh'), 'bash');
  assert.equal(pickLanguage('README.md'), 'markdown');
  assert.equal(pickLanguage('main.go'), 'go');
  assert.equal(pickLanguage('lib.rs'), 'rust');
  assert.equal(pickLanguage('style.css'), 'css');
  assert.equal(pickLanguage('index.html'), 'xml');
  assert.equal(pickLanguage('Dockerfile'), 'dockerfile');
  assert.equal(pickLanguage('deploy/Dockerfile.prod'), 'dockerfile');
  assert.equal(pickLanguage('Makefile'), 'makefile');
  assert.equal(pickLanguage('notes.txt'), null);
  assert.equal(pickLanguage('noext'), null);
});

test('totals sums files, additions and deletions', () => {
  const { files } = parseDiff(fx('combined'));
  assert.deepEqual(totals(files), { files: 10, additions: 10, deletions: 8 });
  assert.deepEqual(totals([]), { files: 0, additions: 0, deletions: 0 });
});
