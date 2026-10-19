import test from 'node:test';
import assert from 'node:assert/strict';
import { validateRasterArtwork } from '../src/utils/fileValidation.js';

function png(width, height) {
  const bytes = new Uint8Array(24);
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width); view.setUint32(20, height);
  return new File([bytes], 'art.png');
}
function jpeg(width, height) {
  return new File([new Uint8Array([255, 216, 255, 224, 0, 4, 0, 0, 255, 192, 0, 8, 8,
    height >> 8, height & 255, width >> 8, width & 255, 1])], 'art.jpg');
}

test('raster headers reject excessive pixels before decoding PNG and JPEG artwork', async () => {
  for (const file of [png(20000, 20000), png(7000, 6000), jpeg(20000, 20000)]) {
    await assert.rejects(validateRasterArtwork(file), /too large.*16384.*40 megapixels/);
  }
  for (const file of [png(16384, 10), jpeg(300, 600), png(6000, 6000)]) {
    await validateRasterArtwork(file);
  }
});

test('invalid and truncated raster headers cannot reach the browser decoder', async () => {
  for (const file of [new File(['not an image'], 'fake.png'), new File([new Uint8Array([255, 216, 255])], 'short.jpg'), png(0, 100)]) {
    await assert.rejects(validateRasterArtwork(file), /Invalid|valid PNG or JPEG/);
  }
});
