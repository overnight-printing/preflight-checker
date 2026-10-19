import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { contentOperators, scanContent } from '../src/utils/pdfContent.js';
import { tintStampContent } from '../src/utils/pdfStampColor.js';
import { getPdfBytes, getPdfDocument } from '../src/utils/pdfSource.js';

test('tokenizer skips nested escaped strings, hex, comments, arrays and inline image data', () => {
  const text = '% 1 0 0 rg\nBT (a\\( (1 0 0 rg /Fake Do) \\) z) Tj <7267> Tj [(RG) 12 (Do)] TJ ET\nBI /W 1 /H 1 /BPC 8 /CS /RGB ID rg /Bad Do EI\n/F#6frm Do';
  const ops = [...contentOperators(text)];
  assert.deepEqual(ops.map(op => op.operator), ['BT', 'Tj', 'Tj', 'TJ', 'ET', 'BI', 'Do']);
  assert.equal(ops.at(-1).args[0], '/Form');
  assert.equal(scanContent(text, null, value => value).rgb, false);
});

test('scanner preserves graphics state and transformed Form draws; only painted white overprint is an error', async () => {
  const doc = await PDFDocument.create();
  const resources = doc.context.obj({ ExtGState: { Over: { OP: true, op: true }, Opaque: { ca: 1, CA: 1, BM: 'Normal', SMask: 'None' }, Alpha: { ca: 0.5 } } });
  const lookup = value => doc.context.lookup(value);
  const black = scanContent('/Over gs 0 0 0 1 k 0 0 8 8 re f', resources, lookup);
  assert.equal(black.overprint, true);
  assert.equal(black.whiteOverprint, false);
  for (const color of ['0 0 0 0 k', '1 g', '1 1 1 rg']) {
    assert.equal(scanContent(`/Over gs ${color} 0 0 8 8 re f`, resources, lookup).whiteOverprint, true);
    assert.equal(scanContent(`/Over gs ${color} q Q`, resources, lookup).whiteOverprint, false);
  }
  assert.equal(scanContent('/Over gs 1 G 0 0 m 8 8 l S', resources, lookup).whiteOverprint, true);
  assert.equal(scanContent('/Over gs q 1 g Q 0 0 8 8 re f', resources, lookup).whiteOverprint, false);
  assert.equal(scanContent('/Over gs 1 g 3 Tr (invisible) Tj', resources, lookup).whiteOverprint, false);
  assert.equal(scanContent('/Over gs 1 g (visible) Tj', resources, lookup).whiteOverprint, true);
  const form = scanContent('2 0 0 3 0 0 cm q 4 0 0 5 0 0 cm /Inner Do Q /Outer Do', resources, lookup);
  assert.deepEqual(form.draws.map(draw => draw.state.matrix), [[8, 0, 0, 15], [2, 0, 0, 3]]);
  assert.equal(scanContent('/Opaque gs', resources, lookup).transparency, false);
  assert.equal(scanContent('/Alpha gs', resources, lookup).transparency, true);
});

test('stamp tints use CMYK and cannot rewrite strings or inline images', () => {
  const source = '0 g (0 g 0 0 0 rg) Tj 0 0 0 RG BI /W 1 ID 0 g EI\n0 0 0 1 k';
  const white = tintStampContent(source, '#ffffff');
  assert.ok(white.startsWith('0 0 0 0 k (0 g 0 0 0 rg) Tj 0 0 0 0 K'));
  assert.ok(white.includes('ID 0 g EI'));
  assert.ok(white.endsWith('0 0 0 0 k'));
  assert.equal(tintStampContent('0 g', '#000000'), '0 0 0 1 k');
  assert.equal(tintStampContent('0 g', '#ff0000'), '0 1 1 0 k');
  assert.equal(tintStampContent(source, 'original'), source);
});

test('source cache reads once and keeps editing copies separate; encryption has an actionable error', async () => {
  const doc = await PDFDocument.create();
  doc.addPage([252, 144]);
  const bytes = await doc.save();
  let reads = 0;
  const file = { arrayBuffer: async () => { reads++; return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength); } };
  const original = await getPdfDocument(file);
  assert.equal(await getPdfDocument(file), original);
  await getPdfBytes(file);
  const editing = await getPdfDocument(file, true);
  editing.getPage(0).setTrimBox(9, 9, 234, 126);
  assert.equal(original.getPage(0).getTrimBox().width, 252);
  assert.equal(reads, 1);
  doc.context.trailerInfo.Encrypt = doc.context.register(doc.context.obj({ Filter: 'Standard' }));
  const encrypted = new File([await doc.save()], 'encrypted.pdf');
  await assert.rejects(getPdfDocument(encrypted), /encrypted or password protected.*unencrypted/);
});

test('painted registration is distinguished from unused resources, None and explicitly tagged printer marks', async () => {
  const doc = await PDFDocument.create();
  const resources = doc.context.obj({ ColorSpace: {
    Reg: ['Separation', 'All', 'DeviceCMYK', {}], Invisible: ['Separation', 'None', 'DeviceCMYK', {}],
    Multi: ['DeviceN', ['Cyan', 'All'], 'DeviceCMYK', {}]
  } });
  const scan = text => scanContent(text, resources, value => doc.context.lookup(value));
  assert.equal(scan('/Reg cs 1 scn').registration, false);
  assert.equal(scan('/Reg cs 1 scn 0 0 10 10 re f').registration, true);
  assert.equal(scan('/Reg CS 1 SCN 0 0 m 10 10 l S').registration, true);
  assert.equal(scan('/Multi cs 0 1 scn (text) Tj').registration, true);
  assert.equal(scan('/Invisible cs 1 scn 0 0 10 10 re f').registration, false);
  assert.equal(scan('/Reg cs 1 scn 3 Tr (invisible) Tj').registration, false);
  assert.equal(scan('/Artifact << /Subtype /PrinterMark >> BDC /Reg CS 1 SCN 0 0 m 10 10 l S EMC').registration, false);
  assert.equal(scan('/Artifact << /Subtype /PrinterMark >> BDC EMC /Reg cs 1 scn (art) Tj').registration, true);
});

test('printer-mark tags resolve named properties and cannot be forged by dictionary strings', async () => {
  const doc = await PDFDocument.create();
  const resources = doc.context.obj({ ColorSpace: { Reg: ['Separation', 'All', 'DeviceCMYK', {}] },
    Properties: { Mark: { Subtype: 'PrinterMark' } } });
  const scan = text => scanContent(text, resources, value => doc.context.lookup(value));
  assert.equal(scan('/Artifact /Mark BDC /Reg cs 1 scn 0 0 10 10 re f EMC').registration, false);
  assert.equal(scan('/Artifact << /Note (/Subtype /PrinterMark) >> BDC /Reg cs 1 scn (art) Tj EMC').registration, true);
});

test('registration color inherited into a Form survives its different resource dictionary', async () => {
  const doc = await PDFDocument.create();
  const resources = doc.context.obj({ ColorSpace: { Reg: ['Separation', 'All', 'DeviceCMYK', {}] } });
  const lookup = value => doc.context.lookup(value);
  const parent = scanContent('/Reg cs 1 scn /Form Do', resources, lookup);
  const child = scanContent('0 0 10 10 re f', doc.context.obj({}), lookup, parent.draws[0].state);
  assert.equal(child.registration, true);
  assert.equal(scanContent('0 0 0 1 k 0 0 10 10 re f', resources, lookup, parent.draws[0].state).registration, false);
});
