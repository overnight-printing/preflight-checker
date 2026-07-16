import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import {
  createCustomerProofPdf,
  normalizeProofId,
  proofIdForFilename
} from '../src/utils/customerProof.js';

test('normalizes a supplied estimate or invoice number', () => {
  assert.equal(normalizeProofId('  Estimate   1042  '), 'Estimate 1042');
  assert.equal(proofIdForFilename('Invoice #1042 / Rev 2'), 'Invoice-1042-Rev-2');
});

test('requires a proof ID', async () => {
  await assert.rejects(
    createCustomerProofPdf({ sourcePdfBytes: new Uint8Array(), proofId: '   ', sourceName: 'test.pdf' }),
    /estimate or invoice number/i
  );
});

test('creates one customer sheet per source page', async () => {
  const source = await PDFDocument.create();
  const first = source.addPage([630, 810]);
  first.setTrimBox(9, 9, 612, 792);
  const second = source.addPage([810, 630]);
  second.setTrimBox(9, 9, 792, 612);
  const sourceBytes = await source.save();

  const proofBytes = await createCustomerProofPdf({
    sourcePdfBytes: sourceBytes,
    proofId: 'EST-1042',
    sourceName: 'postcard.pdf',
    generatedAt: new Date('2026-07-16T12:00:00Z')
  });
  const proof = await PDFDocument.load(proofBytes);
  const serializedProof = new TextDecoder('latin1').decode(proofBytes);

  assert.equal(proof.getPageCount(), 2);
  assert.deepEqual(proof.getPage(0).getSize(), { width: 612, height: 792 });
  assert.deepEqual(proof.getPage(1).getSize(), { width: 792, height: 612 });
  assert.match(serializedProof, /\/ObjStm/);
});
