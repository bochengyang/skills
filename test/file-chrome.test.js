import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffstatSquares, matchesFileFilter } from '../src/viewer-state.js';

const shape = (a, d) => diffstatSquares(a, d).join(' ');

test('the meter is always five squares, whatever the counts', () => {
  for (const [a, d] of [[0, 0], [1, 0], [3, 2], [100, 4], [0, 999]]) {
    assert.equal(diffstatSquares(a, d).length, 5, `${a}/${d}`);
  }
});

test('a file with no changes shows five neutral squares', () => {
  assert.equal(shape(0, 0), 'neutral neutral neutral neutral neutral');
});

test('small changes fill only as many squares as there are lines', () => {
  assert.equal(shape(1, 0), 'add neutral neutral neutral neutral');
  assert.equal(shape(0, 1), 'del neutral neutral neutral neutral');
  assert.equal(shape(1, 1), 'add del neutral neutral neutral');
});

test('once there are five or more lines every square is used', () => {
  assert.equal(shape(5, 0), 'add add add add add');
  assert.equal(shape(0, 5), 'del del del del del');
  assert.ok(!diffstatSquares(200, 200).includes('neutral'));
  const even = diffstatSquares(200, 200);
  assert.deepEqual(
    [even.filter((s) => s === 'add').length, even.filter((s) => s === 'del').length].sort(),
    [2, 3],
    'an even split lands on 3 and 2, either way round',
  );
});

test('the green share follows the additions', () => {
  assert.equal(shape(1, 9), 'add del del del del');
  assert.equal(shape(6, 4), 'add add add del del');
});

test('a side that has any lines at all keeps at least one square', () => {
  assert.equal(shape(9, 1), 'add add add add del');
  assert.equal(shape(1, 99), 'add del del del del');
  assert.equal(shape(99, 1), 'add add add add del');
  for (const [a, d] of [[49, 1], [1, 49], [500, 3], [3, 500]]) {
    const squares = diffstatSquares(a, d);
    assert.ok(squares.includes('add'), `${a}/${d} lost its additions`);
    assert.ok(squares.includes('del'), `${a}/${d} lost its deletions`);
  }
});

test('an all-additions file is all green and an all-deletions file all red', () => {
  assert.ok(diffstatSquares(12, 0).every((s) => s === 'add'));
  assert.ok(diffstatSquares(0, 12).every((s) => s === 'del'));
});

test('the filter matches any part of the path and ignores case', () => {
  assert.equal(matchesFileFilter('src/app.js', 'app', false, []), true);
  assert.equal(matchesFileFilter('src/app.js', 'SRC', false, []), true);
  assert.equal(matchesFileFilter('src/app.js', 'src/app.js', false, []), true);
  assert.equal(matchesFileFilter('src/app.js', 'style', false, []), false);
});

test('an empty query matches everything', () => {
  assert.equal(matchesFileFilter('anything/at/all.txt', '', false, []), true);
});

test('the unresolved filter keeps only files that carry a thread', () => {
  const threads = [{ filePath: 'src/app.js' }, { filePath: 'README.md' }];
  assert.equal(matchesFileFilter('src/app.js', '', true, threads), true);
  assert.equal(matchesFileFilter('README.md', '', true, threads), true);
  assert.equal(matchesFileFilter('src/style.css', '', true, threads), false);
});

test('the two filters combine: the text must match and a thread must exist', () => {
  const threads = [{ filePath: 'src/app.js' }];
  assert.equal(matchesFileFilter('src/app.js', 'app', true, threads), true);
  assert.equal(matchesFileFilter('src/app.js', 'style', true, threads), false);
  assert.equal(matchesFileFilter('src/style.css', 'style', true, threads), false);
});

test('with the unresolved filter off, a file with no threads still matches', () => {
  assert.equal(matchesFileFilter('src/style.css', '', false, []), true);
});
