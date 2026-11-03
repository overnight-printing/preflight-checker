import test from 'node:test';
import assert from 'node:assert/strict';
import opentype from 'opentype.js';
import { PDFDocument, PDFName, decodePDFRawStream } from 'pdf-lib';
import { outlineFontsInPdf } from '../src/utils/pdfFontOutline.js';

function rectGlyph(unicode, name, width, height, advanceWidth) {
  const path = new opentype.Path();
  path.moveTo(0, 0);
  path.lineTo(width, 0);
  path.lineTo(width, height);
  path.lineTo(0, height);
  path.close();
  return new opentype.Glyph({ name, unicode, advanceWidth, path });
}

function buildTestFont() {
  const notdef = new opentype.Glyph({ name: '.notdef', unicode: 0, advanceWidth: 500, path: new opentype.Path() });
  const a = rectGlyph(65, 'A', 600, 700, 650);
  const b = rectGlyph(66, 'B', 500, 700, 600);
  const font = new opentype.Font({ familyName: 'TestFont', styleName: 'Regular', unitsPerEm: 1000, ascender: 800, descender: -200, glyphs: [notdef, a, b] });
  return new Uint8Array(font.toArrayBuffer());
}

async function embedTestFont(doc, ttfBytes, { baseFont = 'TestFont', differences = null, wrapAsFontFile3OpenType = false } = {}) {
  const fontFile = wrapAsFontFile3OpenType
    ? doc.context.register(doc.context.flateStream(ttfBytes, { Subtype: 'OpenType' }))
    : doc.context.register(doc.context.flateStream(ttfBytes, { Length1: ttfBytes.length }));
  const descriptorEntries = { Type: 'FontDescriptor', FontName: baseFont, Flags: 32 };
  descriptorEntries[wrapAsFontFile3OpenType ? 'FontFile3' : 'FontFile2'] = fontFile;
  const descriptor = doc.context.register(doc.context.obj(descriptorEntries));
  const fontDict = { Type: 'Font', Subtype: 'TrueType', BaseFont: baseFont, FontDescriptor: descriptor };
  if (differences) fontDict.Encoding = { Differences: differences };
  return doc.context.register(doc.context.obj(fontDict));
}

function streamText(doc, ref) {
  return new TextDecoder('latin1').decode(decodePDFRawStream(doc.context.lookup(ref)).decode());
}

test('outlineFontsInPdf converts a simple Tj call for a selected embedded TrueType font', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const fontRef = await embedTestFont(doc, buildTestFont());
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontRef } }));
  const content = doc.context.register(doc.context.flateStream('BT /F1 10 Tf 0 0 Td (A) Tj ET'));
  page.node.set(PDFName.of('Contents'), content);

  const { converted, unconverted } = outlineFontsInPdf(doc, new Set(['TestFont']));
  assert.deepEqual([...converted], ['TestFont']);
  assert.equal(unconverted.size, 0);

  const text = streamText(doc, content);
  assert.ok(!text.includes('Tj'), `expected Tj to be gone: ${text}`);
  assert.match(text, / f ET$/, `expected a trailing fill operator before ET: ${text}`);
  // rect glyph: 1 moveto + 3 lineto, no explicit close (TrueType contours decode without a literal Z)
  assert.equal((text.match(/ m\b/g) || []).length, 1);
  assert.equal((text.match(/ l\b/g) || []).length, 3);
});

test('outlineFontsInPdf also accepts an sfnt program embedded as FontFile3 /OpenType', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const fontRef = await embedTestFont(doc, buildTestFont(), { wrapAsFontFile3OpenType: true });
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontRef } }));
  const content = doc.context.register(doc.context.flateStream('BT /F1 10 Tf 0 0 Td (A) Tj ET'));
  page.node.set(PDFName.of('Contents'), content);

  const { converted, unconverted } = outlineFontsInPdf(doc, new Set(['TestFont']));
  assert.deepEqual([...converted], ['TestFont']);
  assert.equal(unconverted.size, 0);
  assert.ok(!streamText(doc, content).includes('Tj'));
});

test('outlineFontsInPdf positions a second glyph using the first glyph\'s declared advance width', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const fontRef = await embedTestFont(doc, buildTestFont());
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontRef } }));
  const content = doc.context.register(doc.context.flateStream('BT /F1 10 Tf 0 0 Td (AB) Tj ET'));
  page.node.set(PDFName.of('Contents'), content);

  outlineFontsInPdf(doc, new Set(['TestFont']));
  const text = streamText(doc, content);
  const moves = [...text.matchAll(/(-?[\d.]+) (-?[\d.]+) m\b/g)].map(m => Number(m[1]));
  assert.equal(moves.length, 2);
  // 'A' advanceWidth=650/unitsPerEm=1000 * fontSize=10 = 6.5pt step between glyph origins
  assert.ok(Math.abs((moves[1] - moves[0]) - 6.5) < 1e-3, `expected ~6.5pt advance, got ${moves[1] - moves[0]}`);
});

test('outlineFontsInPdf refuses a non-embedded font and leaves its text byte-identical', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const fontDict = doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }));
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontDict } }));
  const source = 'BT /F1 10 Tf 0 0 Td (Hello) Tj ET';
  const content = doc.context.register(doc.context.flateStream(source));
  page.node.set(PDFName.of('Contents'), content);

  const { converted, unconverted } = outlineFontsInPdf(doc, new Set(['Helvetica']));
  assert.equal(converted.size, 0);
  assert.deepEqual([...unconverted], ['Helvetica']);
  assert.equal(streamText(doc, content), source);
});

function buildCidFontDict(doc, { encoding = 'Identity-H', cidToGidMap = null } = {}) {
  const fontFile = doc.context.register(doc.context.flateStream(buildTestFont(), {}));
  const descriptor = doc.context.register(doc.context.obj({ Type: 'FontDescriptor', FontName: 'TestFontCID', Flags: 32, FontFile2: fontFile }));
  const descendantEntries = { Type: 'Font', Subtype: 'CIDFontType2', BaseFont: 'TestFontCID', FontDescriptor: descriptor };
  if (cidToGidMap) descendantEntries.CIDToGIDMap = doc.context.register(doc.context.flateStream(cidToGidMap, {}));
  const descendant = doc.context.register(doc.context.obj(descendantEntries));
  return doc.context.register(doc.context.obj({
    Type: 'Font', Subtype: 'Type0', BaseFont: 'TestFontCID', Encoding: encoding, DescendantFonts: [descendant]
  }));
}

test('outlineFontsInPdf converts an Identity-H CIDFontType2 run (glyph index 1 = "A")', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const fontDict = buildCidFontDict(doc);
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontDict } }));
  const content = doc.context.register(doc.context.flateStream('BT /F1 10 Tf 0 0 Td <0001> Tj ET'));
  page.node.set(PDFName.of('Contents'), content);

  const { converted, unconverted } = outlineFontsInPdf(doc, new Set(['TestFontCID']));
  assert.deepEqual([...converted], ['TestFontCID']);
  assert.equal(unconverted.size, 0);
  const text = streamText(doc, content);
  assert.ok(!text.includes('Tj'));
  assert.equal((text.match(/ m\b/g) || []).length, 1);
});

test('outlineFontsInPdf follows a non-identity CIDToGIDMap stream', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  // Map CID 5 -> GID 2 ("B"); every other CID maps to 0 (.notdef).
  const cidToGidMap = new Uint8Array(12);
  cidToGidMap[10] = 0; cidToGidMap[11] = 2; // CID 5 is the 6th entry (bytes 10-11)
  const fontDict = buildCidFontDict(doc, { cidToGidMap });
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontDict } }));
  const content = doc.context.register(doc.context.flateStream('BT /F1 10 Tf 0 0 Td <0005> Tj ET'));
  page.node.set(PDFName.of('Contents'), content);

  const { converted } = outlineFontsInPdf(doc, new Set(['TestFontCID']));
  assert.deepEqual([...converted], ['TestFontCID']);
  const text = streamText(doc, content);
  // "B" is a 500-unit-wide rect vs "A"'s 600 - confirms GID 2 was used via the map, not CID 5 as a literal GID.
  assert.match(text, /\b5 0 l\b/, `expected B's 500-unit width (-> 5pt at fontsize 10) reflected: ${text}`);
});

test('outlineFontsInPdf refuses a vertical (Identity-V) CID font and leaves its text byte-identical', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const fontDict = buildCidFontDict(doc, { encoding: 'Identity-V' });
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontDict } }));
  const source = 'BT /F1 10 Tf 0 0 Td <0001> Tj ET';
  const content = doc.context.register(doc.context.flateStream(source));
  page.node.set(PDFName.of('Contents'), content);

  const { converted, unconverted } = outlineFontsInPdf(doc, new Set(['TestFontCID']));
  assert.equal(converted.size, 0);
  assert.deepEqual([...unconverted], ['TestFontCID']);
  assert.equal(streamText(doc, content), source);
});

test('outlineFontsInPdf is not selected (not operator-selected) leaves text untouched', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const fontRef = await embedTestFont(doc, buildTestFont());
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontRef } }));
  const source = 'BT /F1 10 Tf 0 0 Td (A) Tj ET';
  const content = doc.context.register(doc.context.flateStream(source));
  page.node.set(PDFName.of('Contents'), content);

  const { converted, unconverted } = outlineFontsInPdf(doc, new Set(['SomeOtherFont']));
  assert.equal(converted.size, 0);
  assert.equal(unconverted.size, 0);
  assert.equal(streamText(doc, content), source);
});

test('outlineFontsInPdf correctly positions outlined text inside a transformed Form XObject', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const fontRef = await embedTestFont(doc, buildTestFont());
  const formStream = doc.context.register(doc.context.flateStream('BT /F1 10 Tf 0 0 Td (A) Tj ET', {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 100, 100],
    Resources: { Font: { F1: fontRef } }
  }));
  page.node.set(PDFName.of('Resources'), doc.context.obj({ XObject: { Fm0: formStream } }));
  const content = doc.context.register(doc.context.flateStream('q 2 0 0 2 50 50 cm /Fm0 Do Q'));
  page.node.set(PDFName.of('Contents'), content);

  outlineFontsInPdf(doc, new Set(['TestFont']));
  const text = streamText(doc, formStream);
  assert.ok(!text.includes('Tj'));
  const [firstMove] = [...text.matchAll(/(-?[\d.]+) (-?[\d.]+) m\b/g)].map(m => [Number(m[1]), Number(m[2])]);
  // glyph origin (0,0) under Tm (identity) * CTM (scale 2, translate 50,50) = (50, 50)
  assert.ok(Math.abs(firstMove[0] - 50) < 1e-3 && Math.abs(firstMove[1] - 50) < 1e-3, `expected glyph origin at (50,50), got ${firstMove}`);
});
