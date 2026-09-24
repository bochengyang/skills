import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wordHighlights } from '../src/viewer-state.js';

// `parts` is what jsdiff's diffWordsWithSpace returns for a deleted line paired with an
// added one: runs of text marked `removed`, `added`, or neither (common to both sides).
// Measured on a GitHub pull request, split view, 35 paired lines:
//   - lines whose tokens are mostly shared get an intraline highlight; lines that were
//     rewritten get none (every pair under 0.4 token similarity had no highlight, every
//     pair at 0.79 or above had one);
//   - a highlight is one continuous run per change, spaces included, never a chain of
//     word-sized blocks with gaps between them.
const same = (value) => ({ value });
const del = (value) => ({ value, removed: true });
const add = (value) => ({ value, added: true });
const text = (segments) => segments.map((s) => (s.changed ? `[${s.text}]` : s.text)).join('');

test('a one-word edit marks that word on each side and nothing else', () => {
  const h = wordHighlights([same('const total = '), del('price'), add('amount'), same(' * qty;')]);
  assert.equal(text(h.old), 'const total = [price] * qty;');
  assert.equal(text(h.new), 'const total = [amount] * qty;');
});

test('changed words separated only by spaces form one run, spaces included', () => {
  const h = wordHighlights([
    same('const label = format('), del('user'), add('account'), same(' '), del('name'), add('title'),
    same(', options, locale);'),
  ]);
  assert.equal(text(h.old), 'const label = format([user name], options, locale);');
  assert.equal(text(h.new), 'const label = format([account title], options, locale);');
});

test('changes separated by an unchanged word stay two runs', () => {
  const h = wordHighlights([
    same('let '), del('a'), add('x'), same(' = foo('), del('b'), add('y'), same(', c, d, e);'),
  ]);
  assert.equal(text(h.old), 'let [a] = foo([b], c, d, e);');
  assert.equal(text(h.new), 'let [x] = foo([y], c, d, e);');
});

test('a rewritten line gets no intraline highlight at all', () => {
  const h = wordHighlights([
    del('Static, agent-neutral, PR-style diff'), add('Review what your coding agent changed the way you'),
    same(' review '), del('for a working tree that has not been committed yet.'),
    add('a pull request, on your laptop or'),
  ]);
  assert.equal(h, null);
});

test('text added at the end of a line marks only the addition', () => {
  const h = wordHighlights([same('first line'), add(' changed')]);
  assert.equal(text(h.old), 'first line');
  assert.equal(text(h.new), 'first line[ changed]');
});

test('a whitespace-only change still highlights the whitespace', () => {
  const h = wordHighlights([del('  '), add('    '), same('foo();')]);
  assert.equal(text(h.old), '[  ]foo();');
  assert.equal(text(h.new), '[    ]foo();');
});

test('adjacent segments of the same kind are coalesced', () => {
  const h = wordHighlights([same('a'), same(' b'), del('c'), del('d'), add('e'), same(' f g h')]);
  assert.deepEqual(h.old, [
    { text: 'a b', changed: false }, { text: 'cd', changed: true }, { text: ' f g h', changed: false },
  ]);
});

test('empty or missing input yields no highlight rather than throwing', () => {
  assert.equal(wordHighlights([]), null);
  assert.equal(wordHighlights(null), null);
  assert.equal(wordHighlights([del(''), add('')]), null);
});
