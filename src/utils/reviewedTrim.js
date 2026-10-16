import { PDFName } from 'pdf-lib';
import { getPdfDocument } from './pdfSource.js';
import { getReviewedTrimBox, getVisibleBoxInsets } from './cropMarks.js';
import { rotatedSize } from './pdfGeometry.js';

export async function applyReviewedTrim(file, pageNumber, insets, segments = []) {
  const doc = await getPdfDocument(file, true);
  if (!Number.isInteger(pageNumber) || pageNumber < 1 || pageNumber > doc.getPageCount()) throw new Error('Invalid page number.');
  const page = doc.getPage(pageNumber - 1);
  const unit = doc.context.lookup(page.node.get(PDFName.of('UserUnit')))?.asNumber() || 1;
  if (unit !== 1) throw new Error('Review custom UserUnit scaling in a production PDF editor before setting trim.');
  const crop = page.getCropBox(), rotation = page.getRotation().angle;
  const media = page.getMediaBox();
  if (rotation % 90 !== 0 || ![crop, media].every(box => Object.values(box).every(Number.isFinite) && box.width > 0 && box.height > 0) ||
      crop.x < media.x || crop.y < media.y || crop.x + crop.width > media.x + media.width || crop.y + crop.height > media.y + media.height) throw new Error('Repair the PDF page bounds or rotation before setting trim.');
  const trim = getReviewedTrimBox(crop, rotation, insets);
  let bleed = trim;
  if (page.node.has(PDFName.of('BleedBox')) && segments.length) {
    const existing = page.getBleedBox();
    const edges = getVisibleBoxInsets(existing, crop, rotation);
    const size = rotatedSize(existing, rotation);
    const overlapsMarks = segments.some(line => Math.max(line.x1, line.x2) >= edges.left - 0.5 && Math.min(line.x1, line.x2) <= edges.left + size.width + 0.5 &&
      Math.max(line.y1, line.y2) >= edges.top - 0.5 && Math.min(line.y1, line.y2) <= edges.top + size.height + 0.5);
    if (Object.values(edges).every(value => value >= 0) && Object.values(edges).some(value => value > 0.1) &&
        existing.x <= trim.x && existing.y <= trim.y && existing.x + existing.width >= trim.x + trim.width && existing.y + existing.height >= trim.y + trim.height && !overlapsMarks) bleed = existing;
  }
  page.setTrimBox(trim.x, trim.y, trim.width, trim.height);
  page.setBleedBox(bleed.x, bleed.y, bleed.width, bleed.height);
  return doc.save({ useObjectStreams: true });
}
