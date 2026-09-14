import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parseDiff } from '../src/parser.js';
import { buildFileTree } from '../src/viewer-state.js';

const fx = (name) => readFileSync(new URL(`./fixtures/${name}.diff`, import.meta.url), 'utf8');
const f = (path, additions = 0, deletions = 0) => ({ path, additions, deletions });

test('empty input gives an empty root', () => {
  assert.deepEqual(buildFileTree([]), { name: '', path: '', dirs: [], files: [], additions: 0, deletions: 0 });
});

test('root-level files stay on the root; directories are created on demand', () => {
  const tree = buildFileTree([f('README.md', 1, 0), f('src/a.js', 2, 1)]);
  assert.deepEqual(tree.files.map((x) => x.path), ['README.md']);
  assert.deepEqual(tree.dirs.map((d) => d.path), ['src']);
  assert.deepEqual(tree.dirs[0].files.map((x) => x.path), ['src/a.js']);
});

test('nested directories: each level is its own node with the full path', () => {
  const tree = buildFileTree([f('a/b/c.txt', 1, 0), f('a/d.txt', 0, 1)]);
  const a = tree.dirs[0];
  assert.deepEqual([a.name, a.path], ['a', 'a']);
  assert.deepEqual(a.dirs.map((d) => [d.name, d.path]), [['b', 'a/b']]);
  assert.deepEqual(a.dirs[0].files.map((x) => x.path), ['a/b/c.txt']);
  assert.deepEqual(a.files.map((x) => x.path), ['a/d.txt']);
});

test('additions and deletions roll up through every ancestor', () => {
  const tree = buildFileTree([f('a/b/c.txt', 3, 1), f('a/d.txt', 1, 2), f('e.txt', 5, 0)]);
  assert.deepEqual([tree.additions, tree.deletions], [9, 3]);
  const a = tree.dirs[0];
  assert.deepEqual([a.additions, a.deletions], [4, 3]);
  assert.deepEqual([a.dirs[0].additions, a.dirs[0].deletions], [3, 1]);
});

test('directories are sorted by name; files keep the order of the input (git already sorts)', () => {
  const tree = buildFileTree([f('zeta/x.txt'), f('alpha/y.txt'), f('alpha/b.txt'), f('alpha/a.txt')]);
  assert.deepEqual(tree.dirs.map((d) => d.name), ['alpha', 'zeta']);
  assert.deepEqual(tree.dirs[0].files.map((x) => x.path), ['alpha/y.txt', 'alpha/b.txt', 'alpha/a.txt']);
});

test('file entries are the original file objects, not copies', () => {
  const file = f('src/a.js', 1, 1);
  const tree = buildFileTree([file]);
  assert.equal(tree.dirs[0].files[0], file);
});

test('a directory name with spaces is preserved', () => {
  const tree = buildFileTree([f('dir with space/my file.txt', 1, 1)]);
  assert.deepEqual([tree.dirs[0].name, tree.dirs[0].path], ['dir with space', 'dir with space']);
  assert.equal(tree.dirs[0].files[0].path, 'dir with space/my file.txt');
});

test('the combined fixture builds the expected tree', () => {
  const tree = buildFileTree(parseDiff(fx('combined')).files);
  assert.deepEqual(tree.files.map((x) => x.path), ['bin.sh']);
  assert.deepEqual(tree.dirs.map((d) => d.name), ['dir with space', 'docs', 'src']);
  const src = tree.dirs[2];
  assert.equal(src.files.length, 7);
  assert.deepEqual([src.additions, src.deletions], [9, 7]);
  assert.deepEqual([tree.additions, tree.deletions], [10, 8]);
  assert.deepEqual(tree.dirs[0].files.map((x) => x.path), ['dir with space/my file.txt']);
});

test('the tree does not mutate the input array or its objects', () => {
  const input = [f('src/a.js', 1, 0), f('b.txt', 0, 1)];
  const snapshot = JSON.stringify(input);
  buildFileTree(input);
  assert.equal(JSON.stringify(input), snapshot);
});
