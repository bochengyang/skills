import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = new URL('../bin/hunkboard-publish', import.meta.url).pathname;
const sh = (cwd, cmd, args) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// Git only re-reads a file's content when its size or mtime differs from what the index
// recorded, or when the file looks "racily clean" — its mtime is not older than the index's
// own mtime. An edit that keeps the size and lands in the same timestamp tick as the last
// index write is exactly the racy case, and git handles it correctly on its own. A publisher
// that works from a *copy* of the index breaks that protection if the copy is stamped with
// the time of the copy: the index now looks newer than every file, so git trusts its cache
// and the edit is published as if it never happened.
const OLD = '202001010000';

function repoWithRacyEdit() {
  const root = mkdtempSync(join(tmpdir(), 'hunkboard-racy-'));
  const git = (...a) => sh(root, 'git', a);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'tester');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'a.txt'), 'aaa\n');
  writeFileSync(join(root, 'untouched.txt'), 'same\n');
  git('add', '-A');
  git('commit', '-qm', 'base');

  // Pin a.txt to a known old mtime and record that mtime in the index.
  sh(root, 'touch', ['-t', OLD, 'a.txt']);
  git('update-index', '--refresh');
  // Edit the content without changing size or mtime: the racy case.
  writeFileSync(join(root, 'a.txt'), 'zzz\n');
  sh(root, 'touch', ['-t', OLD, 'a.txt']);
  // The index is no newer than the file, so git must verify a.txt's content.
  sh(root, 'touch', ['-t', OLD, '.git/index']);
  return root;
}

function publish(root) {
  const out = mkdtempSync(join(tmpdir(), 'hunkboard-racy-out-'));
  sh(root, 'sh', [BIN, '--out', out]);
  return JSON.parse(readFileSync(join(out, 'diff.json'), 'utf8'));
}

test('a same-size edit in the racy window is published, not silently dropped', () => {
  const root = repoWithRacyEdit();
  const doc = publish(root);
  assert.match(doc.rawDiff, /^diff --git a\/a\.txt b\/a\.txt$/m);
  assert.match(doc.rawDiff, /^-aaa$/m);
  assert.match(doc.rawDiff, /^\+zzz$/m);
  assert.deepEqual(doc.files['a.txt'], { old: 'aaa\n', new: 'zzz\n' });
  rmSync(root, { recursive: true, force: true });
});

test('the racy edit does not drag unchanged files into the diff', () => {
  const root = repoWithRacyEdit();
  const doc = publish(root);
  assert.doesNotMatch(doc.rawDiff, /untouched\.txt/);
  assert.equal(doc.files['untouched.txt'], undefined);
  rmSync(root, { recursive: true, force: true });
});

test('publishing still leaves the index and working tree untouched in the racy case', () => {
  const root = repoWithRacyEdit();
  const before = sh(root, 'git', ['status', '--porcelain', '--untracked-files=all']);
  publish(root);
  const after = sh(root, 'git', ['status', '--porcelain', '--untracked-files=all']);
  assert.equal(after, before);
  rmSync(root, { recursive: true, force: true });
});
