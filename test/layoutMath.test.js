import test from 'node:test';
import assert from 'node:assert/strict';
import { getAlignedPosition, translatePositionForBleed } from '../src/utils/layoutMath.js';

const bounds = { left: 10, top: 20, width: 300, height: 180 };
const item = { width: 60, height: 30 };

const expectedPositions = {
  'top-left': { left: 10, top: 20 },
  'top-center': { left: 130, top: 20 },
  'top-right': { left: 250, top: 20 },
  'middle-left': { left: 10, top: 95 },
  'middle-center': { left: 130, top: 95 },
  'middle-right': { left: 250, top: 95 },
  'bottom-left': { left: 10, top: 170 },
  'bottom-center': { left: 130, top: 170 },
  'bottom-right': { left: 250, top: 170 }
};

for (const [alignment, expected] of Object.entries(expectedPositions)) {
  test(`aligns to ${alignment}`, () => {
    assert.deepEqual(getAlignedPosition(alignment, bounds, item), expected);
  });
}

test('rejects an unknown alignment', () => {
  assert.throws(() => getAlignedPosition('center', bounds, item), /Unknown alignment/);
});

test('moves a position outward when bleed is enabled', () => {
  assert.deepEqual(
    translatePositionForBleed({ left: 100, top: 80 }, 0, 9, 1.5),
    { left: 113.5, top: 93.5 }
  );
});

test('restores the original position when bleed is disabled', () => {
  assert.deepEqual(
    translatePositionForBleed({ left: 113.5, top: 93.5 }, 9, 0, 1.5),
    { left: 100, top: 80 }
  );
});

test('clamps bleed translation at the canvas origin', () => {
  assert.deepEqual(
    translatePositionForBleed({ left: 5, top: 3 }, 9, 0, 1.5),
    { left: 0, top: 0 }
  );
});
