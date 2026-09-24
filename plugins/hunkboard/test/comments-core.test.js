import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createThread,
  addReply,
  threadAnchor,
  applyResolutions,
  openThreads,
  formatPrompt,
} from '../src/comments-core.js';

const T0 = '2026-09-07T01:00:00.000Z';
const T1 = '2026-09-07T01:05:00.000Z';

const base = () =>
  createThread({
    id: 'thr-1',
    filePath: 'src/modify.txt',
    side: 'new',
    line: 2,
    body: 'Rename this variable.',
    author: 'bocheng',
    codeSnapshot: 'beta modified',
    now: T0,
  });

test('createThread produces a schema-shaped thread with one message', () => {
  const t = base();
  assert.equal(t.id, 'thr-1');
  assert.equal(t.filePath, 'src/modify.txt');
  assert.deepEqual(t.position, { side: 'new', line: 2 });
  assert.equal(t.codeSnapshot, 'beta modified');
  assert.equal(t.createdAt, T0);
  assert.equal(t.updatedAt, T0);
  assert.equal(t.messages.length, 1);
  assert.deepEqual(Object.keys(t.messages[0]).sort(), ['author', 'body', 'createdAt', 'id']);
  assert.equal(t.messages[0].author, 'bocheng');
  assert.equal(t.messages[0].body, 'Rename this variable.');
  assert.equal(t.messages[0].createdAt, T0);
  assert.deepEqual(Object.keys(t).sort(), ['codeSnapshot', 'createdAt', 'filePath', 'id', 'messages', 'position', 'updatedAt']);
});

test('createThread without an explicit id generates distinct non-empty ids', () => {
  const opts = { filePath: 'a', side: 'new', line: 1, body: 'x', author: 'u', now: T0 };
  const a = createThread(opts);
  const b = createThread(opts);
  assert.equal(typeof a.id, 'string');
  assert.ok(a.id.length > 0);
  assert.notEqual(a.id, b.id);
  assert.equal(a.codeSnapshot, undefined);
  assert.equal(Object.hasOwn(a, 'codeSnapshot'), false);
});

test('createThread accepts a range and rejects an invalid side', () => {
  const t = createThread({ filePath: 'a', side: 'old', line: { start: 3, end: 6 }, body: 'x', author: 'u', now: T0 });
  assert.deepEqual(t.position, { side: 'old', line: { start: 3, end: 6 } });
  assert.throws(() => createThread({ filePath: 'a', side: 'left', line: 1, body: 'x', author: 'u', now: T0 }), /side/);
  assert.throws(() => createThread({ filePath: 'a', side: 'new', line: 1, body: '', author: 'u', now: T0 }), /body/);
});

test('addReply appends a message and bumps updatedAt without mutating the input', () => {
  const t = base();
  const t2 = addReply(t, { body: 'Done, renamed to gammaValue.', author: 'codex', now: T1 });
  assert.equal(t.messages.length, 1);
  assert.equal(t.updatedAt, T0);
  assert.equal(t2.messages.length, 2);
  assert.equal(t2.messages[1].body, 'Done, renamed to gammaValue.');
  assert.equal(t2.updatedAt, T1);
  assert.notEqual(t2.messages[1].id, t2.messages[0].id);
});

test('threadAnchor is a stable key: path, side and first line', () => {
  assert.equal(threadAnchor(base()), 'src/modify.txt:new:2');
  const r = createThread({ filePath: 'dir with space/f.txt', side: 'old', line: { start: 3, end: 6 }, body: 'x', author: 'u', now: T0 });
  assert.equal(threadAnchor(r), 'dir with space/f.txt:old:3');
});

test('applyResolutions attaches the matching resolution or null, latest wins', () => {
  const t = base();
  const other = createThread({ id: 'thr-2', filePath: 'b', side: 'new', line: 1, body: 'y', author: 'u', now: T0 });
  const resolutions = {
    version: 1,
    updatedAt: T1,
    resolutions: [
      { threadId: 'thr-1', status: 'needs-info', note: 'Which name?', by: 'codex', at: T0 },
      { threadId: 'thr-1', status: 'resolved', note: 'Renamed.', by: 'codex', at: T1 },
      { threadId: 'ghost', status: 'resolved', by: 'codex', at: T1 },
    ],
  };
  const out = applyResolutions([t, other], resolutions);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].resolution, { threadId: 'thr-1', status: 'resolved', note: 'Renamed.', by: 'codex', at: T1 });
  assert.equal(out[1].resolution, null);
  assert.equal(Object.hasOwn(t, 'resolution'), false, 'input thread must not be mutated');
});

test('applyResolutions tolerates a missing or empty resolutions document', () => {
  const t = base();
  assert.equal(applyResolutions([t], null)[0].resolution, null);
  assert.equal(applyResolutions([t], undefined)[0].resolution, null);
  assert.equal(applyResolutions([t], { version: 1, updatedAt: T0, resolutions: [] })[0].resolution, null);
});

test('openThreads keeps unresolved and needs-info threads, drops resolved and wontfix', () => {
  const mk = (id) => createThread({ id, filePath: 'f', side: 'new', line: 1, body: 'b', author: 'u', now: T0 });
  const threads = applyResolutions([mk('a'), mk('b'), mk('c'), mk('d')], {
    version: 1,
    updatedAt: T0,
    resolutions: [
      { threadId: 'b', status: 'resolved', by: 'x', at: T0 },
      { threadId: 'c', status: 'wontfix', by: 'x', at: T0 },
      { threadId: 'd', status: 'needs-info', by: 'x', at: T0 },
    ],
  });
  assert.deepEqual(openThreads(threads).map((t) => t.id), ['a', 'd']);
});

test('formatPrompt renders one block per thread: location, snapshot, messages', () => {
  const t = addReply(base(), { body: 'Prefer gammaValue.', author: 'bocheng', now: T1 });
  const r = createThread({
    id: 'thr-2',
    filePath: 'src/multi.txt',
    side: 'old',
    line: { start: 14, end: 16 },
    body: 'These three lines can go.',
    author: 'bocheng',
    codeSnapshot: 'line14\nline15\nline16',
    now: T0,
  });
  const out = formatPrompt([t, r]);
  const expected = [
    'src/modify.txt:L2 (new) [thr-1]',
    '> beta modified',
    'bocheng: Rename this variable.',
    'bocheng: Prefer gammaValue.',
    '',
    'src/multi.txt:L14-L16 (old) [thr-2]',
    '> line14',
    '> line15',
    '> line16',
    'bocheng: These three lines can go.',
  ].join('\n');
  assert.equal(out, expected);
});

test('formatPrompt with no threads is an empty string; a thread without snapshot has no > lines', () => {
  assert.equal(formatPrompt([]), '');
  const t = createThread({ id: 'z', filePath: 'f', side: 'new', line: 1, body: 'b', author: 'u', now: T0 });
  assert.equal(formatPrompt([t]), 'f:L1 (new) [z]\nu: b');
});
