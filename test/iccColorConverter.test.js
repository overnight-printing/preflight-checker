import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { instantiate } from 'lcms-wasm';
import { PDFDocument, PDFName } from 'pdf-lib';
import { createIccColorConverter } from '../src/utils/iccColorConverter.js';
import { getEmbeddedCmykProfile, getIccProfileInfo, getSpotAlternateInfo, MAX_ICC_BYTES } from '../src/utils/iccProfiles.js';

const engine = await instantiate();
const destination = new Uint8Array(await readFile(new URL('../public/profiles/SWOP2006_Coated3v2.icc', import.meta.url)));
const labBytes = new Uint8Array(await readFile(new URL('./fixtures/lab-d50.icc', import.meta.url)));
const rgbBytes = new Uint8Array(await readFile(new URL('./fixtures/srgb.icc', import.meta.url)));
const reference = JSON.parse(await readFile(new URL('./fixtures/icc-native-reference.json', import.meta.url)));

test('ICC conversion matches native LittleCMS for Lab and RGB, including the customer Pantone Lab value', async () => {
  const document = await PDFDocument.create();
  const lookup = value => document.context.lookup(value);
  const spaces = Object.fromEntries([['Lab', labBytes, 3], ['RGB', rgbBytes, 3]].map(([name, bytes, channels]) => [name, document.context.obj([
    'ICCBased', document.context.register(document.context.flateStream(bytes, { N: channels }))
  ])]));
  const converter = createIccColorConverter(engine, destination);
  try {
    for (const { source, input, expected } of reference.filter(sample => sample.source !== 'CMYK')) {
      const actual = converter.convert(spaces[source], input, lookup);
      actual.forEach((value, index) => assert.ok(Math.abs(value - expected[index]) < 0.0001, `${source} ${input}: ${actual} != ${expected}`));
    }
    const lab = document.context.obj(['Lab', { WhitePoint: [0.9642, 1, 0.8249] }]);
    const actual = converter.convert(lab, reference[0].input, lookup);
    actual.forEach((value, index) => assert.ok(Math.abs(value - reference[0].expected[index]) < 0.0001));
    assert.throws(() => converter.convert(spaces.Lab, [74, NaN, -1], lookup), /Invalid source/);
    assert.throws(() => converter.convert(spaces.Lab, [74, -200, -1], lookup), /outside/);
    assert.throws(() => converter.convert(spaces.RGB, [1, 0], lookup), /Invalid source/);
  } finally { converter.close(); }
  assert.throws(() => converter.convert(spaces.Lab, [74, -1, -1], lookup), /closed/);
});

test('ICC CMYK float values use percentages internally and remain normalized in PDF output', async () => {
  const document = await PDFDocument.create();
  const stream = document.context.register(document.context.flateStream(destination, { N: 4 }));
  const space = document.context.obj(['ICCBased', stream]);
  const converter = createIccColorConverter(engine, destination);
  try {
    const { input, expected } = reference.find(sample => sample.source === 'CMYK');
    const actual = converter.convert(space, input, value => document.context.lookup(value));
    actual.forEach((value, index) => assert.ok(value >= 0 && value <= 1 && Math.abs(value - expected[index]) < 0.0001));
  } finally { converter.close(); }
});

test('ICC target validation rejects monitor, incomplete, oversized, and display-only CMYK profiles', async () => {
  assert.equal(createHash('sha256').update(destination).digest('hex'), '27dc90dbeb399b76c0f91a6b387fe30c38939f034d2500712f3c43094be15e3b', 'the licensed SWOP profile stays unmodified');
  assert.throws(() => createIccColorConverter(engine, rgbBytes), /CMYK press/);
  assert.throws(() => getIccProfileInfo(destination.slice(0, 150)), /complete/);
  assert.throws(() => getIccProfileInfo(new Uint8Array(MAX_ICC_BYTES + 1)), /16 MB/);
  const displayOnly = new Uint8Array(await readFile(new URL('../node_modules/pdfjs-dist/iccs/CGATS001Compat-v2-micro.icc', import.meta.url)));
  assert.throws(() => createIccColorConverter(engine, displayOnly), /cannot convert Lab to CMYK/);
  const converter = createIccColorConverter(engine, destination);
  converter.close(); converter.close();
});

test('a single embedded CMYK output intent is reusable and Lab ICC is never classified by channel count alone', async () => {
  const document = await PDFDocument.create();
  document.addPage();
  const profile = document.context.register(document.context.flateStream(destination, { N: 4 }));
  const intent = document.context.obj({ DestOutputProfile: profile });
  document.catalog.set(PDFName.of('OutputIntents'), document.context.obj([intent]));
  assert.deepEqual(getEmbeddedCmykProfile(document).bytes, destination);
  document.catalog.set(PDFName.of('OutputIntents'), document.context.obj([intent, intent]));
  assert.equal(getEmbeddedCmykProfile(document), null, 'multiple output intents require an explicit target');
  document.catalog.set(PDFName.of('OutputIntents'), document.context.obj([intent]));
  document.context.lookup(profile).dict.set(PDFName.of('N'), PDFName.of('Invalid'));
  assert.equal(getEmbeddedCmykProfile(document), null, 'malformed profile channels do not crash the scan');
  const lab = document.context.register(document.context.flateStream(labBytes, { N: 3 }));
  const source = document.context.obj(['ICCBased', lab]);
  assert.deepEqual(getIccProfileInfo(labBytes), { colorSpace: 'Lab', channels: 3 });
  assert.deepEqual(getSpotAlternateInfo(source, value => document.context.lookup(value)), { needsProfile: true, reason: null });
});
