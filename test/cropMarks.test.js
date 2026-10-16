import test from 'node:test';
import assert from 'node:assert/strict';
import { PDFDocument, PDFName, cmyk } from 'pdf-lib';
import { detectCropMarks } from '../src/utils/cropMarkDetection.js';
import { getCropMarkLines, getReviewedTrimBox, getVisibleBoxInsets } from '../src/utils/cropMarks.js';
import { getOutputGeometry } from '../src/utils/pdfGeometry.js';
import { applyReviewedTrim } from '../src/utils/reviewedTrim.js';
import { requiresRebuiltPdfOutput } from '../src/utils/pdfExportRouting.js';

const trim = { x: 36, y: 36, width: 288, height: 180 };
const artwork = { x: 21, y: 21, width: 318, height: 210 };
const lines = getCropMarkLines(trim, artwork);

function pixels(segments, scale = 2) {
  const width = 360 * scale, height = 252 * scale;
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const line of segments) {
    const left = Math.floor(Math.min(line.x1, line.x2) * scale), right = Math.ceil(Math.max(line.x1, line.x2) * scale);
    const top = Math.floor(Math.min(line.y1, line.y2) * scale), bottom = Math.ceil(Math.max(line.y1, line.y2) * scale);
    for (let y = top; y < Math.max(bottom, top + 1); y++) for (let x = left; x < Math.max(right, left + 1); x++) {
      const index = (y * width + x) * 4;
      data[index] = data[index + 1] = data[index + 2] = 0;
    }
  }
  return { data, width, height };
}

test('eight matching pixel marks propose a trim without guessing from page size', () => {
  const detection = detectCropMarks(pixels(lines), 360, 252);
  assert.equal(detection.status, 'found');
  assert.equal(detection.segments.length, 8);
  for (const inset of Object.values(detection.insets)) assert.ok(Math.abs(inset - 36) < 0.5);
  assert.equal(detectCropMarks(pixels([]), 360, 252).status, 'none');
  assert.equal(detectCropMarks(pixels(lines.slice(1)), 360, 252).status, 'none');
  const faint = pixels(lines);
  for (let i = 0; i < faint.data.length; i += 4) if (faint.data[i] === 0) faint.data[i] = faint.data[i + 1] = faint.data[i + 2] = 128;
  assert.equal(detectCropMarks(faint, 360, 252).status, 'found');
  const background = pixels([]);
  for (let i = 0; i < background.data.length; i += 4) background.data[i] = background.data[i + 1] = background.data[i + 2] = 0;
  assert.equal(detectCropMarks(background, 360, 252).status, 'none');
  const second = getCropMarkLines({ x: 45, y: 45, width: 270, height: 162 }, artwork);
  assert.equal(detectCropMarks(pixels([...lines, ...second]), 360, 252).status, 'ambiguous');
});

test('trim inset mapping round-trips rotations and offset source boxes', () => {
  const crop = { x: 10, y: 20, width: 360, height: 252 };
  const insets = { top: 20, right: 30, bottom: 40, left: 50 };
  for (const rotation of [0, 90, 180, 270]) {
    const box = getReviewedTrimBox(crop, rotation, insets);
    assert.deepEqual(getVisibleBoxInsets(box, crop, rotation), insets);
  }
  assert.throws(() => getReviewedTrimBox(crop, 0, { ...insets, left: -1 }));
  assert.throws(() => getReviewedTrimBox(crop, 0, { ...insets, right: 1000 }));
});

test('crop marks add paper outside bleed and keep trim dimensions unchanged', () => {
  const boxes = { cropBox: { x: 0, y: 0, width: 252, height: 144 }, trimBox: { x: 0, y: 0, width: 252, height: 144 } };
  const plain = getOutputGeometry(boxes, { bleedAmount: 9 });
  const marked = getOutputGeometry(boxes, { bleedAmount: 9, cropMarksEnabled: true });
  assert.deepEqual(marked.outputBox, { x: 0, y: 0, width: 312, height: 204 });
  assert.deepEqual(marked.artworkBox, { x: 21, y: 21, width: 270, height: 162 });
  assert.deepEqual(marked.trimBox, { ...plain.trimBox, x: 30, y: 30 });
  assert.equal(getCropMarkLines(marked.trimBox, marked.artworkBox).length, 8);
  assert.equal(requiresRebuiltPdfOutput({ cropMarksEnabled: true }), true);
  assert.equal(getOutputGeometry(boxes).markMargin, 0);
});

test('reviewed trim changes only boxes, retaining full page, streams and images', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([360, 252]);
  page.drawRectangle({ width: 360, height: 252, color: cmyk(1, 0, 0, 0) });
  const source = new File([await doc.save()], 'marked.pdf');
  const before = await PDFDocument.load(await source.arrayBuffer());
  const result = await PDFDocument.load(await applyReviewedTrim(source, 1, { top: 36, right: 36, bottom: 36, left: 36 }, lines));
  const output = result.getPage(0);
  assert.deepEqual(output.getMediaBox(), page.getMediaBox());
  assert.deepEqual(output.getCropBox(), page.getCropBox());
  assert.deepEqual(output.getTrimBox(), trim);
  assert.deepEqual(output.getBleedBox(), trim);
  const streams = pdf => pdf.context.lookup(pdf.getPage(0).node.get(PDFName.of('Contents'))).asArray().map(ref => [...pdf.context.lookup(ref).contents]);
  assert.deepEqual(streams(result), streams(before));
  await assert.rejects(applyReviewedTrim(source, 0, {}), /Invalid page/);
});

test('separate explicit bleed survives only when it excludes the old printed marks', async () => {
  const doc = await PDFDocument.create();
  const page = doc.addPage([360, 252]);
  page.setBleedBox(27, 27, 306, 198);
  const insets = { top: 36, right: 36, bottom: 36, left: 36 };
  let result = await PDFDocument.load(await applyReviewedTrim(new File([await doc.save()], 'bleed.pdf'), 1, insets, lines));
  assert.deepEqual(result.getPage(0).getBleedBox(), page.getBleedBox());
  page.setBleedBox(1, 1, 358, 250);
  result = await PDFDocument.load(await applyReviewedTrim(new File([await doc.save()], 'bad-bleed.pdf'), 1, insets, lines));
  assert.deepEqual(result.getPage(0).getBleedBox(), trim);
});
