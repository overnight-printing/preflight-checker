export function requiresRebuiltPdfOutput({
  bleedAmount,
  trimCropEnabled,
  manualCropAmount,
  isCropMode,
  cropMarksEnabled = false
}) {
  return bleedAmount > 0 || trimCropEnabled || manualCropAmount > 0 || isCropMode || cropMarksEnabled;
}
