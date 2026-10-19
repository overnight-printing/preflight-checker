import test from 'node:test';
import assert from 'node:assert/strict';
import { stitchBugToImage } from '../src/utils/canvasProcessor.js';

test('image export rejects oversized artwork and bleed before allocating a canvas', () => {
  const original = globalThis.document;
  globalThis.document = { createElement() { throw new Error('must not allocate'); } };
  try {
    for (const [width, height, bleed] of [[20000, 20000, 0], [6000, 6000, 500], [16384, 10, 1]]) {
      assert.throws(() => stitchBugToImage({ width, height }, null, {}, {}, bleed, false), /too large/);
    }
  } finally { globalThis.document = original; }
});

test('image export rejects failed encodes and releases its canvas in both bleed paths', () => {
  const original = globalThis.document;
  const ctx = { drawImage() {}, save() {}, restore() {}, scale() {}, translate() {} };
  let canvas;
  globalThis.document = { createElement: () => (canvas = { getContext: () => ctx, toDataURL: () => 'data:,' }) };
  try {
    for (const bleed of [0, 9]) {
      assert.throws(() => stitchBugToImage({ width: 252, height: 144 }, null, {}, {}, bleed, false), /encode/);
      assert.equal(canvas.width, 0);
      assert.equal(canvas.height, 0);
    }
    globalThis.document.createElement = () => ({ getContext: () => null });
    assert.throws(() => stitchBugToImage({ width: 252, height: 144 }, null, {}, {}, 0, false), /allocate/);
  } finally { globalThis.document = original; }
});
