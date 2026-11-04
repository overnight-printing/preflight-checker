import test from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas, DOMMatrix, ImageData, Path2D } from '@napi-rs/canvas';
import { PDFDocument, PDFName, PDFNumber, cmyk, degrees } from 'pdf-lib';

Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
const { createCompatibilityArtworkPdf, getCompatibilityDpiFit } = await import('../src/utils/compatibilityPdf.js');

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

test('getCompatibilityDpiFit reports the max feasible DPI before any rendering happens, and never throws for an oversized page', async () => {
  const source = await PDFDocument.create();
  source.addPage([1008, 1440]); // poster: fits at 300 dpi, exceeds the per-page cap at 600
  const bytes = await source.save();
  const file = new File([bytes], 'poster.pdf');
  const proxy = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    const fit = await getCompatibilityDpiFit(file, proxy);
    assert.equal(fit.feasibleDpi, 300);
    assert.equal(fit.attempts[600].fits, false);
    assert.equal(fit.attempts[600].perPage[0].fits, false);
    assert.equal(fit.attempts[300].fits, true);
    assert.deepEqual(fit.pagesFittingAt300, [1]);
  } finally { await proxy.destroy(); }
});

test('getCompatibilityDpiFit flags a document that fits no DPI as a whole, even though individual pages fit', async () => {
  const source = await PDFDocument.create();
  for (let i = 0; i < 15; i++) source.addPage([612, 792]); // letter; 15 pages exceeds the 120M total cap at 300 dpi
  const bytes = await source.save();
  const file = new File([bytes], 'long-run.pdf');
  const proxy = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    const fit = await getCompatibilityDpiFit(file, proxy);
    assert.equal(fit.feasibleDpi, null); // neither 600 nor 300 fits the whole document
    assert.equal(fit.attempts[300].perPage.every(page => page.fits), true); // every page fits alone
    assert.equal(fit.attempts[300].fits, false); // but not combined
    assert.equal(fit.pagesFittingAt300.length, 15); // all are individually viable for a partial export
  } finally { await proxy.destroy(); }
});

test('getCompatibilityDpiFit rejects an invalid page selection the same way the real export does', async () => {
  const source = await PDFDocument.create();
  source.addPage([612, 792]);
  const bytes = await source.save();
  const file = new File([bytes], 'single-page.pdf');
  const proxy = await pdfjs.getDocument({ data: bytes.slice() }).promise;
  try {
    await assert.rejects(getCompatibilityDpiFit(file, proxy, [2]), /valid pages/);
  } finally { await proxy.destroy(); }
});
