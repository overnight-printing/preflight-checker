import test from 'node:test';
import assert from 'node:assert/strict';
import { getCompatibilityRenderSize } from '../src/utils/compatibilityGeometry.js';

test('compatibility output provides requested physical resolution', () => {
  assert.deepEqual(getCompatibilityRenderSize({ width: 612, height: 792 }, 600), { width: 5100, height: 6600 });
  assert.deepEqual(getCompatibilityRenderSize({ width: 252, height: 144 }, 300), { width: 1050, height: 600 });
  assert.deepEqual(getCompatibilityRenderSize({ width: 402.00000000000006, height: 762 }, 600), { width: 3350, height: 6350 });
});

test('large pages require an explicit lower resolution rather than silent downsampling', () => {
  const poster = { width: 1008, height: 1440 };
  assert.throws(() => getCompatibilityRenderSize(poster, 600), /too large/);
  assert.deepEqual(getCompatibilityRenderSize(poster, 300), { width: 4200, height: 6000 });
});

test('invalid dimensions and unsupported resolutions cannot allocate a canvas', () => {
  for (const width of [0, -1, NaN, Infinity]) {
    assert.throws(() => getCompatibilityRenderSize({ width, height: 144 }, 300), /Invalid page dimensions/);
  }
  assert.throws(() => getCompatibilityRenderSize({ width: 252, height: 144 }, 72), /300 or 600/);
  assert.throws(() => getCompatibilityRenderSize({ width: 100000, height: 144 }, 300), /too large/);
});
