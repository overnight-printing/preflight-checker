import test from 'node:test';
import assert from 'node:assert/strict';
import { getOutputGeometry, rotateInsets, rotatedSize, stampDrawOptions } from '../src/utils/pdfGeometry.js';
import { validateArtworkFile } from '../src/utils/fileValidation.js';

const boxes = {
  cropBox: { x: 0, y: 0, width: 378, height: 666 },
  trimBox: { x: 9, y: 9, width: 360, height: 648 }
};

test('adds bleed outside existing artwork while retaining finished trim', () => {
  const geometry = getOutputGeometry(boxes, { bleedAmount: 9 });
  assert.deepEqual(geometry.outputBox, { x: 0, y: 0, width: 396, height: 684 });
  assert.deepEqual(geometry.trimBox, { x: 18, y: 18, width: 360, height: 648 });
  assert.deepEqual(getOutputGeometry(boxes).outputBox, boxes.cropBox);
});

test('crops PDF resources and intersects the finished trim with the remaining artwork', () => {
  assert.deepEqual(getOutputGeometry(boxes, { manualCropAmount: 3 }).trimBox,
    { x: 6, y: 6, width: 360, height: 648 });
  assert.deepEqual(getOutputGeometry(boxes, { manualCropAmount: 12 }).trimBox,
    { x: 0, y: 0, width: 354, height: 642 });
  assert.deepEqual(getOutputGeometry(boxes, { trimCropEnabled: true, manualCropAmount: 3, bleedAmount: 9 }).trimBox,
    { x: 9, y: 9, width: 354, height: 642 });
});

test('rejects invalid and destructive crop amounts', () => {
  for (const amount of [-1, NaN, Infinity, 189]) {
    assert.throws(() => getOutputGeometry(boxes, { manualCropAmount: amount }));
  }
  assert.throws(() => getOutputGeometry(boxes, { bleedAmount: -9 }));
});

test('maps source insets and dimensions to the rotated preview', () => {
  assert.deepEqual(rotateInsets({ left: 1, top: 2, right: 3, bottom: 4 }, 90),
    { left: 4, top: 1, right: 2, bottom: 3 });
  assert.deepEqual(rotatedSize(boxes.cropBox, 90), { width: 666, height: 378 });
});

test('places upright stamps in the same visible position at every page rotation', () => {
  const box = { x: 10, y: 20, width: 200, height: 300 };
  const position = { left: 30, top: 40 };
  const size = { width: 50, height: 20 };
  const expected = [[40, 260], [70, 50], [180, 80], [150, 290]];
  for (const [index, angle] of [0, 90, 180, 270].entries()) {
    const placement = stampDrawOptions(position, size, 1, box, angle);
    assert.deepEqual([placement.x, placement.y], expected[index]);
    assert.equal(placement.angle, angle);
  }
});

test('validates artwork before replacing a session', () => {
  assert.equal(validateArtworkFile({ name: 'ARTWORK.PDF', size: 100 }), '');
  assert.ok(validateArtworkFile({ name: 'artwork.svg', size: 100 }));
  assert.ok(validateArtworkFile({ name: 'empty.pdf', size: 0 }));
  assert.ok(validateArtworkFile({ name: 'large.pdf', size: 251 * 1024 * 1024 }));
});
