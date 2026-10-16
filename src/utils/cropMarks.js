import { rotateInsets, rotatedSize } from './pdfGeometry.js';

export { CROP_MARK_LENGTH, CROP_MARK_GAP, CROP_MARK_MARGIN, getCropMarkLines } from './pdfGeometry.js';

export function getUniformTrimInset(insets) {
  const values = ['top', 'right', 'bottom', 'left'].map(edge => insets[edge]);
  if (!values.every(value => Number.isFinite(value) && value >= 0) || Math.max(...values) - Math.min(...values) > 1.5) return null;
  return values.reduce((sum, value) => sum + value, 0) / 4;
}

// Insets are measured from the visible, upright page, in PDF points.
export function getReviewedTrimBox(cropBox, rotation, insets) {
  if (!['top', 'right', 'bottom', 'left'].every(edge => Number.isFinite(insets?.[edge]) && insets[edge] >= 0)) throw new Error('Trim insets must be finite, non-negative numbers.');
  const native = rotateInsets(insets, -rotation);
  const box = { x: cropBox.x + native.left, y: cropBox.y + native.bottom,
    width: cropBox.width - native.left - native.right, height: cropBox.height - native.top - native.bottom };
  if (box.width <= 0 || box.height <= 0) throw new Error('The trim insets remove the entire page. Reduce the insets.');
  return box;
}

export function getVisibleBoxInsets(box, cropBox, rotation) {
  return rotateInsets({ left: box.x - cropBox.x, bottom: box.y - cropBox.y,
    right: cropBox.x + cropBox.width - box.x - box.width, top: cropBox.y + cropBox.height - box.y - box.height }, rotation);
}

export function getReviewSize(cropBox, rotation, insets) {
  return rotatedSize(getReviewedTrimBox(cropBox, rotation, insets), rotation);
}
