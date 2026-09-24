import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Measured on a GitHub pull request, scrolled into the middle of a 6767px file: the PR bar
// stays at the top (sticky, top 0), and right under it the file's own header stays too
// (sticky, top 58px, z-index 5) until the file ends and the next file's header takes over.
// Here the toolbar and the review-progress rule play the PR bar's part.
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

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
      found.push({ selectors: selector.split(',').map((x) => x.trim()), context: stack.join(' '),
        body: Object.fromEntries(source.slice(i + 1, j - 1).split(';').map((line) => line.split(':'))
          .filter((pair) => pair.length >= 2).map(([name, ...rest]) => [name.trim(), rest.join(':').trim()])) });
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
const all = rules(css);
const cascade = (selector, context = '') => Object.assign({}, ...all
  .filter((r) => r.context === context && r.selectors.includes(selector)).map((r) => r.body));
const px = (value) => Number.parseFloat(value);

test('a file header stays at the top while its file scrolls', () => {
  assert.equal(cascade('.file-header')['position'], 'sticky');
});

test('it sticks right under the toolbar and the progress rule, not under nothing or on top of them', () => {
  const toolbar = cascade('.toolbar');
  const progress = cascade('.review-progress');
  assert.equal(px(progress['top']), px(toolbar['height']), 'the progress rule sits under the toolbar');
  const expected = px(toolbar['height']) + px(progress['height']);
  assert.equal(px(cascade('.file-header')['top']), expected, `top should be ${expected}px`);
});

test('the bars above stay on top of a stuck header, and code scrolls under it, not over it', () => {
  const header = Number(cascade('.file-header')['z-index']);
  assert.ok(header >= 1, 'above the code rows');
  assert.ok(header < Number(cascade('.toolbar')['z-index']), 'below the toolbar');
  assert.ok(header < Number(cascade('.review-progress')['z-index']), 'below the progress rule');
  const bg = cascade('.file-header')['background'] ?? cascade('.file-header')['background-color'] ?? '';
  assert.ok(bg && !/transparent|none/.test(bg), `an opaque background, so code does not show through (${bg})`);
});

test('no ancestor of the header clips, which would silently turn sticky off', () => {
  for (const selector of ['.file', 'main', '.layout', '.diff-list']) {
    for (const rule of all.filter((r) => r.selectors.includes(selector))) {
      for (const property of ['overflow', 'overflow-x', 'overflow-y']) {
        const value = rule.body[property];
        assert.ok(value === undefined || value === 'visible',
          `${rule.context} ${selector} { ${property}: ${value} } would break the sticky header`.trim());
      }
    }
  }
});

test('the short-screen layout keeps its own offset under its shorter bars', () => {
  const compact = all.find((r) => r.context === "@media (max-height: 519px)" && r.selectors.includes('.toolbar'));
  const compactProgress = all.find((r) => r.context === "@media (max-height: 519px)" && r.selectors.includes('.review-progress'));
  const compactHeader = all.find((r) => r.context === "@media (max-height: 519px)" && r.selectors.includes('.file-header'));
  assert.ok(compact && compactProgress && compactHeader, 'the compact rules exist');
  assert.equal(px(compactHeader.body['top']), px(compact.body['height']) + px(compactProgress.body['height']));
});

test('the bars a stuck header sits under are opaque, so code does not show through them', () => {
  // The review-progress track was var(--border-muted), 70% opaque: harmless over the page,
  // but a 3px strip of code showed through it once a file header stuck right below it.
  const opaque = (value) => {
    const layers = String(value ?? '').split(/,(?![^(]*\))/).map((layer) => layer.trim());
    const base = layers.at(-1) ?? '';
    return /^var\(--(canvas|muted)\)$/.test(base) || /^#[0-9a-f]{6}$/i.test(base) || /^rgb\(/.test(base);
  };
  for (const selector of ['.toolbar', '.review-progress']) {
    const body = cascade(selector);
    const bg = body['background'] ?? body['background-color'];
    assert.ok(opaque(bg), `${selector} background must end in an opaque colour (${bg})`);
  }
});
