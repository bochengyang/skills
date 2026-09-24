import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createThread, threadAnchor, formatPrompt, openThreads } from '../src/comments-core.js';
import { threadFreshness, threadsEndingAt, commentColumns, fileThreads } from '../src/viewer-state.js';

// A thread can be about a whole file rather than a line: a binary, a deleted or renamed file,
// or "split this file in two". Its position is `{ scope: "file" }` — no side, no line — and
// it sits at the top of the file, above the first hunk, as on GitHub.
const T0 = '2026-09-24T01:00:00.000Z';
const fileThread = (over = {}) =>
  createThread({ id: 'f1', filePath: 'docs/logo.png', scope: 'file', body: 'Wrong logo.', author: 'u', now: T0, ...over });
const lineThread = () =>
  createThread({ id: 'l1', filePath: 'docs/logo.png', side: 'new', line: 1, body: 'x', author: 'u', now: T0 });

test('a file thread has a file-scoped position and nothing line-shaped', () => {
  const t = fileThread();
  assert.deepEqual(t.position, { scope: 'file' });
  assert.equal(t.codeSnapshot, undefined);
  assert.equal(t.messages[0].body, 'Wrong logo.');
});

test('a thread is either about a file or about lines, never both or neither', () => {
  assert.throws(() => createThread({ filePath: 'a', scope: 'file', side: 'new', line: 1, body: 'b', author: 'u' }));
  assert.throws(() => createThread({ filePath: 'a', scope: 'lines', body: 'b', author: 'u' }));
  assert.throws(() => createThread({ filePath: 'a', body: 'b', author: 'u' }));
  assert.throws(() => createThread({ filePath: 'a', scope: 'file', body: 'b', author: 'u', codeSnapshot: 'x' }));
  // Line threads are unchanged.
  assert.deepEqual(lineThread().position, { side: 'new', line: 1 });
});

test('a file thread has its own stable anchor, distinct from any line on that file', () => {
  assert.equal(threadAnchor(fileThread()), 'docs/logo.png:file');
  assert.notEqual(threadAnchor(fileThread()), threadAnchor(lineThread()));
});

test('a file thread is never placed on a line', () => {
  const threads = [fileThread(), lineThread()];
  assert.deepEqual(threadsEndingAt(threads, 'docs/logo.png', 'new', 1).map((t) => t.id), ['l1']);
  assert.deepEqual(threadsEndingAt([fileThread()], 'docs/logo.png', 'old', 1), []);
});

test('fileThreads picks the file-scoped threads of one path, in their original order', () => {
  const second = fileThread({ id: 'f2', body: 'And rename it.' });
  const other = fileThread({ id: 'f3', filePath: 'README.md' });
  assert.deepEqual(fileThreads([fileThread(), lineThread(), other, second], 'docs/logo.png').map((t) => t.id), ['f1', 'f2']);
  assert.deepEqual(fileThreads([], 'docs/logo.png'), []);
});

test('a file thread spans the full width of the diff in either layout', () => {
  // 'file' is explicit: an unknown or missing side still falls back to the new half
  // (test/comment-side.test.js), so a file thread must say what it is.
  assert.deepEqual(commentColumns('split', 'file'), { start: 1, span: 6 });
  assert.deepEqual(commentColumns('inline', 'file'), { start: 1, span: 4 });
  // Line threads keep their side.
  assert.deepEqual(commentColumns('split', 'old'), { start: 1, span: 3 });
  assert.deepEqual(commentColumns('split', 'new'), { start: 4, span: 3 });
});

test('a file thread is current while the file is in the diff, even with no text lines', () => {
  assert.equal(threadFreshness(fileThread(), []), 'current');
  assert.equal(threadFreshness(fileThread(), ['a', 'b']), 'current');
  assert.equal(threadFreshness(fileThread(), null), 'missing');
});

test('formatPrompt names a file thread by path and scope, with no line and no quoted code', () => {
  const out = formatPrompt([fileThread()]);
  assert.equal(out, 'docs/logo.png (file) [f1]\nu: Wrong logo.');
});

test('a file thread whose file left the diff is listed under Outdated, still without a line', () => {
  const out = formatPrompt([lineThread(), fileThread()], { freshness: (t) => (t.id === 'f1' ? 'missing' : 'current') });
  const [current, stale] = out.split('\n\n## ');
  assert.match(current, /^docs\/logo\.png:L1 \(new\) \[l1\]/);
  assert.match(stale, /docs\/logo\.png \(file\) \[f1\]\nu: Wrong logo\./);
});

test('file threads open and close like any other thread', () => {
  const resolved = { ...fileThread({ id: 'f9' }), resolved: { by: 'u', at: T0 } };
  assert.deepEqual(openThreads([fileThread(), resolved]).map((t) => t.id), ['f1']);
});

test('the schema accepts a file-scoped position and still requires side and line otherwise', () => {
  const schema = JSON.parse(readFileSync(new URL('../schema/comments.schema.json', import.meta.url), 'utf8'));
  const position = schema.$defs.position;
  const branches = position.oneOf ?? position.anyOf;
  assert.ok(Array.isArray(branches), 'position must allow more than one shape');
  const file = branches.find((b) => b.properties?.scope);
  assert.ok(file, 'one branch is the file scope');
  assert.deepEqual(file.required, ['scope']);
  assert.equal(file.properties.scope.const, 'file');
  assert.equal(file.additionalProperties, false, 'a file position carries nothing else');
  const lines = branches.find((b) => b.properties?.line);
  assert.deepEqual([...lines.required].sort(), ['line', 'side']);
});
