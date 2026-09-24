import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The control that folds a file in the diff is GitHub's octicon chevron, not a text triangle:
// measured on a GitHub pull request, a 16x16 `octicon-chevron-down` when open and
// `octicon-chevron-right` when folded, muted grey, in a 28x28 borderless button, 6px radius.
const app = readFileSync(new URL('../src/app.js', import.meta.url), 'utf8');
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

const CHEVRON_DOWN = 'M12.78 5.22a.749.749 0 0 1 0 1.06l-4.25 4.25a.749.749 0 0 1-1.06 0L3.22 6.28a.749.749 0 1 1 1.06-1.06L8 8.939l3.72-3.719a.749.749 0 0 1 1.06 0Z';
const CHEVRON_RIGHT = 'M6.22 3.22a.75.75 0 0 1 1.06 0l4.25 4.25a.75.75 0 0 1 0 1.06l-4.25 4.25a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L9.94 8 6.22 4.28a.75.75 0 0 1 0-1.06Z';

test('the file toggle draws GitHub\'s two chevrons, path for path', () => {
  assert.ok(app.includes(CHEVRON_DOWN), 'octicon chevron-down path');
  assert.ok(app.includes(CHEVRON_RIGHT), 'octicon chevron-right path');
});

test('no text triangle is left standing in for the chevron', () => {
  assert.doesNotMatch(app, /[▸▾▶▼►]/u);
});

const rule = (selector) => {
  const found = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, head]) => head.split(',').map((s) => s.trim()).includes(selector));
  return Object.assign({}, ...found.map(([, , body]) => Object.fromEntries(body.split(';')
    .map((line) => line.split(':')).filter((pair) => pair.length >= 2)
    .map(([name, ...rest]) => [name.trim(), rest.join(':').trim()]))));
};

test('the toggle is a 28px square button with a 6px radius and no fill', () => {
  const toggle = rule('.file-toggle');
  assert.equal(toggle['width'], '28px');
  assert.equal(toggle['height'], '28px');
  assert.equal(toggle['border-radius'], '6px');
  assert.match(toggle['background'] ?? toggle['background-color'] ?? '', /^(transparent|none)$/);
});

test('the chevron itself is 16px and drawn in the muted foreground colour', () => {
  const icon = rule('.file-toggle svg');
  assert.equal(icon['width'], '16px');
  assert.equal(icon['height'], '16px');
  assert.equal(icon['fill'], 'var(--fg-muted)');
});
