import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// On a phone the file header used to keep everything on one row: toggle, path, +/− counts,
// the five-square meter, Viewed, comments and the overflow menu. At 390px wide everything but
// the path took about 280px, the path was left about 30px and, allowed to break anywhere,
// stood one character per line. On narrow screens the header wraps instead: the toggle and the
// path share the first row and everything else moves to the next one. Wide screens keep the
// single row.
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8')
  .replace(/\/\*[\s\S]*?\*\//g, '');

function rules(source) {
  const found = [];
  const stack = [];
  let i = 0;
  let head = '';
  while (i < source.length) {
    const c = source[i];
    if (c === '{') {
      const selector = head.trim();
      if (selector.startsWith('@')) { stack.push(selector); head = ''; i += 1; continue; }
      let depth = 1;
      let j = i + 1;
      while (j < source.length && depth > 0) {
        if (source[j] === '{') depth += 1;
        if (source[j] === '}') depth -= 1;
        j += 1;
      }
      found.push({ selector, context: [...stack], body: source.slice(i + 1, j - 1) });
      head = '';
      i = j;
      continue;
    }
    if (c === '}') { stack.pop(); head = ''; i += 1; continue; }
    head += c;
    i += 1;
  }
  return found;
}

// Does one media query list hold on this device? Handles the features style.css uses.
function holds(query, device) {
  return query.replace(/^@media\s*/, '').split(',').some((alternative) =>
    [...alternative.matchAll(/\(([^:)]+)(?::\s*([^)]+))?\)/g)].every(([, name, raw]) => {
      const feature = name.trim();
      const value = (raw ?? '').trim();
      const px = parseFloat(value);
      if (feature === 'max-width') return device.width <= px;
      if (feature === 'min-width') return device.width >= px;
      if (feature === 'max-height') return device.height <= px;
      if (feature === 'min-height') return device.height >= px;
      if (feature === 'pointer') return device.pointer === value;
      if (feature === 'prefers-color-scheme') return value === 'light';
      if (feature === 'prefers-reduced-motion') return false;
      throw new Error(`test does not understand media feature ${feature}`);
    }));
}

const all = rules(css);
const declarations = (rule) => Object.fromEntries(rule.body.split(';')
  .map((line) => line.split(':')).filter((pair) => pair.length >= 2)
  .map(([name, ...rest]) => [name.trim(), rest.join(':').trim()]));

// The declarations an element with exactly this selector ends up with on a device, in source
// order; container queries are left out (they depend on the element, not the viewport).
function computed(selector, device) {
  return Object.assign({}, ...all
    .filter((rule) => rule.selector.split(',').map((part) => part.trim()).includes(selector))
    .filter((rule) => rule.context.every((at) => at.startsWith('@media') && holds(at, device)))
    .map(declarations));
}

const flexBasis = (d) => d['flex-basis'] ?? (d.flex ?? '').split(/\s+(?![^(]*\))/)[2] ?? d.width;

const phone = { width: 390, height: 844, pointer: 'coarse' };
const narrowWindow = { width: 700, height: 900, pointer: 'fine' };
const desktop = { width: 1280, height: 800, pointer: 'fine' };
const landscapePhone = { width: 844, height: 390, pointer: 'coarse' };
const smallLandscapePhone = { width: 667, height: 375, pointer: 'coarse' };

for (const [name, device] of [['a 390px phone', phone], ['a 700px desktop window', narrowWindow]]) {
  test(`on ${name} the file header wraps onto a second row`, () => {
    assert.equal(computed('.file-header', device)['flex-wrap'], 'wrap');
  });

  test(`on ${name} the path claims the rest of the first row`, () => {
    const basis = flexBasis(computed('.file-path', device)) ?? '';
    assert.match(basis, /^(100%|calc\(100%\s*-\s*[^)]+\))$/,
      `the path must push the counters, meter and controls to the next row (got "${basis}")`);
  });
}

test('on a wide screen the header stays one row', () => {
  assert.notEqual(computed('.file-header', desktop)['flex-wrap'], 'wrap');
  assert.doesNotMatch(flexBasis(computed('.file-path', desktop)) ?? '', /100%/);
});

// max-height: 519px already gives landscape phones a single 24px row with an ellipsis. A small
// phone held sideways is both narrow and short; height is the scarcer of the two, so it wins.
for (const [name, device] of [['844×390', landscapePhone], ['667×375', smallLandscapePhone]]) {
  test(`a phone held sideways (${name}) keeps its short one-row header`, () => {
    assert.notEqual(computed('.file-header', device)['flex-wrap'], 'wrap');
    assert.equal(computed('.file-path', device)['white-space'], 'nowrap');
    assert.doesNotMatch(flexBasis(computed('.file-path', device)) ?? '', /100%/);
  });
}
