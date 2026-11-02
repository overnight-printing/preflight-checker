import test from 'node:test';
import assert from 'node:assert/strict';
import { getCompatibilityRenderSize, summarizeCompatibilityFit } from '../src/utils/compatibilityGeometry.js';

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

test('summarizeCompatibilityFit reports per-page and document-wide feasibility without throwing', () => {
  const letter = { width: 612, height: 792 };
  const fitsBoth = summarizeCompatibilityFit([letter, letter], 600);
  assert.equal(fitsBoth.fits, true);
  assert.deepEqual(fitsBoth.perPage.map(page => page.fits), [true, true]);

  const poster = { width: 1008, height: 1440 };
  const posterAt600 = summarizeCompatibilityFit([poster], 600);
  assert.equal(posterAt600.fits, false);
  assert.equal(posterAt600.perPage[0].fits, false);
  const posterAt300 = summarizeCompatibilityFit([poster], 300);
  assert.equal(posterAt300.fits, true);
  assert.deepEqual(posterAt300.perPage[0], { width: 4200, height: 6000, fits: true });
});

test('summarizeCompatibilityFit flags the document-wide cap even when every page individually fits', () => {
  const letter = { width: 612, height: 792 }; // 2550x3300 px at 300 dpi = 8,415,000 px/page
  const fourteenPages = Array(14).fill(letter);
  const fourteen = summarizeCompatibilityFit(fourteenPages, 300);
  assert.equal(fourteen.perPage.every(page => page.fits), true);
  assert.equal(fourteen.fits, true); // 117,810,000 <= 120,000,000

  const fifteenPages = Array(15).fill(letter);
  const fifteen = summarizeCompatibilityFit(fifteenPages, 300);
  assert.equal(fifteen.perPage.every(page => page.fits), true); // every page still fits alone
  assert.equal(fifteen.fits, false); // 126,225,000 > 120,000,000 total
});

test('summarizeCompatibilityFit treats invalid page dimensions as not fitting, never throws', () => {
  const result = summarizeCompatibilityFit([{ width: NaN, height: 144 }, { width: 252, height: 144 }], 300);
  assert.equal(result.perPage[0].fits, false);
  assert.equal(result.perPage[0].width, null);
  assert.equal(result.perPage[1].fits, true);
  assert.equal(result.fits, false);
});
