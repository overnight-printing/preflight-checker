export function validateCanvasSize(width, height, message = 'This artwork is too large for the browser (maximum 16384 pixels per edge and 40 megapixels). Use a smaller image or a desktop editor.') {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid artwork dimensions.');
  if (width > 16384 || height > 16384 || width * height > 40_000_000) throw new Error(message);
}

export function getCompatibilityRenderSize(box, dpi) {
  if (![300, 600].includes(dpi)) throw new Error('Choose 300 or 600 DPI for compatibility export.');
  const width = Math.ceil(box.width * dpi / 72 - 1e-7);
  const height = Math.ceil(box.height * dpi / 72 - 1e-7);
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid page dimensions for compatibility export.');
  validateCanvasSize(width, height, `This page is too large to flatten at ${dpi} DPI in the browser. Choose 300 DPI or use a desktop transparency flattener.`);
  return { width, height };
}
