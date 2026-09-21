import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = new URL('../bin/hunkboard-publish', import.meta.url).pathname;
const sh = (cwd, cmd, args) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// A review thread is anchored to a line of the published diff. If that diff is "working
// tree vs HEAD", the first commit on the branch empties it and every thread loses its
// anchor. A pull request diffs against the point where the branch left its base, so
// commits, amends and squashes on the branch leave the diff — and the threads — alone.
function repo({ defaultBranch = 'main', branch = 'feat/x', fork = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'hunkboard-base-'));
  const git = (...a) => sh(root, 'git', a);
  git('init', '-q', '-b', defaultBranch);
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'tester');
  git('config', 'commit.gpgsign', 'false');
  writeFileSync(join(root, 'a.txt'), 'one\ntwo\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  const mergeBase = git('rev-parse', 'HEAD').trim();
  if (fork) {
    git('checkout', '-qb', branch);
    writeFileSync(join(root, 'a.txt'), 'one\ntwo\nthree\n');
    git('commit', '-qam', 'committed on the branch');
    // Keep the base moving too: a stale merge-base would only show if main advanced.
    git('checkout', '-q', defaultBranch);
    writeFileSync(join(root, 'main-only.txt'), 'landed on main later\n');
    git('add', '-A');
    git('commit', '-qm', 'main moved on');
    git('checkout', '-q', branch);
  }
  writeFileSync(join(root, 'b.txt'), 'uncommitted\n');
  return { root, git, mergeBase };
}

function publish(root, args = []) {
  const out = mkdtempSync(join(tmpdir(), 'hunkboard-base-out-'));
  sh(root, 'sh', [BIN, '--out', out, ...args]);
  const doc = JSON.parse(readFileSync(join(out, 'diff.json'), 'utf8'));
  rmSync(out, { recursive: true, force: true });
  return doc;
}

test('on a branch, the default base is where the branch left main, not HEAD', () => {
  const { root, mergeBase } = repo();
  const doc = publish(root);
  assert.equal(doc.baseCommit, mergeBase);
  assert.match(doc.rawDiff, /^\+three$/m, 'the committed branch change is in the diff');
  assert.match(doc.rawDiff, /^\+uncommitted$/m, 'so is the working-tree change');
  assert.doesNotMatch(doc.rawDiff, /main-only/, 'what landed on main afterwards is not');
  rmSync(root, { recursive: true, force: true });
});

test('committing on the branch does not change the published diff', () => {
  const { root, git } = repo();
  const before = publish(root);
  git('add', '-A');
  git('commit', '-qm', 'commit the reviewed change');
  const after = publish(root);
  assert.equal(after.rawDiff, before.rawDiff);
  assert.equal(after.baseCommit, before.baseCommit);
  rmSync(root, { recursive: true, force: true });
});

test('an amend on the branch does not change the published diff either', () => {
  const { root, git } = repo();
  const before = publish(root);
  git('add', '-A');
  git('commit', '-q', '--amend', '--no-edit');
  const after = publish(root);
  assert.equal(after.rawDiff, before.rawDiff);
  assert.equal(after.baseCommit, before.baseCommit);
  rmSync(root, { recursive: true, force: true });
});

test('on the default branch itself the base stays HEAD', () => {
  const { root, git } = repo({ fork: false });
  const doc = publish(root);
  assert.equal(doc.baseCommit, git('rev-parse', 'HEAD').trim());
  assert.match(doc.rawDiff, /^\+uncommitted$/m);
  rmSync(root, { recursive: true, force: true });
});

test('master is recognised as the default branch when there is no main', () => {
  const { root, mergeBase } = repo({ defaultBranch: 'master' });
  assert.equal(publish(root).baseCommit, mergeBase);
  rmSync(root, { recursive: true, force: true });
});

test('with neither main nor master the base falls back to HEAD instead of failing', () => {
  const { root, git } = repo({ defaultBranch: 'trunk', fork: false });
  git('checkout', '-qb', 'feat/lonely');
  const doc = publish(root);
  assert.equal(doc.baseCommit, git('rev-parse', 'HEAD').trim());
  rmSync(root, { recursive: true, force: true });
});

test('an explicit --base still wins over the default', () => {
  const { root, git } = repo();
  const doc = publish(root, ['--base', 'HEAD']);
  assert.equal(doc.baseCommit, git('rev-parse', 'HEAD').trim());
  assert.doesNotMatch(doc.rawDiff, /^\+three$/m, 'the committed change is in HEAD, so not in the diff');
  assert.match(doc.rawDiff, /^\+uncommitted$/m);
  rmSync(root, { recursive: true, force: true });
});

test('the resolved base is recorded by name so a reader can tell how the diff was framed', () => {
  const { root } = repo();
  const doc = publish(root);
  assert.match(doc.base, /main/, `base should name the branch it was measured against, got ${doc.base}`);
  rmSync(root, { recursive: true, force: true });
});
