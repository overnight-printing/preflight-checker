export function requiresRebuiltPdfOutput({
  bleedAmount,
  trimCropEnabled,
  manualCropAmount,
  isCropMode
}) {
  return bleedAmount > 0 || trimCropEnabled || manualCropAmount > 0 || isCropMode;
}
