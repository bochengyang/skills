import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readingAnchor, scrollAfterToggle } from '../src/viewer-state.js';

// Folding or marking a file as viewed changes the page height above or below what the reader
// is looking at. Without care the view jumps: fold a 6000px file you are halfway through and
// you land 6000px further down. The rule, from the reviewer:
//   - fold the file you are reading (its header is stuck under the bars) and the next file
//     starts right under the bars;
//   - any other fold or unfold keeps what you are reading exactly where it was.
// `sections` are viewport rects in page order, as getBoundingClientRect() gives them.
const STICKY = 47;
const rect = (path, top, bottom) => ({ path, top, bottom });

test('the file being read is the first one still below the bars', () => {
  const sections = [rect('a.js', -900, -100), rect('b.js', -3000 + 2000, 2500), rect('c.js', 2516, 2700)];
  assert.deepEqual(readingAnchor(sections, STICKY), { path: 'b.js', offset: -1000 - STICKY });
});

test('a file whose top is on screen is the one being read, with a positive offset', () => {
  const sections = [rect('a.js', -900, 30), rect('b.js', 120, 900)];
  assert.deepEqual(readingAnchor(sections, STICKY), { path: 'b.js', offset: 120 - STICKY });
});

test('no file below the bars, or no files at all, gives no anchor', () => {
  assert.equal(readingAnchor([rect('a.js', -900, 20)], STICKY), null);
  assert.equal(readingAnchor([], STICKY), null);
});

// pageTops are document positions after the re-render: rect.top + scrollY.
const after = { 'a.js': 100, 'b.js': 900, 'c.js': 960, 'd.js': 1800 };
const order = ['a.js', 'b.js', 'c.js', 'd.js'];

test('folding the file you are reading puts the next file right under the bars', () => {
  const target = scrollAfterToggle({ anchor: { path: 'b.js', offset: -2000 }, toggled: 'b.js', folded: true, pageTops: after, order, stickyTop: STICKY });
  assert.equal(target, after['c.js'] - STICKY);
});

test('folding the last file you are reading leaves its header under the bars', () => {
  const target = scrollAfterToggle({ anchor: { path: 'd.js', offset: -500 }, toggled: 'd.js', folded: true, pageTops: after, order, stickyTop: STICKY });
  assert.equal(target, after['d.js'] - STICKY);
});

test('folding another file keeps the file you are reading where it was', () => {
  // You are 300px into c.js; a.js, above it, gets folded from the sidebar.
  const target = scrollAfterToggle({ anchor: { path: 'c.js', offset: -300 }, toggled: 'a.js', folded: true, pageTops: after, order, stickyTop: STICKY });
  assert.equal(target, after['c.js'] - STICKY + 300);
});

test('unfolding keeps what you are reading where it was, even for the file under the bars', () => {
  const target = scrollAfterToggle({ anchor: { path: 'b.js', offset: 40 }, toggled: 'b.js', folded: false, pageTops: after, order, stickyTop: STICKY });
  assert.equal(target, after['b.js'] - STICKY - 40);
});

test('folding a file whose header is not stuck (its top is on screen) keeps that header in place', () => {
  // Only a stuck header means the reader is inside the file; otherwise nothing should move.
  const target = scrollAfterToggle({ anchor: { path: 'b.js', offset: 200 }, toggled: 'b.js', folded: true, pageTops: after, order, stickyTop: STICKY });
  assert.equal(target, after['b.js'] - STICKY - 200);
});

test('a header exactly at the bars counts as the start of the file, not stuck inside it', () => {
  const target = scrollAfterToggle({ anchor: { path: 'b.js', offset: 0 }, toggled: 'b.js', folded: true, pageTops: after, order, stickyTop: STICKY });
  assert.equal(target, after['b.js'] - STICKY);
});

test('the target never goes above the top of the page', () => {
  const target = scrollAfterToggle({ anchor: { path: 'a.js', offset: 400 }, toggled: 'd.js', folded: true, pageTops: after, order, stickyTop: STICKY });
  assert.equal(target, 0);
});

test('no anchor, or an anchor that vanished from the page, means leave the scroll alone', () => {
  assert.equal(scrollAfterToggle({ anchor: null, toggled: 'a.js', folded: true, pageTops: after, order, stickyTop: STICKY }), null);
  assert.equal(scrollAfterToggle({ anchor: { path: 'gone.js', offset: 0 }, toggled: 'a.js', folded: true, pageTops: after, order, stickyTop: STICKY }), null);
});
