import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_HISTORY_PAGE_SIZE, getPageCount, getPageRange } from '../src/shared/pagination/pagination.js';

test('Finance and assignments use the same page range / exact-count helper', () => {
  assert.equal(DEFAULT_HISTORY_PAGE_SIZE, 20);
  assert.deepEqual(getPageRange(0, 20), { offset: 0, limit: 20 });
  assert.deepEqual(getPageRange(2, 20), { offset: 40, limit: 20 });
  assert.equal(getPageCount(0, 20), 1);
  assert.equal(getPageCount(40, 20), 2);
  assert.equal(getPageCount(41, 20), 3);
});
