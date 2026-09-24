import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { headerIsStuck } from '../src/viewer-state.js';

// On GitHub a file header is rounded at rest and square while it is stuck under the top bar
// (the stuck header's corners would otherwise leave slivers of the code scrolling beneath).
// A header is stuck exactly when it sits lower than its natural place: the top edge of its
// file box plus that box's border. Arguments are viewport pixels (getBoundingClientRect().top).
test('a header in its natural place, at the top of its file, is not stuck', () => {
  assert.equal(headerIsStuck(300, 301, 1), false);
  assert.equal(headerIsStuck(-10, -9, 1), false, 'scrolled off the top without sticking is not stuck');
});

test('a header held below the top of its file is stuck', () => {
  assert.equal(headerIsStuck(-500, 47, 1), true);
  assert.equal(headerIsStuck(46, 47.5, 1), true, 'just past the point where it starts to stick');
});

test('a header being pushed out at the end of its file is still stuck', () => {
  // The file has scrolled far up; its bottom is pushing the header past the bar.
  assert.equal(headerIsStuck(-6000, 21, 1), true);
});

test('sub-pixel layout does not flicker the state at rest', () => {
  assert.equal(headerIsStuck(300.2, 301.4, 1), false);
  assert.equal(headerIsStuck(300, 300.9, 1), false);
});

test('missing or non-finite input is never stuck', () => {
  assert.equal(headerIsStuck(undefined, 47, 1), false);
  assert.equal(headerIsStuck(Number.NaN, 47, 1), false);
  assert.equal(headerIsStuck(-500, Number.NaN, 1), false);
});

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
// Top-level rules only, parsed with nesting tracked (a regex over the text either misses
// adjacent rules or picks up rules from inside media queries).
function topLevelRules(source) {
  const found = [];
  let depth = 0;
  let head = '';
  let body = '';
  let inAt = 0;
  for (const c of source) {
    if (c === '{') {
      if (depth === 0 && head.trim().startsWith('@')) { inAt = 1; depth = 1; head = ''; continue; }
      depth += 1;
      if (depth === 1 || (inAt && depth === 2)) { body = ''; continue; }
    } else if (c === '}') {
      depth -= 1;
      if (depth === 0 && !inAt) found.push({ selectors: head.split(',').map((x) => x.trim()), body });
      if (depth === 0) { inAt = 0; }
      head = '';
      continue;
    }
    if (depth === 0) head += c;
    else if (!inAt && depth === 1) body += c;
    else if (inAt && depth === 1) head += c;
  }
  return found;
}
const top = topLevelRules(css);
const radius = (selector) => {
  const found = top.filter((r) => r.selectors.includes(selector)).map((r) => r.body.match(/border-radius\s*:\s*([^;]+)/)?.[1]?.trim()).filter(Boolean);
  return found.at(-1);
};

test('a stuck header has square corners; at rest it keeps its rounded top', () => {
  assert.match(radius('.file-header.stuck') ?? '', /^0(px)?$/);
  assert.equal(radius('.file-header'), '6px 6px 0 0');
});
