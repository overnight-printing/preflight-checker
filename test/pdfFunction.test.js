import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument } from 'pdf-lib';
import { evaluatePdfFunction } from '../src/utils/pdfFunction.js';

function closeArray(actual, expected, epsilon = 1e-6) {
  assert.equal(actual.length, expected.length);
  actual.forEach((value, i) => assert.ok(Math.abs(value - expected[i]) < epsilon, `index ${i}: ${value} != ${expected[i]}`));
}

test('Type 2 (exponential) interpolates linearly between C0 and C1 at N=1', async () => {
  const doc = await PDFDocument.create();
  const fn = doc.context.obj({ FunctionType: 2, Domain: [0, 1], C0: [0, 0, 0, 0], C1: [0, 1, 0.2, 0], N: 1 });
  const lookup = value => doc.context.lookup(value);
  closeArray(evaluatePdfFunction(fn, [0], lookup), [0, 0, 0, 0]);
  closeArray(evaluatePdfFunction(fn, [1], lookup), [0, 1, 0.2, 0]);
  closeArray(evaluatePdfFunction(fn, [0.5], lookup), [0, 0.5, 0.1, 0]);
});

test('Type 3 (stitching) dispatches into the right sub-function and re-encodes its sub-domain', async () => {
  const doc = await PDFDocument.create();
  const rampUp = doc.context.obj({ FunctionType: 2, Domain: [0, 1], C0: [0], C1: [1], N: 1 });
  const rampDown = doc.context.obj({ FunctionType: 2, Domain: [0, 1], C0: [1], C1: [0], N: 1 });
  const stitched = doc.context.obj({
    FunctionType: 3, Domain: [0, 1],
    Functions: [doc.context.register(rampUp), doc.context.register(rampDown)],
    Bounds: [0.5], Encode: [0, 1, 0, 1]
  });
  const lookup = value => doc.context.lookup(value);
  closeArray(evaluatePdfFunction(stitched, [0.25], lookup), [0.5]); // first half, encoded x = 0.5 of rampUp
  closeArray(evaluatePdfFunction(stitched, [0.75], lookup), [0.5]); // second half, encoded x = 0.5 of rampDown
  closeArray(evaluatePdfFunction(stitched, [0], lookup), [0]);
  closeArray(evaluatePdfFunction(stitched, [1], lookup), [0]);
});

test('Type 0 (sampled) multilinearly interpolates between table entries', async () => {
  const doc = await PDFDocument.create();
  const fn = doc.context.flateStream(Uint8Array.of(0, 255), {
    FunctionType: 0, Domain: [0, 1], Range: [0, 1], Size: [2], BitsPerSample: 8
  });
  const lookup = value => doc.context.lookup(value);
  closeArray(evaluatePdfFunction(fn, [0], lookup), [0]);
  closeArray(evaluatePdfFunction(fn, [1], lookup), [1], 1e-2);
  closeArray(evaluatePdfFunction(fn, [0.5], lookup), [0.5], 1e-2);
});

test('Type 0 (sampled) supports multiple outputs, mimicking a spot-to-CMYK table', async () => {
  const doc = await PDFDocument.create();
  // 2 samples (tint 0 and tint 1), 4 outputs (CMYK): tint 0 -> no ink, tint 1 -> solid black
  const fn = doc.context.flateStream(Uint8Array.of(0, 0, 0, 0, 0, 0, 0, 255), {
    FunctionType: 0, Domain: [0, 1], Range: [0, 1, 0, 1, 0, 1, 0, 1], Size: [2], BitsPerSample: 8
  });
  const lookup = value => doc.context.lookup(value);
  closeArray(evaluatePdfFunction(fn, [0], lookup), [0, 0, 0, 0]);
  closeArray(evaluatePdfFunction(fn, [1], lookup), [0, 0, 0, 1], 1e-2);
});

test('Type 4 (PostScript calculator) evaluates arithmetic, dup/exch, and if/ifelse branching', async () => {
  const doc = await PDFDocument.create();
  const fn = doc.context.flateStream('{ dup 0.5 lt { 2 mul } { pop 1 } ifelse }', {
    FunctionType: 4, Domain: [0, 1], Range: [0, 1]
  });
  const lookup = value => doc.context.lookup(value);
  closeArray(evaluatePdfFunction(fn, [0.3], lookup), [0.6]);
  closeArray(evaluatePdfFunction(fn, [0.7], lookup), [1]);
});

test('Type 4 (PostScript calculator) clamps results to Range', async () => {
  const doc = await PDFDocument.create();
  const fn = doc.context.flateStream('{ 10 mul }', { FunctionType: 4, Domain: [0, 1], Range: [0, 1] });
  const lookup = value => doc.context.lookup(value);
  closeArray(evaluatePdfFunction(fn, [0.5], lookup), [1]);
});

test('rejects an unsupported function type rather than guessing', async () => {
  const doc = await PDFDocument.create();
  const fn = doc.context.obj({ FunctionType: 99, Domain: [0, 1] });
  assert.throws(() => evaluatePdfFunction(fn, [0.5], value => doc.context.lookup(value)), /Unsupported PDF function type/);
});
