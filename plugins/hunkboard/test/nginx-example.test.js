import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The viewer is redeployed in place, so a browser must revalidate it every time it opens a
// board. Without a Cache-Control header a browser may reuse a stale copy for a while
// (heuristic caching), and a reviewer keeps seeing the old viewer after an update. Every URL
// in the example config that answers with viewer.html has to say no-cache; the data files
// keep no-store. The matcher below follows nginx's rules for the locations this file uses:
// regex locations nested in /hunkboard/ are tried in order, the first match wins, and a URL no
// regex matches is served by /hunkboard/ itself.
const conf = readFileSync(new URL('../examples/nginx/hunkboard.conf', import.meta.url), 'utf8')
  .replace(/#.*$/gm, '');

function block(source, start) {
  let depth = 0;
  for (let i = source.indexOf('{', start); i < source.length; i += 1) {
    if (source[i] === '{') depth += 1;
    if (source[i] === '}' && --depth === 0) return source.slice(source.indexOf('{', start) + 1, i);
  }
  throw new Error('unbalanced braces');
}

const outerStart = conf.search(/location\s+\/hunkboard\/\s*\{/);
assert.ok(outerStart >= 0, 'example must have a location /hunkboard/ block');
const outer = block(conf, outerStart);

const nested = [];
let own = '';
for (let i = 0; i < outer.length;) {
  const at = outer.slice(i).search(/location\s+~\s+/);
  if (at < 0) { own += outer.slice(i); break; }
  own += outer.slice(i, i + at);
  const start = i + at;
  const pattern = outer.slice(start).match(/^location\s+~\s+(\S+)\s*\{/)[1];
  const body = block(outer, start);
  nested.push({ regex: new RegExp(pattern), body });
  i = outer.indexOf(body, start) + body.length + 1;
}

const served = (uri) => nested.find((l) => l.regex.test(uri))?.body ?? own;
const cacheControl = (body) => body.match(/add_header\s+Cache-Control\s+"([^"]+)"/)?.[1] ?? null;

for (const uri of ['/hunkboard/skills/main/', '/hunkboard/lighthouse/feat-74-quest/', '/hunkboard/viewer.html']) {
  test(`${uri} answers with the viewer and tells the browser to revalidate it`, () => {
    const body = served(uri);
    assert.ok(/viewer\.html|try_files\s+\$uri/.test(body), `${uri} should be served by a block that serves the viewer`);
    assert.match(cacheControl(body) ?? '', /\bno-(cache|store)\b/, `${uri} has no Cache-Control: no-cache`);
  });
}

test('board data files are still never cached', () => {
  for (const uri of ['/hunkboard/skills/main/diff.json', '/hunkboard/skills/main/resolutions.json',
    '/hunkboard/skills/main/comments.json']) {
    assert.equal(cacheControl(served(uri)), 'no-store', uri);
  }
});

test('comments.json is still the only writable path', () => {
  const comments = served('/hunkboard/skills/main/comments.json');
  assert.match(comments, /dav_methods\s+PUT/);
  assert.match(comments, /limit_except\s+GET\s+HEAD\s+PUT/);
  for (const uri of ['/hunkboard/skills/main/diff.json', '/hunkboard/skills/main/', '/hunkboard/viewer.html']) {
    assert.doesNotMatch(served(uri), /dav_methods/, `${uri} must not accept PUT`);
  }
});
