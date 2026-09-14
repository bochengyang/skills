import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createThread,
  resolveThread,
  unresolveThread,
  threadState,
  openThreads,
  applyResolutions,
} from '../src/comments-core.js';
import { formatRelativeTime, avatarLetter, buildCommentsDocument } from '../src/viewer-state.js';

const T0 = '2026-09-14T04:00:00.000Z';
const T1 = '2026-09-14T04:05:00.000Z';
const mk = (id = 't1') =>
  createThread({ id, filePath: 'f', side: 'new', line: 2, body: 'b', author: 'bocheng', now: T0 });

test('resolveThread stamps who and when, without mutating the input', () => {
  const t = mk();
  const r = resolveThread(t, { by: 'bocheng', now: T1 });
  assert.deepEqual(r.resolved, { by: 'bocheng', at: T1 });
  assert.equal(r.updatedAt, T1);
  assert.equal(Object.hasOwn(t, 'resolved'), false);
  assert.throws(() => resolveThread(t, { by: '', now: T1 }), /by/);
});

test('unresolveThread removes the stamp and bumps updatedAt', () => {
  const r = resolveThread(mk(), { by: 'bocheng', now: T1 });
  const u = unresolveThread(r, { now: '2026-09-14T04:06:00.000Z' });
  assert.equal(Object.hasOwn(u, 'resolved'), false);
  assert.equal(u.updatedAt, '2026-09-14T04:06:00.000Z');
  assert.deepEqual(r.resolved, { by: 'bocheng', at: T1 }, 'input untouched');
});

test('threadState: open unless the reviewer or the agent closed it', () => {
  const res = (status) => ({ version: 1, updatedAt: T1, resolutions: [{ threadId: 't1', status, by: 'agent', at: T1 }] });
  assert.equal(threadState(mk()), 'open');
  assert.equal(threadState(applyResolutions([mk()], null)[0]), 'open');
  assert.equal(threadState(resolveThread(mk(), { by: 'bocheng', now: T1 })), 'resolved');
  assert.equal(threadState(applyResolutions([mk()], res('resolved'))[0]), 'resolved');
  assert.equal(threadState(applyResolutions([mk()], res('wontfix'))[0]), 'wontfix');
  assert.equal(threadState(applyResolutions([mk()], res('needs-info'))[0]), 'needs-info');
  const both = applyResolutions([resolveThread(mk(), { by: 'bocheng', now: T1 })], res('needs-info'))[0];
  assert.equal(threadState(both), 'resolved', 'reviewer closing wins over an open question');
});

test('openThreads drops reviewer-resolved threads as well as agent-closed ones', () => {
  const a = mk('a');
  const b = resolveThread(mk('b'), { by: 'bocheng', now: T1 });
  const c = mk('c');
  const withRes = applyResolutions([a, b, c], { version: 1, updatedAt: T1, resolutions: [{ threadId: 'c', status: 'wontfix', by: 'agent', at: T1 }] });
  assert.deepEqual(openThreads(withRes).map((t) => t.id), ['a']);
  assert.deepEqual(openThreads([a, b, c]).map((t) => t.id), ['a', 'c'], 'works without applyResolutions too');
});

test('buildCommentsDocument keeps the reviewer resolved stamp on the wire', () => {
  const r = resolveThread(mk(), { by: 'bocheng', now: T1 });
  const doc = buildCommentsDocument([{ ...r, resolution: null }], T1);
  assert.deepEqual(doc.threads[0].resolved, { by: 'bocheng', at: T1 });
  assert.equal(Object.hasOwn(doc.threads[0], 'resolution'), false);
});

test('formatRelativeTime reads like GitHub and is deterministic given now', () => {
  const now = Date.parse('2026-09-14T12:00:00.000Z');
  const at = (ms) => new Date(now - ms).toISOString();
  assert.equal(formatRelativeTime(at(0), now), 'just now');
  assert.equal(formatRelativeTime(at(30 * 1000), now), 'just now');
  assert.equal(formatRelativeTime(at(60 * 1000), now), '1 minute ago');
  assert.equal(formatRelativeTime(at(3 * 60 * 1000), now), '3 minutes ago');
  assert.equal(formatRelativeTime(at(60 * 60 * 1000), now), '1 hour ago');
  assert.equal(formatRelativeTime(at(5 * 3600 * 1000), now), '5 hours ago');
  assert.equal(formatRelativeTime(at(24 * 3600 * 1000), now), 'yesterday');
  assert.equal(formatRelativeTime(at(3 * 24 * 3600 * 1000), now), '3 days ago');
  assert.equal(formatRelativeTime(at(20 * 24 * 3600 * 1000), now), 'on Aug 25');
  assert.equal(formatRelativeTime(at(400 * 24 * 3600 * 1000), now), 'on Aug 10, 2025');
  assert.equal(formatRelativeTime('not a date', now), '');
  assert.equal(formatRelativeTime(new Date(now + 5 * 60 * 1000).toISOString(), now), 'just now', 'clock skew never shows the future');
});

test('avatarLetter takes the first character, uppercased, with a fallback', () => {
  assert.equal(avatarLetter('bocheng'), 'B');
  assert.equal(avatarLetter('  ada '), 'A');
  assert.equal(avatarLetter('張三'), '張');
  assert.equal(avatarLetter('émile'), 'É');
  assert.equal(avatarLetter(''), '?');
  assert.equal(avatarLetter(undefined), '?');
});
