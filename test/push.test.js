import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = new URL('../bin/hunkboard-push', import.meta.url).pathname;

const run = (args, opts = {}) =>
  execFileSync('sh', [BIN, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

function outDir(doc) {
  const dir = mkdtempSync(join(tmpdir(), 'hunkboard-push-'));
  writeFileSync(join(dir, 'diff.json'), JSON.stringify(doc));
  return dir;
}

const DOC = {
  version: 1, repo: 'demo', branch: 'feat/x', base: 'HEAD', baseCommit: 'a'.repeat(40),
  generatedAt: '2026-09-07T00:00:00Z', generator: 'test', rawDiff: '', files: {},
};

test('dry run prints the exact commands, one per line, and executes nothing', () => {
  chmodSync(BIN, 0o755);
  const dir = outDir(DOC);
  const out = run(['--from', dir, '--remote', 'box', '--root', '/srv/hunkboard', '--dry-run']);
  assert.deepEqual(out.trimEnd().split('\n'), [
    `ssh box mkdir -p /srv/hunkboard/demo/feat-x`,
    `scp -q ${dir}/diff.json box:/srv/hunkboard/demo/feat-x/diff.json`,
  ]);
  rmSync(dir, { recursive: true, force: true });
});

test('branch slug: every "/" becomes "-" so the namespace is exactly two path segments', () => {
  const dir = outDir({ ...DOC, repo: 'my repo', branch: 'release/2026/09' });
  const out = run(['--from', dir, '--remote', 'box', '--root', '/srv/hb', '--dry-run']);
  assert.match(out, /mkdir -p '\/srv\/hb\/my repo\/release-2026-09'$/m);
  assert.match(out, /box:'\/srv\/hb\/my repo\/release-2026-09\/diff\.json'$/m);
  rmSync(dir, { recursive: true, force: true });
});

test('--repo and --branch override what diff.json says', () => {
  const dir = outDir(DOC);
  const out = run(['--from', dir, '--remote', 'box', '--root', '/srv/hb', '--repo', 'other', '--branch', 'main', '--dry-run']);
  assert.match(out, /^ssh box mkdir -p \/srv\/hb\/other\/main$/m);
  rmSync(dir, { recursive: true, force: true });
});

test('resolutions.json is pushed when present, comments.json never is', () => {
  const dir = outDir(DOC);
  writeFileSync(join(dir, 'resolutions.json'), '{"version":1,"updatedAt":"2026-09-07T00:00:00Z","resolutions":[]}');
  writeFileSync(join(dir, 'comments.json'), '{"version":1,"updatedAt":"2026-09-07T00:00:00Z","threads":[]}');
  const out = run(['--from', dir, '--remote', 'box', '--root', '/srv/hb', '--dry-run']);
  assert.match(out, new RegExp(`^scp -q ${dir}/resolutions\\.json box:/srv/hb/demo/feat-x/resolutions\\.json$`, 'm'));
  assert.doesNotMatch(out, /comments\.json/);
  rmSync(dir, { recursive: true, force: true });
});

test('--viewer also uploads the shared viewer to the root', () => {
  const dir = outDir(DOC);
  const viewer = join(dir, 'viewer.html');
  writeFileSync(viewer, '<!doctype html>');
  const out = run(['--from', dir, '--remote', 'box', '--root', '/srv/hb', '--viewer', viewer, '--dry-run']);
  assert.match(out, new RegExp(`^scp -q ${viewer} box:/srv/hb/viewer\\.html$`, 'm'));
  rmSync(dir, { recursive: true, force: true });
});

test('environment variables HUNKBOARD_REMOTE and HUNKBOARD_ROOT stand in for the flags', () => {
  const dir = outDir(DOC);
  const out = run(['--from', dir, '--dry-run'], { env: { ...process.env, HUNKBOARD_REMOTE: 'envbox', HUNKBOARD_ROOT: '/var/www/hb' } });
  assert.match(out, /^ssh envbox mkdir -p \/var\/www\/hb\/demo\/feat-x$/m);
  rmSync(dir, { recursive: true, force: true });
});

test('missing remote, missing root, or missing diff.json fail with a message and non-zero exit', () => {
  const dir = outDir(DOC);
  const env = { ...process.env };
  delete env.HUNKBOARD_REMOTE;
  delete env.HUNKBOARD_ROOT;
  assert.throws(() => run(['--from', dir, '--root', '/x', '--dry-run'], { env }), (e) => e.status !== 0 && /remote/i.test(String(e.stderr)));
  assert.throws(() => run(['--from', dir, '--remote', 'b', '--dry-run'], { env }), (e) => e.status !== 0 && /root/i.test(String(e.stderr)));
  const empty = mkdtempSync(join(tmpdir(), 'hunkboard-empty-'));
  assert.throws(() => run(['--from', empty, '--remote', 'b', '--root', '/x', '--dry-run'], { env }), (e) => e.status !== 0 && /diff\.json/.test(String(e.stderr)));
  rmSync(dir, { recursive: true, force: true });
  rmSync(empty, { recursive: true, force: true });
});
