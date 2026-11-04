// Shared cap: one canvas edge, and total canvas pixels, the browser can allocate reliably.
export function exceedsCanvasCap(width, height) {
  return width > 16384 || height > 16384 || width * height > 40_000_000;
}

export function validateCanvasSize(width, height, message = 'This artwork is too large for the browser (maximum 16384 pixels per edge and 40 megapixels). Use a smaller image or a desktop editor.') {
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid artwork dimensions.');
  if (exceedsCanvasCap(width, height)) throw new Error(message);
}

export function getCompatibilityRenderSize(box, dpi) {
  if (![300, 600].includes(dpi)) throw new Error('Choose 300 or 600 DPI for compatibility export.');
  const width = Math.ceil(box.width * dpi / 72 - 1e-7);
  const height = Math.ceil(box.height * dpi / 72 - 1e-7);
  if (![width, height].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid page dimensions for compatibility export.');
  validateCanvasSize(width, height, `This page is too large to flatten at ${dpi} DPI in the browser. Choose 300 DPI or use a desktop transparency flattener.`);
  return { width, height };
}

// Non-throwing feasibility check across every selected page for one DPI candidate,
// so the UI can tell the operator what fits before they commit to an export attempt.
// `boxes` are page sizes in points, already resolved to the same physical geometry
// getCompatibilityRenderSize consumes (CropBox intersected with MediaBox, UserUnit applied).
export function summarizeCompatibilityFit(boxes, dpi) {
  let totalPixels = 0;
  const perPage = boxes.map(box => {
    const width = Math.ceil(box.width * dpi / 72 - 1e-7);
    const height = Math.ceil(box.height * dpi / 72 - 1e-7);
    const validDimensions = [width, height].every(value => Number.isFinite(value) && value > 0);
    const fits = validDimensions && !exceedsCanvasCap(width, height);
    if (validDimensions) totalPixels += width * height;
    return { width: validDimensions ? width : null, height: validDimensions ? height : null, fits };
  });
  return { dpi, perPage, totalPixels, fits: perPage.every(page => page.fits) && totalPixels <= 120_000_000 };
}
