import { test } from 'node:test';
import assert from 'node:assert/strict';
import { treeIndent } from '../src/viewer-state.js';

// The file tree indents every level by 12px. The indent used to stop growing at the sixth
// level, so a seventh folder sat at the same indent as its parent and read as a sibling: a
// Java-style path like src/main/java/com/acme/app/service/ shows as a flat run of folders.
// Depth is the row's level below the repo root (1 = a top-level folder or file).

test('each level is 12px deeper than the one above', () => {
  assert.equal(treeIndent(1), '12px');
  assert.equal(treeIndent(2), '24px');
  assert.equal(treeIndent(6), '72px');
});

test('the indent keeps growing past six levels, one step per level', () => {
  assert.equal(treeIndent(7), '84px');
  assert.equal(treeIndent(9), '108px');
  assert.equal(treeIndent(12), '144px');
  for (let depth = 1; depth < 20; depth += 1) {
    assert.equal(parseInt(treeIndent(depth + 1), 10) - parseInt(treeIndent(depth), 10), 12, `level ${depth}`);
  }
});

test('the repo root itself has no indent', () => {
  assert.equal(treeIndent(0), '0px');
});
