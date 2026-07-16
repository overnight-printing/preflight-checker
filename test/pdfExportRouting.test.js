import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresRebuiltPdfOutput } from '../src/utils/pdfExportRouting.js';

const unchanged = {
  bleedAmount: 0,
  trimCropEnabled: false,
  manualCropAmount: 0,
  isCropMode: false
};

test('keeps the fast vector path when page geometry is unchanged', () => {
  assert.equal(requiresRebuiltPdfOutput(unchanged), false);
});

test('rebuilds output when TrimBox cropping is enabled', () => {
  assert.equal(requiresRebuiltPdfOutput({ ...unchanged, trimCropEnabled: true }), true);
});

test('rebuilds output when bleed is added', () => {
  assert.equal(requiresRebuiltPdfOutput({ ...unchanged, bleedAmount: 9 }), true);
});

test('rebuilds output for manual and interactive crop modes', () => {
  assert.equal(requiresRebuiltPdfOutput({ ...unchanged, manualCropAmount: 0.072 }), true);
  assert.equal(requiresRebuiltPdfOutput({ ...unchanged, isCropMode: true }), true);
});
