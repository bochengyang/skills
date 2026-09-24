import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../src/style.css', import.meta.url), 'utf8');

// Rules keyed by selector, in source order, with their at-rule context.
function rules(source) {
  const found = [];
  const stack = [];
  let i = 0;
  let head = '';
  while (i < source.length) {
    const c = source[i];
    if (c === '{') {
      const selector = head.trim();
      if (selector.startsWith('@')) {
        stack.push(selector);
        head = '';
        i += 1;
        continue;
      }
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

const all = rules(css);
const matching = (test) => all.filter((rule) => rule.selector.split(',')
  .map((part) => part.trim()).some(test));
const declarations = (rule) => Object.fromEntries(rule.body.split(';')
  .map((line) => line.split(':')).filter((pair) => pair.length >= 2)
  .map(([name, ...rest]) => [name.trim(), rest.join(':').trim()]));

// Everything an unconditional selector ends up with, later rules winning, as the cascade does.
const cascade = (selector) => Object.assign({}, ...matching((part) => part === selector)
  .filter((rule) => !rule.context).map(declarations));
const none = (value) => value === undefined || /^(0|none|transparent)/.test(value);

const ROWS = ['.message-header', '.composer-header', '.message', '.resolution',
  '.thread-summary', '.thread-footer', '.composer-footer'];
const inset = (value) => {
  const parts = String(value).trim().split(/\s+/);
  return parts.length === 1 ? parts[0] : (parts.length === 2 ? parts[1] : parts[3] ?? parts[1]);
};

test('a comment card draws its own chrome instead of a pseudo-element with hand-tuned offsets', () => {
  const pseudo = matching((s) => /^\.(message|composer)-header.*::before$/.test(s));
  assert.deepEqual(pseudo.map((rule) => `${rule.context} ${rule.selector}`.trim()), [],
    'the header strip must be a real background, so changing the card padding cannot shift it');
});

test('every row inside a comment card shares one horizontal inset', () => {
  const insets = new Map();
  for (const rule of all) {
    const declared = declarations(rule);
    const padding = declared['padding'] ?? declared['padding-left'];
    if (padding === undefined) continue;
    for (const part of rule.selector.split(',').map((s) => s.trim())) {
      const row = ROWS.find((name) => part === name || part.endsWith(name));
      if (!row) continue;
      const value = declared['padding-left'] ?? inset(padding);
      insets.set(`${rule.context} ${part}`.trim(), value);
    }
  }
  assert.ok(insets.size > 0, 'the comment rows must declare their own inset');
  assert.deepEqual([...new Set(insets.values())], ['16px'], JSON.stringify([...insets], null, 1));
});

test('the comment card itself adds no padding, so its rows can reach the border', () => {
  assert.equal(cascade('.thread')['padding'], '0');
  assert.equal(cascade('.comment-form')['padding'], '0');
});

test('a posted comment keeps its card, but no band is painted across its header', () => {
  const card = cascade('.thread');
  assert.match(card['border'] ?? '', /^1px solid/, 'the thread card is the bordered surface');
  const bar = cascade('.message-header');
  // Deliberately unlike GitHub: a tinted strip behind every author line reads as a shadow
  // stacked over the comment, and this board already spends its colour on the diff itself.
  assert.ok(none(bar['background'] ?? bar['background-color']),
    `no tint behind the author line (${bar['background'] ?? bar['background-color']})`);
  assert.ok(none(bar['border-bottom']), `and no rule under it (${bar['border-bottom']})`);
  assert.ok(!/-\d/.test(bar['margin'] ?? ''),
    `the header must not be pulled out with a negative margin (${bar['margin']})`);
});

test('nothing in a comment card casts a shadow', () => {
  const surfaces = ['.thread', '.comment-form', '.composer-box', '.message-header',
    '.composer-header', '.message', '.resolution', '.thread-summary', '.thread-footer',
    '.composer-footer'];
  for (const selector of surfaces) {
    const declared = cascade(selector)['box-shadow'];
    assert.ok(declared === undefined || declared === 'none', `${selector}: ${declared}`);
  }
});

test('the composer is GitHub-shaped: a bare title row, a bordered box, then the buttons', () => {
  const form = cascade('.comment-form');
  for (const property of ['border', 'background']) {
    assert.ok(none(form[property]),
      `.comment-form must not be a card of its own (${property}: ${form[property]})`);
  }
  const box = cascade('.composer-box');
  assert.ok(Object.keys(box).length, 'the textarea needs its own bordered box, as on GitHub');
  assert.match(box['border'] ?? '', /^1px solid/);
  const bar = cascade('.composer-header');
  assert.ok(none(bar['background']), 'the composer title row carries no tint');
  assert.ok(none(bar['border-bottom']), 'nor a rule under it');
});

test('the composer textarea carries no second border inside the box', () => {
  const textarea = cascade('.comment-form textarea');
  assert.ok(Object.keys(textarea).length, '.comment-form textarea must be styled');
  assert.ok(none(textarea['border']), `the box already draws the border (${textarea['border']})`);
});

test('comment text is set at the size GitHub uses, not at the size of the code grid', () => {
  assert.equal(cascade('.thread')['font-size'], '14px');
  assert.equal(cascade('.comment-form')['font-size'], '14px');
});

test('the avatar matches GitHub at 24px', () => {
  const avatar = cascade('.avatar');
  assert.equal(avatar['width'], '24px');
  assert.equal(avatar['height'], '24px');
});

test('no text field is left to the browser, whose default border is a light 3D bevel', () => {
  const field = (pattern) => Object.assign({}, ...all
    .filter((rule) => !rule.context && rule.selector.split(',')
      .some((part) => pattern.test(part.trim())))
    .map(declarations));
  for (const [name, pattern] of [['textarea', /(^|[\s>])textarea$/],
    ['input', /(^|[\s>])input(:not\([^)]*\))*$/]]) {
    const declared = field(pattern);
    assert.match(declared['border'] ?? '', /^1px solid/, `${name} must declare its own border`);
    assert.ok(declared['background'] ?? declared['background-color'],
      `${name} must declare its own background`);
    assert.equal(declared['appearance'], 'none',
      `${name} must opt out of the platform widget, or the bevel returns`);
  }
});
