import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { PDFDocument, PDFName, PDFNumber, cmyk, degrees } from 'pdf-lib';

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const { createCompatibilityArtworkPdf } = await import('../src/utils/compatibilityPdf.js');

test('compatibility export preserves physical DPI on UserUnit pages in full and partial repairs', async () => {
  const original = globalThis.document;
  globalThis.document = { createElement() {
    const canvas = createCanvas(1, 1);
    canvas.toBlob = callback => callback(new Blob([canvas.toBuffer('image/png')]));
    return canvas;
  } };
  try {
    const source = await PDFDocument.create();
    const page = source.addPage([36, 18]);
    page.node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
    page.setRotation(degrees(90));
    page.drawRectangle({ width: 36, height: 18, color: cmyk(0, 0, 0, 1) });
    source.addPage([36, 18]);
    const bytes = await source.save();
    const file = new File([bytes], 'user-unit.pdf');
    const proxy = await pdfjs.getDocument({ data: bytes.slice() }).promise;
    try {
      for (const selected of [null, [1]]) {
        const result = await createCompatibilityArtworkPdf(file, proxy, 300, selected);
        const output = await PDFDocument.load(result);
        const target = output.getPage(0);
        assert.equal(target.node.get(PDFName.of('UserUnit')).asNumber(), 2);
        assert.equal(target.getRotation().angle, 90);
        assert.deepEqual(target.getMediaBox(), page.getMediaBox());
        const resources = target.node.Resources().lookup(PDFName.of('XObject'));
        const image = resources.keys().map(key => resources.lookup(key)).find(object => object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
        const width = image.dict.get(PDFName.of('Width')).asNumber();
        const height = image.dict.get(PDFName.of('Height')).asNumber();
        assert.equal(width, 300);
        assert.equal(height, 150);
        assert.equal(width / (36 * 2 / 72), 300);
        assert.match(output.getTitle(), /300 DPI RGB/);
      }
    } finally { await proxy.destroy(); }
  } finally { globalThis.document = original; }
});
