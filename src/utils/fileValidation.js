import { validateCanvasSize } from './compatibilityGeometry.js';

export const MAX_PDF_BYTES = 250 * 1024 * 1024;

export function validateArtworkFile(file) {
  if (!file || !/\.(pdf|png|jpe?g)$/i.test(file.name)) return 'Choose a PDF, PNG, JPG, or JPEG artwork file.';
  if (/\.pdf$/i.test(file.name) && file.size > MAX_PDF_BYTES) return 'This PDF exceeds the 250 MB browser limit. Use a desktop PDF editor or choose a smaller PDF.';
  if (file.size === 0) return 'This file is empty. Choose a file containing artwork.';
  return '';
}

// Read dimensions before handing compressed artwork to the browser decoder.
export async function validateRasterArtwork(file) {
  const invalid = () => { throw new Error('Choose a valid PNG or JPEG artwork file. The image header is missing or damaged.'); };
  const header = new Uint8Array(await file.slice(0, 24).arrayBuffer());
  if (/\.png$/i.test(file.name)) {
    if (header.length < 24 || ![137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82].every((byte, i) => header[i] === byte)) invalid();
    const view = new DataView(header.buffer);
    validateCanvasSize(view.getUint32(16), view.getUint32(20));
    return;
  }
  if (header[0] !== 255 || header[1] !== 216) invalid();
  let offset = 2;
  while (offset + 4 <= file.size) {
    const bytes = new Uint8Array(await file.slice(offset, offset + 9).arrayBuffer());
    if (bytes[0] !== 255) invalid();
    const marker = bytes[1];
    if (marker === 255) { offset++; continue; }
    if ([0xD9, 0xDA].includes(marker)) invalid();
    const length = bytes[2] * 256 + bytes[3];
    if (length < 2 || offset + 2 + length > file.size) invalid();
    if ([0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF].includes(marker)) {
      if (length < 8 || bytes.length < 9) invalid();
      validateCanvasSize(bytes[7] * 256 + bytes[8], bytes[5] * 256 + bytes[6]);
      return;
    }
    offset += length + 2;
  }
  invalid();
}
