import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, PDFString } from 'pdf-lib';
import { getPrintDocumentChecks, normalizePrintRequirements } from '../src/utils/printRequirements.js';

test('job requirements are validated and do not equate PDF/X metadata with certification', async () => {
  assert.throws(() => normalizePrintRequirements({ minDpi: 0 }), /valid print/);
  assert.throws(() => normalizePrintRequirements({ bleedPoints: -1 }), /valid print/);
  const document = await PDFDocument.create();
  document.addPage([252, 144]);
  const general = getPrintDocumentChecks(document);
  assert.equal(general.outputIntent.status, 'warning');
  assert.equal(general.pdfxStandard.status, 'info');
  const strict = getPrintDocumentChecks(document, { workflow: 'pdfx4' });
  assert.equal(strict.outputIntent.status, 'error');
  assert.equal(strict.pdfxStandard.status, 'error');
  const info = document.context.lookup(document.context.trailerInfo.Info);
  info.set(PDFName.of('GTS_PDFXVersion'), PDFString.of('PDF/X-4'));
  assert.equal(getPrintDocumentChecks(document, { workflow: 'pdfx4' }).pdfxStandard.status, 'info');
});

test('checks embedded ICC output profiles rather than accepting an OutputIntents key', async () => {
  const document = await PDFDocument.create();
  document.addPage([252, 144]);
  document.catalog.set(PDFName.of('OutputIntents'), document.context.obj([{ S: 'GTS_PDFX' }]));
  assert.equal(getPrintDocumentChecks(document).outputIntent.status, 'error');
  const bytes = new Uint8Array(128);
  bytes.set(new TextEncoder().encode('CMYK'), 16);
  bytes.set(new TextEncoder().encode('acsp'), 36);
  const profile = document.context.register(document.context.flateStream(bytes, { N: 4 }));
  document.catalog.set(PDFName.of('OutputIntents'), document.context.obj([
    { S: 'GTS_PDFX', OutputConditionIdentifier: PDFString.of('Test press'), DestOutputProfile: profile }
  ]));
  const check = getPrintDocumentChecks(document).outputIntent;
  assert.equal(check.status, 'pass');
  assert.deepEqual(check.value, [{ name: 'Test press', colorSpace: 'CMYK', channels: 4 }]);
});

test('distinguishes missing finished trim from invalid boxes and reports annotation/scaling risks', async () => {
  const document = await PDFDocument.create();
  const page = document.addPage([252, 144]);
  assert.equal(getPrintDocumentChecks(document).pageGeometry.status, 'warning');
  page.setTrimBox(9, 9, 234, 126);
  assert.equal(getPrintDocumentChecks(document).pageGeometry.status, 'pass');
  page.setTrimBox(9, 9, 300, 126);
  assert.equal(getPrintDocumentChecks(document).pageGeometry.status, 'error');
  page.node.set(PDFName.of('Annots'), document.context.obj([{ Subtype: 'Text' }]));
  page.node.set(PDFName.of('UserUnit'), document.context.obj(2));
  const checks = getPrintDocumentChecks(document);
  assert.equal(checks.interactiveContent.status, 'warning');
  assert.equal(checks.pageUnits.status, 'warning');
});
