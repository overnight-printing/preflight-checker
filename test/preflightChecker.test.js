import test from 'node:test';
import assert from 'node:assert/strict';
import { DOMMatrix } from '@napi-rs/canvas';
import { PDFDocument, PDFName, PDFNumber, cmyk } from 'pdf-lib';

globalThis.DOMMatrix = DOMMatrix;
const { OPS } = await import('pdfjs-dist');
const { runPreflightChecks } = await import('../src/utils/preflightChecker.js');

async function check(doc, requirements = {}, operators = [OPS.fill]) {
  const bytes = await doc.save();
  return (await runPreflightChecks({ arrayBuffer: async () => bytes }, {
    getPage: async () => ({ getOperatorList: async () => ({ fnArray: operators, argsArray: operators.map(() => []) }) })
  }, requirements)).checks;
}

async function imageDocument(dpi = 200) {
  const doc = await PDFDocument.create();
  const page = doc.addPage([72, 72]);
  const image = doc.context.register(doc.context.flateStream(new Uint8Array(dpi * dpi), {
    Type: 'XObject', Subtype: 'Image', Width: dpi, Height: dpi, BitsPerComponent: 8, ColorSpace: 'DeviceGray'
  }));
  page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: { Im: image } }));
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('72 0 0 72 0 0 cm /Im Do')));
  return doc;
}

test('missing explicit trim or bleed requires review, while insufficient explicit bleed is an error', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([270, 162]);
  let checks = await check(doc);
  assert.equal(checks.bleed.status, 'warning');
  assert.match(checks.bleed.details, /TrimBox.*BleedBox/);
  page.setTrimBox(9, 9, 252, 144);
  assert.match((await check(doc)).bleed.details, /BleedBox/);
  page.setBleedBox(0, 0, 270, 162);
  assert.equal((await check(doc)).bleed.status, 'pass');
  page.setBleedBox(9, 9, 252, 144);
  assert.equal((await check(doc)).bleed.status, 'error');
  assert.equal((await check(doc, { bleedPoints: 0 })).bleed.status, 'pass');
});

test('configured DPI holds a 200 DPI image on a 300 DPI job and keeps unknown images visible', async () => {
  const doc = await imageDocument();
  const checks = await check(doc, { minDpi: 300 }, [OPS.paintImageXObject, OPS.paintInlineImageXObject]);
  assert.equal(checks.resolution.status, 'error');
  assert.equal(checks.resolution.value, 200);
  assert.match(checks.resolution.details, /200 DPI/);
  assert.match(checks.resolution.details, /300 DPI/);
  assert.match(checks.resolution.details, /could not be measured/);
  assert.equal(checks.contentScan.status, 'warning');
  assert.equal((await check(doc, { minDpi: 200 })).resolution.status, 'pass');
  assert.equal((await check(await imageDocument(100), { minDpi: 72 })).resolution.status, 'warning');
});

test('unknown images alone never establish that a document is vector only', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([72, 72]);
  const checks = await check(doc, {}, [OPS.paintInlineImageXObject]);
  assert.equal(checks.resolution.status, 'warning');
  assert.equal(checks.resolution.value, null);
});

test('order size retains page consistency findings and compares resolved first-page trim', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([270, 162]);
  const odd = doc.addPage([300, 200]);
  odd.setTrimBox(0, 0, 300, 200);
  const checks = await check(doc, { orderSize: { width: 252, height: 144 } });
  assert.equal(checks.pageSize.status, 'error');
  assert.match(checks.pageSize.details, /Page size mismatch/);
  assert.match(checks.pageSize.details, /differs from the order on pages 2/);
  assert.equal(checks.pageSize.value.mismatchPageNum, 2);
  assert.deepEqual(checks.pageSize.orderMismatchPages, [2]);
  const single = await PDFDocument.create();
  single.addPage([270, 162]);
  assert.equal((await check(single, { orderSize: { width: 252, height: 144 } })).pageSize.status, 'pass');
});

test('registration and None separations are reported, and painted registration artwork holds the job', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([72, 72]);
  page.node.set(PDFName.of('Resources'), doc.context.obj({ ColorSpace: {
    Reg: ['Separation', 'All', 'DeviceCMYK', {}], Invisible: ['Separation', 'None', 'DeviceCMYK', {}]
  } }));
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream('/Reg cs 1 scn 0 0 20 20 re f')));
  const checks = await check(doc);
  assert.deepEqual(checks.spotColors.value, ['All', 'None']);
  assert.equal(checks.spotColors.status, 'error');
  assert.match(checks.spotColors.details, /every plate/);
  assert.match(checks.spotColors.details, /prints nothing/);
});

test('completed scans and order checks have stable entries even when no issue fires', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([72, 72]).drawRectangle({ width: 72, height: 72, color: cmyk(0, 0, 0, 1) });
  const checks = await check(doc);
  assert.equal(checks.contentScan.status, 'pass');
  assert.equal(checks.contentScan.value, false);
  assert.equal(checks.orderBoxes.status, 'info');
  assert.equal((await check(doc, { orderSize: { width: 72, height: 72 } })).orderBoxes.status, 'pass');
});

test('placed image DPI accounts for UserUnit', async () => {
  const doc = await imageDocument(300);
  doc.getPage(0).node.set(PDFName.of('UserUnit'), PDFNumber.of(2));
  assert.equal((await check(doc)).resolution.value, 150);
});

test('an unmeasurable placed image reports a null minimum and never Infinity DPI', async () => {
  const doc = await imageDocument();
  const page = doc.getPage(0);
  const images = page.node.Resources().lookup(PDFName.of('XObject'));
  images.lookup(PDFName.of('Im')).dict.set(PDFName.of('Width'), PDFNumber.of(0));
  const checks = await check(doc);
  assert.equal(checks.resolution.status, 'warning');
  assert.equal(checks.resolution.value, null);
  assert.doesNotMatch(checks.resolution.details, /Infinity|vector only/);
});
