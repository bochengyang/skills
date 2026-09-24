import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Measured on a GitHub pull request: the path in a diff file header is a <code> in
// Monaspace Neon, 12px/18px, weight 400, and the header is 42px tall with 6px 8px padding.
// (The sidebar tree is Mona Sans; only the header path is monospace.)
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

// Parse with nesting tracked, and keep only top-level rules: a media or container query
// may override these values for its own case, which is not what these tests pin.
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
const blocks = rules(css);
const cascade = (selector) => Object.assign({}, ...blocks
  .filter((b) => !b.context && b.selectors.includes(selector)).map((b) => b.body));

const monoFamily = () => {
  const root = cascade(':root');
  const path = cascade('.file-path strong');
  const family = path['font-family'] ?? path['font'] ?? '';
  if (family.includes('Monaspace Neon')) return family;
  if (family.includes('var(--font-mono)')) return root['--font-mono'] ?? '';
  return family;
};

test('the header path is set in the code face, Monaspace Neon', () => {
  assert.match(monoFamily(), /^"Monaspace Neon"/, 'Monaspace Neon first, with the monospace fallbacks after it');
  assert.match(monoFamily(), /monospace$/);
});

test('the header path is 12px on an 18px line, regular weight', () => {
  const path = cascade('.file-path strong');
  const font = path['font'] ?? '';
  const size = path['font-size'] ?? font.match(/(\d+px)\//)?.[1];
  const line = path['line-height'] ?? font.match(/\/(\d+px)/)?.[1];
  const weight = path['font-weight'] ?? font.match(/^(\d{3})\s/)?.[1];
  assert.equal(size, '12px');
  assert.equal(line, '18px');
  assert.equal(weight, '400');
});

test('the file header uses GitHub\'s padding', () => {
  assert.equal(cascade('.file-header')['padding'], '6px 8px');
});

test('the sidebar tree keeps its own sans face', () => {
  const tree = blocks.filter((b) => b.selectors.some((s) => /^\.tree-(file|name|dir)/.test(s)))
    .map((b) => b.body['font'] ?? b.body['font-family'] ?? '').filter(Boolean);
  for (const font of tree) assert.doesNotMatch(font, /Monaspace|--font-mono/, font);
});
