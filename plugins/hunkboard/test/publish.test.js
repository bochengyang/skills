import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync, existsSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = new URL('../bin/hunkboard-publish', import.meta.url).pathname;

const sh = (cwd, cmd, args, opts = {}) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

function makeRepo() {
  const root = mkdtempSync(join(tmpdir(), 'hunkboard-pub-'));
  const git = (...a) => sh(root, 'git', a);
  git('init', '-q', '-b', 'feat/demo');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'tester');
  git('config', 'commit.gpgsign', 'false');
  mkdirSync(join(root, 'src'));
  mkdirSync(join(root, 'docs'));
  writeFileSync(join(root, 'src/modify.txt'), 'alpha\nbeta\ngamma\n');
  writeFileSync(join(root, 'src/delete.txt'), 'to be deleted\n');
  writeFileSync(join(root, 'src/untouched.txt'), 'same\n');
  writeFileSync(join(root, 'docs/img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]));
  writeFileSync(join(root, '.gitignore'), 'ignored.log\n');
  git('add', '-A');
  git('commit', '-qm', 'base');
  return root;
}

function makeChanges(root) {
  writeFileSync(join(root, 'src/modify.txt'), 'alpha\nbeta modified\ngamma\ndelta added\n');
  rmSync(join(root, 'src/delete.txt'));
  writeFileSync(join(root, 'src/added.txt'), 'brand new file\nsecond\n');
  writeFileSync(join(root, 'ignored.log'), 'noise\n');
  writeFileSync(join(root, 'docs/img.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x02]));
}

function publish(root, args = []) {
  const out = mkdtempSync(join(tmpdir(), 'hunkboard-out-'));
  const stdout = sh(root, 'sh', [BIN, '--out', out, ...args]);
  return { out, stdout, doc: JSON.parse(readFileSync(join(out, 'diff.json'), 'utf8')) };
}

let root;
before(() => {
  root = makeRepo();
  chmodSync(BIN, 0o755);
});
after(() => rmSync(root, { recursive: true, force: true }));

test('a clean tree publishes an empty diff with metadata', () => {
  const { doc } = publish(root, ['--repo', 'demo', '--branch', 'feat/demo']);
  assert.equal(doc.version, 1);
  assert.equal(doc.repo, 'demo');
  assert.equal(doc.branch, 'feat/demo');
  assert.equal(doc.base, 'HEAD');
  assert.equal(doc.rawDiff, '');
  assert.deepEqual(doc.files, {});
  assert.match(doc.generatedAt, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
  assert.match(doc.baseCommit, /^[0-9a-f]{40}$/);
  assert.equal(doc.baseCommit, sh(root, 'git', ['rev-parse', 'HEAD']).trim());
  assert.match(doc.generator, /^hunkboard-publish\//);
});

test('repo and branch default to the toplevel basename and the current branch', () => {
  const { doc } = publish(root);
  assert.equal(doc.repo, root.split('/').pop());
  assert.equal(doc.branch, 'feat/demo');
});

test('modified, deleted, untracked and binary files land in rawDiff and files', () => {
  makeChanges(root);
  const { doc } = publish(root);
  assert.match(doc.rawDiff, /^diff --git a\/docs\/img\.png b\/docs\/img\.png$/m);
  assert.match(doc.rawDiff, /^diff --git a\/src\/added\.txt b\/src\/added\.txt$/m);
  assert.match(doc.rawDiff, /^new file mode 100644$/m);
  assert.match(doc.rawDiff, /^\+delta added$/m);
  assert.doesNotMatch(doc.rawDiff, /ignored\.log/, '.gitignore is honoured for untracked files');
  assert.doesNotMatch(doc.rawDiff, /untouched\.txt/);

  assert.deepEqual(doc.files['src/modify.txt'], { old: 'alpha\nbeta\ngamma\n', new: 'alpha\nbeta modified\ngamma\ndelta added\n' });
  assert.deepEqual(doc.files['src/added.txt'], { old: null, new: 'brand new file\nsecond\n' });
  assert.deepEqual(doc.files['src/delete.txt'], { old: 'to be deleted\n', new: null });
  assert.deepEqual(doc.files['docs/img.png'], { old: null, new: null, binary: true });
  assert.equal(doc.files['src/untouched.txt'], undefined);
  assert.equal(doc.files['ignored.log'], undefined);
  assert.deepEqual(Object.keys(doc.files).sort(), ['docs/img.png', 'src/added.txt', 'src/delete.txt', 'src/modify.txt']);
});

test('publishing leaves the index and working tree exactly as they were', () => {
  const before = sh(root, 'git', ['status', '--porcelain', '--untracked-files=all']);
  publish(root);
  const after = sh(root, 'git', ['status', '--porcelain', '--untracked-files=all']);
  assert.equal(after, before);
  assert.match(after, /^\?\? src\/added\.txt$/m, 'untracked file must still be untracked, not intent-to-add');
});

test('--no-untracked leaves untracked files out entirely', () => {
  const { doc } = publish(root, ['--no-untracked']);
  assert.doesNotMatch(doc.rawDiff, /src\/added\.txt/);
  assert.equal(doc.files['src/added.txt'], undefined);
  assert.match(doc.rawDiff, /^\+delta added$/m);
});

test('--max-file-bytes truncates oversized text files but keeps their hunks', () => {
  const { doc } = publish(root, ['--max-file-bytes', '25']);
  assert.deepEqual(doc.files['src/modify.txt'], { old: null, new: null, truncated: true });
  assert.deepEqual(doc.files['src/added.txt'], { old: null, new: 'brand new file\nsecond\n' }, '22 bytes stays under the limit');
  assert.match(doc.rawDiff, /^\+delta added$/m);
});

test('--base diffs against another revision', () => {
  sh(root, 'git', ['add', 'src/modify.txt']);
  sh(root, 'git', ['commit', '-qm', 'second']);
  const { doc } = publish(root, ['--base', 'HEAD~1']);
  assert.equal(doc.base, 'HEAD~1');
  assert.equal(doc.baseCommit, sh(root, 'git', ['rev-parse', 'HEAD~1']).trim());
  assert.match(doc.rawDiff, /^\+delta added$/m);
  assert.deepEqual(doc.files['src/modify.txt'], { old: 'alpha\nbeta\ngamma\n', new: 'alpha\nbeta modified\ngamma\ndelta added\n' });
});

test('output is written as diff.json only; no comments.json or resolutions.json are created', () => {
  const { out } = publish(root);
  assert.equal(existsSync(join(out, 'diff.json')), true);
  assert.equal(existsSync(join(out, 'comments.json')), false);
  assert.equal(existsSync(join(out, 'resolutions.json')), false);
});

test('stdout is the absolute path of the written diff.json', () => {
  const { out, stdout } = publish(root);
  assert.equal(stdout.trim(), join(out, 'diff.json'));
});

test('running outside a git repository fails with a non-zero exit and a message on stderr', () => {
  const dir = mkdtempSync(join(tmpdir(), 'hunkboard-nogit-'));
  const out = mkdtempSync(join(tmpdir(), 'hunkboard-out-'));
  assert.throws(
    () => sh(dir, 'sh', [BIN, '--out', out]),
    (err) => err.status !== 0 && /git/i.test(String(err.stderr)),
  );
  rmSync(dir, { recursive: true, force: true });
});
