import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// A long line of code wraps inside its cell, as on GitHub, instead of hiding most of itself
// behind a per-line horizontal scroll. Measured on a GitHub pull request, split view: a
// 467-character line wrapped to four lines, the row grew to 80px, and every cell in it —
// both line numbers and both code cells — filled all 80px with its colour, text at the top.
const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

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
      found.push({ selector, context: stack.join(' '), body: source.slice(i + 1, j - 1) });
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

const all = rules(css.replace(/\/\*[\s\S]*?\*\//g, ''));
const declarations = (rule) => Object.fromEntries(rule.body.split(';')
  .map((line) => line.split(':')).filter((pair) => pair.length >= 2)
  .map(([name, ...rest]) => [name.trim(), rest.join(':').trim()]));
const parts = (rule) => rule.selector.split(',').map((part) => part.trim());
const cascade = (selector) => Object.assign({}, ...all
  .filter((rule) => !rule.context && parts(rule).includes(selector)).map(declarations));
// Every rule, in any media or container query, whose selector list names this element.
const everywhere = (test) => all.filter((rule) => parts(rule).some(test))
  .map((rule) => ({ where: `${rule.context} ${rule.selector}`.trim(), ...declarations(rule) }));

test('a code cell wraps its text instead of scrolling it sideways', () => {
  const code = cascade('.hb-code');
  assert.equal(code['white-space'], 'pre-wrap', 'keep indentation, but wrap long lines');
  assert.match(code['overflow-wrap'] ?? '', /^(anywhere|break-word)$/,
    'a long token with no spaces must still break');
  assert.ok(!/auto|scroll/.test(code['overflow-x'] ?? ''), `no per-line scroll (${code['overflow-x']})`);
});

test('no media query turns wrapping back off for code cells', () => {
  for (const rule of everywhere((part) => /\.hb-code$/.test(part))) {
    assert.ok(!/^(pre|nowrap)$/.test(rule['white-space'] ?? ''), `${rule.where}: white-space ${rule['white-space']}`);
    assert.ok(!/auto|scroll/.test(rule['overflow-x'] ?? ''), `${rule.where}: overflow-x ${rule['overflow-x']}`);
  }
});

test('nothing in a diff row is pinned to one line height, so every cell grows with a wrapped line', () => {
  const pinned = everywhere((part) => /(^|\s|>)\.(code-row|gutter-cell|sign-cell|hb-code)(\.[\w-]+)*$/.test(part)
    || /\.gutter-cell(\.[\w-]+)* \.gutter$/.test(part))
    .filter((rule) => /^\d+(\.\d+)?px$/.test(rule['height'] ?? ''))
    .map((rule) => `${rule.where}: height ${rule['height']}`);
  assert.deepEqual(pinned, [], 'use min-height for the one-line minimum; a fixed height leaves the colour short');
});
