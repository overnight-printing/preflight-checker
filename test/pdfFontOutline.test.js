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

// opentype.js's own Font writer emits a complete CFF-flavored ('OTTO') sfnt.
// Pulling just its 'CFF ' table out gives a real, portable, license-free bare
// CFF program to test the FontFile3 /Type1C path against - no binary fixture
// checked in, no system-font dependency.
function extractCffTable(sfntBytes) {
  const view = new DataView(sfntBytes.buffer, sfntBytes.byteOffset, sfntBytes.byteLength);
  const numTables = view.getUint16(4);
  for (let i = 0; i < numTables; i++) {
    const entryOffset = 12 + i * 16;
    const tag = String.fromCharCode(...sfntBytes.slice(entryOffset, entryOffset + 4));
    if (tag === 'CFF ') {
      const offset = view.getUint32(entryOffset + 8);
      const length = view.getUint32(entryOffset + 12);
      return sfntBytes.slice(offset, offset + length);
    }
  }
  throw new Error('no CFF table found');
}

function embedBareCffFont(doc, cffBytes, { baseFont = 'TestCFFFont', encoding = 'WinAnsiEncoding' } = {}) {
  const fontFile = doc.context.register(doc.context.flateStream(cffBytes, { Subtype: 'Type1C' }));
  const descriptor = doc.context.register(doc.context.obj({ Type: 'FontDescriptor', FontName: baseFont, Flags: 32, FontFile3: fontFile }));
  const fontDict = { Type: 'Font', Subtype: 'Type1', BaseFont: baseFont, Encoding: encoding, FontDescriptor: descriptor };
  return doc.context.register(doc.context.obj(fontDict));
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
  assert.match(text, /ET q .* f Q BT/, 'paths must paint outside BT/ET');
  assert.ok(text.includes('6 7 l'), 'glyph extends above the baseline, not below it');
  assert.ok(!text.includes('Tf'), 'removed fonts must not leave dangling selectors');
  // rect glyph: 1 moveto + 3 lineto, no explicit close (TrueType contours decode without a literal Z)
  assert.equal((text.match(/ m\b/g) || []).length, 1);
  assert.equal((text.match(/ l\b/g) || []).length, 3);

  // Without this, the fontEmbedding preflight check (which scans resource
  // dicts, not actual Tf usage) would see the font as still "present" and
  // keep offering Create Outlines forever, even though its text was already
  // converted - this is the bug a real user hit.
  assert.equal(page.node.Resources().lookup(PDFName.of('Font')).get(PDFName.of('F1')), undefined);
});

test('outlineFontsInPdf leaves a font\'s resource entry in place when any of its text was left unconverted', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const fontRef = await embedTestFont(doc, buildTestFont());
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontRef } }));
  // 'A' resolves (code 65); 'Z' (code 90) has no glyph in the fixture font, so this run is unconvertible.
  const content = doc.context.register(doc.context.flateStream('BT /F1 10 Tf 0 0 Td (A) Tj 0 0 Td (Z) Tj ET'));
  page.node.set(PDFName.of('Contents'), content);

  const { converted, unconverted } = outlineFontsInPdf(doc, new Set(['TestFont']));
  assert.equal(converted.size, 0);
  assert.deepEqual([...unconverted], ['TestFont']);
  assert.equal(streamText(doc, content), 'BT /F1 10 Tf 0 0 Td (A) Tj 0 0 Td (Z) Tj ET');
  assert.ok(page.node.Resources().lookup(PDFName.of('Font')).get(PDFName.of('F1')) !== undefined, 'font resource should survive since not everything converted');
});

function buildType3FontDict(doc, { charProcBody = '500 0 d0 0 0 500 500 re f', baseFont = 'TestType3' } = {}) {
  const charProc = doc.context.register(doc.context.flateStream(charProcBody));
  return doc.context.register(doc.context.obj({
    Type: 'Font', Subtype: 'Type3', BaseFont: baseFont,
    FontMatrix: [0.001, 0, 0, 0.001, 0, 0],
    FontBBox: [0, 0, 500, 500],
    CharProcs: { square: charProc },
    Encoding: { Differences: [65, 'square'] },
    FirstChar: 65, LastChar: 65, Widths: [500]
  }));
}

test('outlineFontsInPdf inlines a Type3 CharProc, stripping the leading d0 and transforming via FontMatrix', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const fontRef = buildType3FontDict(doc);
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontRef } }));
  const content = doc.context.register(doc.context.flateStream('BT /F1 10 Tf 0 0 Td (A) Tj ET'));
  page.node.set(PDFName.of('Contents'), content);

  const { converted, unconverted } = outlineFontsInPdf(doc, new Set(['TestType3']));
  assert.deepEqual([...converted], ['TestType3']);
  assert.equal(unconverted.size, 0);

  const text = streamText(doc, content);
  assert.ok(!text.includes('Tj'), `expected Tj to be gone: ${text}`);
  assert.ok(!text.includes('d0'), `expected the d0 operator to be stripped: ${text}`);
  // FontMatrix [0.001,...] x fontSize 10 => 0.01 scale; CharProc's own "re f" survives verbatim.
  assert.match(text, /q 0\.01 0 0 0\.01 0 0 cm 0 0 500 500 re f Q/, `unexpected inlined CharProc: ${text}`);
});

test('outlineFontsInPdf refuses a Type3 font whose CharProc references a named resource', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const fontRef = buildType3FontDict(doc, { charProcBody: '500 0 d0 /Im0 Do' });
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontRef } }));
  const source = 'BT /F1 10 Tf 0 0 Td (A) Tj ET';
  const content = doc.context.register(doc.context.flateStream(source));
  page.node.set(PDFName.of('Contents'), content);

  const { converted, unconverted } = outlineFontsInPdf(doc, new Set(['TestType3']));
  assert.equal(converted.size, 0);
  assert.deepEqual([...unconverted], ['TestType3']);
  assert.equal(streamText(doc, content), source);
});

test('outlineFontsInPdf refuses a Type3 font with no /Differences (no way to map codes to glyph names)', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const charProc = doc.context.register(doc.context.flateStream('500 0 d0 0 0 500 500 re f'));
  const fontRef = doc.context.register(doc.context.obj({
    Type: 'Font', Subtype: 'Type3', BaseFont: 'TestType3NoEncoding',
    FontMatrix: [0.001, 0, 0, 0.001, 0, 0], FontBBox: [0, 0, 500, 500],
    CharProcs: { square: charProc }, FirstChar: 65, LastChar: 65, Widths: [500]
  }));
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontRef } }));
  const source = 'BT /F1 10 Tf 0 0 Td (A) Tj ET';
  const content = doc.context.register(doc.context.flateStream(source));
  page.node.set(PDFName.of('Contents'), content);

  const { converted, unconverted } = outlineFontsInPdf(doc, new Set(['TestType3NoEncoding']));
  assert.equal(converted.size, 0);
  assert.deepEqual([...unconverted], ['TestType3NoEncoding']);
  assert.equal(streamText(doc, content), source);
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

// Confirmed directly against a real customer-submitted print PDF where every
// embedded font used exactly this: FontFile3 /Type1C, WinAnsiEncoding, no
// /Differences. opentype.parse() can't read a bare CFF program at all (no
// sfnt wrapper), so this exercises wrapBareCffAsOpenType + the
// glyph-name-first resolution path (the only one that works here, since the
// synthetic wrapper's cmap is intentionally empty).
test('outlineFontsInPdf converts a bare CFF program (FontFile3 /Type1C) with no /Differences', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const cffBytes = extractCffTable(buildTestFont());
  const fontRef = embedBareCffFont(doc, cffBytes);
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontRef } }));
  const content = doc.context.register(doc.context.flateStream('BT /F1 10 Tf 0 0 Td (AB) Tj ET'));
  page.node.set(PDFName.of('Contents'), content);

  const { converted, unconverted } = outlineFontsInPdf(doc, new Set(['TestCFFFont']));
  assert.deepEqual([...converted], ['TestCFFFont']);
  assert.equal(unconverted.size, 0);

  const text = streamText(doc, content);
  assert.ok(!text.includes('Tj'), `expected Tj to be gone: ${text}`);
  // two rect glyphs (A: 600x700, B: 500x700 per buildTestFont) -> 2 moveto + 6 lineto
  assert.equal((text.match(/ m\b/g) || []).length, 2);
  assert.equal((text.match(/ l\b/g) || []).length, 6);
});

test('outlineFontsInPdf resolves a bare CFF glyph via an explicit /Differences name even without a real cmap', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const cffBytes = extractCffTable(buildTestFont());
  // Map code 1 (an otherwise-meaningless WinAnsi control code) to glyph name 'B'.
  const fontRef = embedBareCffFont(doc, cffBytes, { encoding: { Differences: [1, 'B'] } });
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontRef } }));
  const content = doc.context.register(doc.context.flateStream('BT /F1 10 Tf 0 0 Td <01> Tj ET'));
  page.node.set(PDFName.of('Contents'), content);

  const { converted, unconverted } = outlineFontsInPdf(doc, new Set(['TestCFFFont']));
  assert.deepEqual([...converted], ['TestCFFFont']);
  assert.equal(unconverted.size, 0);
  const text = streamText(doc, content);
  assert.equal((text.match(/ m\b/g) || []).length, 1);
});

test('outlineFontsInPdf refuses a non-embedded font with no FontFile2/FontFile3 at all', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const descriptor = doc.context.register(doc.context.obj({ Type: 'FontDescriptor', FontName: 'NoProgram', Flags: 32 }));
  const fontDict = doc.context.register(doc.context.obj({ Type: 'Font', Subtype: 'Type1', BaseFont: 'NoProgram', Encoding: 'WinAnsiEncoding', FontDescriptor: descriptor }));
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontDict } }));
  const source = 'BT /F1 10 Tf 0 0 Td (A) Tj ET';
  const content = doc.context.register(doc.context.flateStream(source));
  page.node.set(PDFName.of('Contents'), content);

  const { converted, unconverted } = outlineFontsInPdf(doc, new Set(['NoProgram']));
  assert.equal(converted.size, 0);
  assert.deepEqual([...unconverted], ['NoProgram']);
  assert.equal(streamText(doc, content), source);
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

test('outlineFontsInPdf uses PDF widths rather than conflicting embedded font metrics', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const fontRef = await embedTestFont(doc, buildTestFont());
  const font = doc.context.lookup(fontRef);
  font.set(PDFName.of('FirstChar'), doc.context.obj(65));
  font.set(PDFName.of('Widths'), doc.context.obj([900, 800]));
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontRef } }));
  const content = doc.context.register(doc.context.flateStream('BT /F1 10 Tf (AB) Tj ET'));
  page.node.set(PDFName.of('Contents'), content);
  outlineFontsInPdf(doc, new Set(['TestFont']));
  const moves = [...streamText(doc, content).matchAll(/(-?[\d.]+) (-?[\d.]+) m\b/g)].map(m => Number(m[1]));
  assert.deepEqual(moves, [0, 9]);
});

test('outlineFontsInPdf preserves a mixed selected/unselected text object byte for byte', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const fontRef = await embedTestFont(doc, buildTestFont());
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: {
    F1: fontRef, F2: { Type: 'Font', Subtype: 'Type1', BaseFont: 'Helvetica' }
  } }));
  const source = 'BT /F1 10 Tf (AB) Tj /F2 10 Tf (Keep text) Tj ET';
  const content = doc.context.register(doc.context.flateStream(source));
  page.node.set(PDFName.of('Contents'), content);
  const result = outlineFontsInPdf(doc, new Set(['TestFont']));
  assert.equal(streamText(doc, content), source);
  assert.equal(result.converted.size, 0);
  assert.deepEqual([...result.unconverted], ['TestFont']);
});

test('outlineFontsInPdf retains font resources used by clipping or invisible text', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const fontRef = await embedTestFont(doc, buildTestFont());
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontRef } }));
  const untouched = 'BT /F1 10 Tf 4 Tr (A) Tj ET';
  const content = doc.context.register(doc.context.flateStream('BT /F1 10 Tf (A) Tj ET ' + untouched));
  page.node.set(PDFName.of('Contents'), content);
  const result = outlineFontsInPdf(doc, new Set(['TestFont']));
  assert.deepEqual([...result.unconverted], ['TestFont']);
  assert.ok(streamText(doc, content).endsWith(untouched));
  assert.equal(page.node.Resources().lookup(PDFName.of('Font')).get(PDFName.of('F1')), fontRef);
});

test('outlineFontsInPdf handles quoted text line moves and text objects split across streams', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const fontRef = await embedTestFont(doc, buildTestFont());
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontRef } }));
  page.node.set(PDFName.of('Contents'), doc.context.obj([
    doc.context.register(doc.context.flateStream('q 2 0 0 2 10 10 cm BT /F1 10 Tf 10 TL 10 50 Td (A) Tj')),
    doc.context.register(doc.context.flateStream('(A) \' 2 3 (A) " ET Q'))
  ]));
  const result = outlineFontsInPdf(doc, new Set(['TestFont']));
  assert.deepEqual([...result.converted], ['TestFont']);
  const text = streamText(doc, page.node.get(PDFName.of('Contents')));
  const moves = [...text.matchAll(/(-?[\d.]+) (-?[\d.]+) m\b/g)].map(m => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(moves, [[10, 50], [10, 40], [10, 30]]);
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

test('outlineFontsInPdf honors both array and range forms of CID PDF widths', async () => {
  for (const [widths, expected] of [[[1, [900, 800]], 9], [[1, 2, 700], 7]]) {
    const doc = await PDFDocument.create();
    const page = doc.addPage([200, 200]);
    const font = buildCidFontDict(doc);
    const descendant = doc.context.lookup(doc.context.lookup(font).lookup(PDFName.of('DescendantFonts')).get(0));
    descendant.set(PDFName.of('W'), doc.context.obj(widths));
    page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: font } }));
    const content = doc.context.register(doc.context.flateStream('BT /F1 10 Tf <00010002> Tj ET'));
    page.node.set(PDFName.of('Contents'), content);
    outlineFontsInPdf(doc, new Set(['TestFontCID']));
    const moves = [...streamText(doc, content).matchAll(/(-?[\d.]+) (-?[\d.]+) m\b/g)].map(m => Number(m[1]));
    assert.deepEqual(moves, [0, expected]);
  }
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
  // The Form's caller applies its matrix when drawing; baking it into the path applies it twice.
  assert.deepEqual(firstMove, [0, 0]);
});

test('outlineFontsInPdf renders bare CFF text identically under page and shared Form transforms', async () => {
  const { createCanvas, DOMMatrix, ImageData, Path2D } = await import('@napi-rs/canvas');
  Object.assign(globalThis, { DOMMatrix, ImageData, Path2D });
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const doc = await PDFDocument.create();
  const page = doc.addPage([200, 200]);
  const fontRef = embedBareCffFont(doc, extractCffTable(buildTestFont()));
  const font = doc.context.lookup(fontRef);
  font.set(PDFName.of('FirstChar'), doc.context.obj(65));
  font.set(PDFName.of('Widths'), doc.context.obj([650, 600]));
  const form = doc.context.register(doc.context.flateStream('BT /F1 20 Tf 10 10 Td (AB) Tj ET', {
    Type: 'XObject', Subtype: 'Form', BBox: [0, 0, 50, 50], Matrix: [1, 0, 0.2, 1, 0, 0],
    Resources: { Font: { F1: fontRef } }
  }));
  page.node.set(PDFName.of('Resources'), doc.context.obj({ Font: { F1: fontRef }, XObject: { Fm: form } }));
  page.node.set(PDFName.of('Contents'), doc.context.register(doc.context.flateStream(
    'q 1.5 0 0 1.5 10 10 cm BT /F1 20 Tf 10 10 Td (AB) Tj ET Q q 1 0 0 1 10 70 cm /Fm Do Q q 0 1 -1 0 170 100 cm /Fm Do Q'
  )));
  const render = async bytes => {
    const proxy = await pdfjs.getDocument({ data: bytes, disableFontFace: true }).promise;
    try {
      const page = await proxy.getPage(1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = createCanvas(viewport.width, viewport.height);
      const context = canvas.getContext('2d');
      await page.render({ canvasContext: context, viewport }).promise;
      return context.getImageData(0, 0, canvas.width, canvas.height).data;
    } finally { await proxy.destroy(); }
  };
  const before = await render(await doc.save());
  const result = outlineFontsInPdf(doc, new Set(['TestCFFFont']));
  assert.deepEqual([...result.converted], ['TestCFFFont']);
  const after = await render(await doc.save());
  let changed = 0;
  for (let i = 0; i < before.length; i += 4) if (Math.abs(before[i] - after[i]) > 16) changed++;
  assert.ok(changed < 100, `${changed} pixels changed after outlining`);
});
