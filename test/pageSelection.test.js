import test from 'node:test';
import assert from 'node:assert/strict';
import { parseCustomPageSelection, resolveTargetPages } from '../src/utils/pageSelection.js';

test('parses pages and ranges, removes duplicates, and sorts', () => {
  assert.deepEqual(parseCustomPageSelection('7-9, 2, 4, 8', 10), {
    pages: [2, 4, 7, 8, 9],
    error: ''
  });
});

test('rejects empty custom input', () => {
  assert.match(parseCustomPageSelection('', 10).error, /Enter pages/);
});

test('rejects pages outside the document', () => {
  assert.match(parseCustomPageSelection('1, 11', 10).error, /outside 1-10/);
});

test('rejects descending ranges', () => {
  assert.match(parseCustomPageSelection('7-3', 10).error, /low to high/);
});

test('rejects malformed page tokens', () => {
  assert.match(parseCustomPageSelection('1, three', 10).error, /not a valid page/);
});

test('rejects extra commas', () => {
  assert.match(parseCustomPageSelection('1,,3', 10).error, /extra comma/);
});

test('resolves all standard page targeting modes', () => {
  assert.deepEqual(resolveTargetPages({ applyTo: 'current' }, 6, 3).pages, [3]);
  assert.deepEqual(resolveTargetPages({ applyTo: 'all' }, 4, 2).pages, [1, 2, 3, 4]);
  assert.deepEqual(resolveTargetPages({ applyTo: 'first' }, 6, 3).pages, [1]);
  assert.deepEqual(resolveTargetPages({ applyTo: 'last' }, 6, 3).pages, [6]);
  assert.deepEqual(resolveTargetPages({ applyTo: 'even' }, 7, 3).pages, [2, 4, 6]);
  assert.deepEqual(resolveTargetPages({ applyTo: 'odd' }, 7, 3).pages, [1, 3, 5, 7]);
  assert.deepEqual(
    resolveTargetPages({ applyTo: 'custom', customPages: '2, 5-6' }, 7, 3).pages,
    [2, 5, 6]
  );
});

test('rejects an unknown page targeting mode', () => {
  assert.match(resolveTargetPages({ applyTo: 'mystery' }, 5, 1).error, /Unknown page selection/);
});
