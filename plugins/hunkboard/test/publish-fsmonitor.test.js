import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BIN = new URL('../bin/hunkboard-publish', import.meta.url).pathname;
const sh = (cwd, cmd, args) =>
  execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });

// A core.fsmonitor hook that always answers "nothing changed". Real monitors say this too,
// for a moment, right after an agent has written files — which is exactly when a Stop hook
// publishes. Git trusts the answer and skips the content check, so a publisher that does not
// override the setting emits a diff with the modified files silently missing.
const LYING_HOOK = "#!/bin/sh\nprintf 'stale-token'\nprintf '\\0'\n";

function repoWithStaleMonitor() {
  const root = mkdtempSync(join(tmpdir(), 'hunkboard-fsm-'));
  const git = (...a) => sh(root, 'git', a);
  git('init', '-q', '-b', 'main');
  git('config', 'user.email', 't@example.com');
  git('config', 'user.name', 'tester');
  git('config', 'commit.gpgsign', 'false');
  mkdirSync(join(root, 'src'));
  writeFileSync(join(root, 'src/tracked.txt'), 'original\n');
  writeFileSync(join(root, 'src/binary.bin'), Buffer.from([0x00, 0x01, 0x02]));
  git('add', '-A');
  git('commit', '-qm', 'base');
  const hook = join(root, 'fsmonitor-hook.sh');
  writeFileSync(hook, LYING_HOOK);
  chmodSync(hook, 0o755);
  git('config', 'core.fsmonitor', hook);
  git('config', 'core.untrackedCache', 'true');
  return root;
}

function publish(root, args = []) {
  const out = mkdtempSync(join(tmpdir(), 'hunkboard-fsm-out-'));
  sh(root, 'sh', [BIN, '--out', out, ...args]);
  return JSON.parse(readFileSync(join(out, 'diff.json'), 'utf8'));
}

test('a stale filesystem monitor cannot hide a modified file from the published diff', () => {
  const root = repoWithStaleMonitor();
  writeFileSync(join(root, 'src/tracked.txt'), 'edited by the agent\n');
  const doc = publish(root);
  assert.match(doc.rawDiff, /^diff --git a\/src\/tracked\.txt b\/src\/tracked\.txt$/m);
  assert.match(doc.rawDiff, /^\+edited by the agent$/m);
  assert.deepEqual(doc.files['src/tracked.txt'], { old: 'original\n', new: 'edited by the agent\n' });
  rmSync(root, { recursive: true, force: true });
});

test('a stale monitor cannot hide a modified binary file either', () => {
  const root = repoWithStaleMonitor();
  writeFileSync(join(root, 'src/binary.bin'), Buffer.from([0x00, 0x01, 0x03]));
  const doc = publish(root);
  assert.match(doc.rawDiff, /^diff --git a\/src\/binary\.bin b\/src\/binary\.bin$/m);
  assert.deepEqual(doc.files['src/binary.bin'], { old: null, new: null, binary: true });
  rmSync(root, { recursive: true, force: true });
});

test('a stale untracked cache cannot hide a new file from the published diff', () => {
  const root = repoWithStaleMonitor();
  writeFileSync(join(root, 'src/fresh.txt'), 'brand new\n');
  const doc = publish(root);
  assert.match(doc.rawDiff, /^diff --git a\/src\/fresh\.txt b\/src\/fresh\.txt$/m);
  assert.deepEqual(doc.files['src/fresh.txt'], { old: null, new: 'brand new\n' });
  rmSync(root, { recursive: true, force: true });
});

test('overriding the monitor still leaves the index and working tree untouched', () => {
  const root = repoWithStaleMonitor();
  writeFileSync(join(root, 'src/tracked.txt'), 'edited\n');
  writeFileSync(join(root, 'src/fresh.txt'), 'new\n');
  const before = sh(root, 'git', ['-c', 'core.fsmonitor=false', 'status', '--porcelain', '--untracked-files=all']);
  publish(root);
  const after = sh(root, 'git', ['-c', 'core.fsmonitor=false', 'status', '--porcelain', '--untracked-files=all']);
  assert.equal(after, before);
  assert.match(after, /^\?\? src\/fresh\.txt$/m);
  rmSync(root, { recursive: true, force: true });
});
