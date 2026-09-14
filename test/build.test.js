import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, mkdtempSync, mkdirSync, copyFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const root = new URL('../', import.meta.url);
test('build produces a self-contained viewer with all modules', () => {
  execFileSync('sh', ['bin/build'], { cwd: root });
  const output = new URL('dist/viewer.html', root);
  assert.ok(existsSync(output));
  const html = readFileSync(output, 'utf8');
  assert.doesNotMatch(html, /(?:src|href)="http/);
  for (const symbol of ['function parseDiff', 'function toSplitRows', 'function createThread', 'function resolveDataBase', 'hljs', 'Diff']) assert.ok(html.includes(symbol), symbol);
  assert.doesNotMatch(html, /^export /m);
  assert.ok(Buffer.byteLength(html) < 1.5 * 1024 * 1024);
});

test('build fails when source inputs are missing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hb-build-'));
  try {
    mkdirSync(join(dir, 'bin'));
    copyFileSync(new URL('bin/build', root), join(dir, 'bin/build'));
    const result = spawnSync('sh', ['bin/build'], { cwd: dir, encoding: 'utf8' });
    assert.notEqual(result.status, 0);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
