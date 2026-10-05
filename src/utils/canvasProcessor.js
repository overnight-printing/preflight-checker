/**
 * Mathematical Mirror Bleed Draw Engine.
 * Expands a target canvas with mirrored edge reflections on all 4 borders & corners.
 * Includes a 1-pixel overlap to completely eliminate subpixel rendering gaps (black lines).
 *
 * @param {CanvasRenderingContext2D} ctx - Target canvas 2D context
 * @param {HTMLCanvasElement|HTMLImageElement} orig - Source artwork image/canvas
 * @param {number} W - Original width in pixels
 * @param {number} H - Original height in pixels
 * @param {number} B - Bleed size in pixels
 */
export function drawMirrorBleed(ctx, orig, W, H, B) {
  // Ensure we work with integer values to avoid subpixel interpolation
  W = Math.round(W);
  H = Math.round(H);
  B = Math.round(B);

  // 1. Center the original artwork inside the expanded canvas
  ctx.drawImage(orig, B, B, W, H);

  // 2. Left Edge (mirror horizontally)
  // We grab a slice of thickness B+1 and offset by -1 to create a 1px overlap
  ctx.save();
  ctx.translate(B, B);
  ctx.scale(-1, 1);
  ctx.drawImage(orig, 0, 0, B + 1, H, -1, 0, B + 1, H);
  ctx.restore();

  // 3. Right Edge (mirror horizontally)
  ctx.save();
  ctx.translate(B + W, B);
  ctx.scale(-1, 1);
  ctx.drawImage(orig, W - B - 1, 0, B + 1, H, -B, 0, B + 1, H);
  ctx.restore();

  // 4. Top Edge (mirror vertically)
  // Corrected: Target Y starts at -1 (for overlap) and drawing height B+1 reaches canvas top (0) under scale(-1)
  ctx.save();
  ctx.translate(B, B);
  ctx.scale(1, -1);
  ctx.drawImage(orig, 0, 0, W, B + 1, 0, -1, W, B + 1);
  ctx.restore();

  // 5. Bottom Edge (mirror vertically)
  // Corrected: Target Y starts at -B and drawing height B+1 reaches canvas bottom (B+H+B) under scale(-1)
  ctx.save();
  ctx.translate(B, B + H);
  ctx.scale(1, -1);
  ctx.drawImage(orig, 0, H - B - 1, W, B + 1, 0, -B, W, B + 1);
  ctx.restore();

  // 6. Corners (mirror both vertically & horizontally)
  // Top-Left Corner
  ctx.save();
  ctx.translate(B, B);
  ctx.scale(-1, -1);
  ctx.drawImage(orig, 0, 0, B + 1, B + 1, -1, -1, B + 1, B + 1);
  ctx.restore();

  // Top-Right Corner
  ctx.save();
  ctx.translate(B + W, B);
  ctx.scale(-1, -1);
  ctx.drawImage(orig, W - B - 1, 0, B + 1, B + 1, -B, -1, B + 1, B + 1);
  ctx.restore();

  // Bottom-Left Corner
  ctx.save();
  ctx.translate(B, B + H);
  ctx.scale(-1, -1);
  ctx.drawImage(orig, 0, H - B - 1, B + 1, B + 1, -1, -B, B + 1, B + 1);
  ctx.restore();

  // Bottom-Right Corner
  ctx.save();
  ctx.translate(B + W, B + H);
  ctx.scale(-1, -1);
  ctx.drawImage(orig, W - B - 1, H - B - 1, B + 1, B + 1, -B, -B, B + 1, B + 1);
  ctx.restore();
}


/**
 * Stitches the Union Bug onto an image artwork, applying Mirror Bleed if required.
 *
 * @param {HTMLCanvasElement} artworkCanvas - The high-quality rendered image artwork canvas
 * @param {HTMLCanvasElement} tintedBugCanvas - The pre-tinted bug canvas
 * @param {Object} position - Position in pixels relative to the artwork canvas
 * @param {Object} bugSize - Dimensions of the bug in pixels in the editor
 * @param {number} bleedPx - Bleed size in pixels (default 0)
 * @param {boolean} bugEnabled - If false, skips overlaying the bug (bleed only)
 * @returns {string} Final image DataURL
 */
export function stitchBugToImage(artworkCanvas, tintedBugCanvas, position, bugSize, bleedPx = 0, bugEnabled = true) {
  const outputCanvas = document.createElement('canvas');

  if (bleedPx === 0) {
    outputCanvas.width = artworkCanvas.width;
    outputCanvas.height = artworkCanvas.height;
    const ctx = outputCanvas.getContext('2d');

    ctx.drawImage(artworkCanvas, 0, 0);
    if (bugEnabled && tintedBugCanvas) {
      ctx.drawImage(tintedBugCanvas, position.left, position.top, bugSize.width, bugSize.height);
    }

    return outputCanvas.toDataURL('image/png');
  }

  // Expanded mirror bleed for image artwork
  const W = artworkCanvas.width;
  const H = artworkCanvas.height;

  outputCanvas.width = Math.round(W + (bleedPx * 2));
  outputCanvas.height = Math.round(H + (bleedPx * 2));

  const ctx = outputCanvas.getContext('2d');

  // Apply mirror bleed on the image canvas
  drawMirrorBleed(ctx, artworkCanvas, W, H, bleedPx);

  // Overlay the Union Bug if enabled
  if (bugEnabled && tintedBugCanvas) {
    ctx.drawImage(
      tintedBugCanvas,
      position.left,
      position.top,
      bugSize.width,
      bugSize.height
    );
  }

  return outputCanvas.toDataURL('image/png');
}
