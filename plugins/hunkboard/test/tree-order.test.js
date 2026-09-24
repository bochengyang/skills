import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeOrder, buildFileTree } from '../src/viewer-state.js';

// The sidebar walks the file tree folders-first at every level; the diff, Previous/Next and
// "N of M" must walk it in the same order, as GitHub does. Git lists files by full path,
// byte by byte, which puts a root file like README.md between two folders.
const f = (path) => ({ path, additions: 1, deletions: 0 });
const paths = (files) => files.map((file) => file.path);

// Exactly the order git produced for this repository's working tree.
const GIT_ORDER = [
  '.claude-plugin/marketplace.json', '.claude-plugin/plugin.json', 'README.md',
  'examples/claude-code/README.md', 'examples/claude-code/settings.hooks.json',
  'examples/claude-code/skills/hunkboard-comments/SKILL.md',
  'examples/claude-code/skills/hunkboard-publish/SKILL.md', 'hooks/hooks.json',
  'skills/hunkboard-comments/SKILL.md', 'skills/hunkboard-publish/SKILL.md',
];

test('folders come before files at every level, as in the sidebar', () => {
  assert.deepEqual(paths(treeOrder(GIT_ORDER.map(f))), [
    '.claude-plugin/marketplace.json', '.claude-plugin/plugin.json',
    'examples/claude-code/skills/hunkboard-comments/SKILL.md',
    'examples/claude-code/skills/hunkboard-publish/SKILL.md',
    'examples/claude-code/README.md', 'examples/claude-code/settings.hooks.json',
    'hooks/hooks.json',
    'skills/hunkboard-comments/SKILL.md', 'skills/hunkboard-publish/SKILL.md',
    'README.md',
  ]);
});

test('the order is exactly a depth-first walk of the sidebar tree', () => {
  const walk = (node) => [...node.dirs.flatMap(walk), ...node.files];
  const files = GIT_ORDER.map(f);
  assert.deepEqual(paths(treeOrder(files)), paths(walk(buildFileTree(files))));
});

test('the result does not depend on the input order', () => {
  const files = GIT_ORDER.map(f);
  assert.deepEqual(paths(treeOrder([...files].reverse())), paths(treeOrder(files)));
});

test('it returns the same file objects and leaves the input alone', () => {
  const files = GIT_ORDER.map(f);
  const before = paths(files);
  const ordered = treeOrder(files);
  assert.equal(ordered.length, files.length);
  for (const file of ordered) assert.ok(files.includes(file));
  assert.deepEqual(paths(files), before);
});

test('a flat list of root files is sorted by name', () => {
  assert.deepEqual(paths(treeOrder([f('b.txt'), f('a.txt'), f('C.txt')])), ['C.txt', 'a.txt', 'b.txt']);
});

test('the same path listed twice keeps both entries', () => {
  assert.deepEqual(paths(treeOrder([f('src/a.js'), f('README.md'), f('src/a.js')])),
    ['src/a.js', 'src/a.js', 'README.md']);
});

test('no files gives an empty list', () => {
  assert.deepEqual(treeOrder([]), []);
});
