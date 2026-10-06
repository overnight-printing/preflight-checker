export { drawMirrorBleed, stitchBugToImage } from './canvasProcessor';
import * as pdfjsLib from 'pdfjs-dist';
import {
  PDFDocument,
  PDFName,
  PDFRawStream,
  PDFArray,
  pushGraphicsState,
  popGraphicsState,
  rectangle,
  clip,
  endPath,
  concatTransformationMatrix,
  drawObject,
  setGraphicsState,
  degrees,
  decodePDFRawStream
} from 'pdf-lib';
import { requiresRebuiltPdfOutput } from './pdfExportRouting';
import { getOutputGeometry, rotateInsets, stampDrawOptions } from './pdfGeometry';
import { createPDFPageEmbedder } from './pdfPageEmbedding';
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

// Ship the matching worker with the app, including deployments under a base path.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * Loads a PDF file and returns the pdfjs document object.
 *
 * @param {File} file - The PDF file
 * @returns {Promise<pdfjsLib.PDFDocumentProxy>}
 */
export async function loadPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  return await loadingTask.promise;
}

/**
 * Extracts page box dimensions (CropBox, TrimBox, MediaBox, BleedBox) from a PDF page using pdf-lib.
 *
 * @param {File} file - The PDF file
 * @param {number} pageNum - 1-based page number
 * @returns {Promise<{cropBox: object, trimBox: object, mediaBox: object, bleedBox: object}>}
 */
const pdfMetadataCache = new WeakMap();

export async function getPDFBoxInfo(file, pageNum) {
  try {
    let documentPromise = pdfMetadataCache.get(file);
    if (!documentPromise) {
      documentPromise = file.arrayBuffer().then(bytes => PDFDocument.load(bytes));
      pdfMetadataCache.set(file, documentPromise);
    }
    const pdfDoc = await documentPromise;
    const pages = pdfDoc.getPages();
    if (pageNum < 1 || pageNum > pages.length) return null;
    const page = pages[pageNum - 1];

    // getTrimBox and other methods return PDFBox definitions { x, y, width, height }
    // Standard fallbacks if they are undefined in the PDF structure
    const mediaBox = page.getMediaBox() || { x: 0, y: 0, width: 0, height: 0 };
    const cropBox = page.getCropBox() || mediaBox;
    const rawTrimBox = page.getTrimBox() || cropBox;
    const trimBox = rawTrimBox;
    const rotation = page.getRotation().angle;
    const bleedBox = page.getBleedBox() || cropBox;

    // pdf-lib's getTrimBox() falls back to CropBox when TrimBox metadata is
    // missing. Preserve whether the returned box is actually useful as a cut
    // line instead of treating every PDF as if it had professional trim data.
    const trimInsets = {
      left: trimBox.x - cropBox.x,
      right: (cropBox.x + cropBox.width) - (trimBox.x + trimBox.width),
      bottom: trimBox.y - cropBox.y,
      top: (cropBox.y + cropBox.height) - (trimBox.y + trimBox.height)
    };
    const hasDistinctTrimBox = Object.values(trimInsets).some((value) => Math.abs(value) > 0.01);

    const bleedInsets = {
      left: trimBox.x - bleedBox.x,
      right: (bleedBox.x + bleedBox.width) - (trimBox.x + trimBox.width),
      bottom: trimBox.y - bleedBox.y,
      top: (bleedBox.y + bleedBox.height) - (trimBox.y + trimBox.height)
    };
    const bleedContainsTrim = Object.values(bleedInsets).every((value) => value >= -0.01);
    const hasDistinctBleedBox = hasDistinctTrimBox
      && bleedContainsTrim
      && Object.values(bleedInsets).some((value) => value > 0.01);

    return {
      mediaBox: { x: mediaBox.x, y: mediaBox.y, width: mediaBox.width, height: mediaBox.height },
      cropBox: { x: cropBox.x, y: cropBox.y, width: cropBox.width, height: cropBox.height },
      trimBox: { x: trimBox.x, y: trimBox.y, width: trimBox.width, height: trimBox.height },
      bleedBox: { x: bleedBox.x, y: bleedBox.y, width: bleedBox.width, height: bleedBox.height },
      hasDistinctTrimBox,
      hasSourceAnnotations: pages.some(sourcePage => {
        const annotations = pdfDoc.context.lookup(sourcePage.node.get(PDFName.of('Annots')));
        return annotations instanceof PDFArray && annotations.size() > 0;
      }),
      hasSourceForms: pdfDoc.catalog.has(PDFName.of('AcroForm')),
      rotation,
      trimInsets: rotateInsets(trimInsets, rotation),
      hasDistinctBleedBox,
      bleedInsets: rotateInsets(bleedInsets, rotation)
    };
  } catch (error) {
    console.error('Error in getPDFBoxInfo:', error);
    throw new Error(`Unable to read PDF page geometry: ${error.message}`, { cause: error });
  }
}

/**
 * Converts a hex color code (e.g. '#a855f7') into PDF RGB decimal values ('0.659 0.333 0.969')
 *
 * @param {string} hex - The hex color code
 * @returns {string|null} Space-separated RGB values or null
 */
function hexToPdfRgb(hex) {
  if (hex === 'original' || !hex) return null;
  const cleanHex = hex.replace('#', '');
  if (cleanHex.length !== 6) return null;
  const r = (parseInt(cleanHex.substring(0, 2), 16) / 255).toFixed(3);
  const g = (parseInt(cleanHex.substring(2, 4), 16) / 255).toFixed(3);
  const b = (parseInt(cleanHex.substring(4, 6), 16) / 255).toFixed(3);
  return `${r} ${g} ${b}`;
}

/**
 * Traverses PDF content streams and replaces black/grayscale coloring commands with target RGB color.
 * Maintains 100% vector shape integrity.
 *
 * @param {PDFDocument} bugDoc - The loaded Union Bug PDF document
 * @param {string} targetColor - The hex target color
 */
async function tintVectorPDF(bugDoc, targetColor) {
  const pdfRgb = hexToPdfRgb(targetColor);
  if (!pdfRgb) return; // Keep original black/grayscale
  // Process black and white must not introduce registration-prone RGB mixes.
  const fillColor = pdfRgb === '0.000 0.000 0.000' ? '0 g' : pdfRgb === '1.000 1.000 1.000' ? '1 g' : `${pdfRgb} rg`;
  const strokeColor = pdfRgb === '0.000 0.000 0.000' ? '0 G' : pdfRgb === '1.000 1.000 1.000' ? '1 G' : `${pdfRgb} RG`;

  const pages = bugDoc.getPages();
  if (pages.length === 0) return;
  const page = pages[0];

  const contents = bugDoc.context.lookup(page.node.get(PDFName.of('Contents')));
  if (!contents) return;

  const processStream = (stream) => {
    if (stream instanceof PDFRawStream) {
      try {
        const decodedStream = decodePDFRawStream(stream);
        const decompressed = decodedStream.decode();
        let text = Array.from(decompressed, byte => String.fromCharCode(byte)).join('');

        // Replace black colors: RGB ('0 0 0 rg' / '0 0 0 RG'), Grayscale ('0 g' / '0 G'), and CMYK ('0 0 0 1 k' / '0 0 0 1 K')
        // Supports decimals '0.0 0.0 0.0 rg' etc.
        text = text.replace(/\b0(\.0+)?\s+0(\.0+)?\s+0(\.0+)?\s+rg\b/g, fillColor);
        text = text.replace(/\b0(\.0+)?\s+0(\.0+)?\s+0(\.0+)?\s+RG\b/g, strokeColor);
        text = text.replace(/\b0(\.0+)?\s+g\b/g, fillColor);
        text = text.replace(/\b0(\.0+)?\s+G\b/g, strokeColor);
        text = text.replace(/\b0(\.0+)?\s+0(\.0+)?\s+0(\.0+)?\s+1(\.0+)?\s+k\b/g, fillColor);
        text = text.replace(/\b0(\.0+)?\s+0(\.0+)?\s+0(\.0+)?\s+1(\.0+)?\s+K\b/g, strokeColor);

        const newBytes = Uint8Array.from(text, character => character.charCodeAt(0));
        stream.contents = bugDoc.context.flateStream(newBytes).contents;
        stream.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
        stream.dict.delete(PDFName.of('DecodeParms'));
      } catch (e) {
        throw new Error('The Union Bug color could not be applied.', { cause: e });
      }
    }
  };

  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      const ref = contents.get(i);
      const stream = bugDoc.context.lookup(ref);
      processStream(stream);
    }
  } else {
    const stream = bugDoc.context.lookup(contents);
    processStream(stream);
  }  // Illustrator and other tools often keep the visible paths in nested Forms.
  for (const [, object] of bugDoc.context.enumerateIndirectObjects()) {
    if (object instanceof PDFRawStream && object.dict.get(PDFName.of('Subtype')) === PDFName.of('Form')) processStream(object);
  }

}

function drawClippedPageXObject(page, xObjectKey, clipRect, matrix) {
  page.pushOperators(
    pushGraphicsState(),
    rectangle(clipRect.x, clipRect.y, clipRect.width, clipRect.height),
    clip(),
    endPath(),
    concatTransformationMatrix(...matrix),
    drawObject(xObjectKey),
    popGraphicsState()
  );
}

function drawKnockoutStamp(page, stamp, placement) {
  const state = page.doc.context.register(page.doc.context.obj({
    Type: 'ExtGState', OP: false, op: false, OPM: 0,
    ca: 1, CA: 1, BM: 'Normal', SMask: 'None'
  }));
  const key = page.node.newExtGState('UnionBugKnockout', state);
  page.pushOperators(pushGraphicsState(), setGraphicsState(key));
  page.drawPage(stamp, placement);
  page.pushOperators(popGraphicsState());
}

function drawVectorPDFPageWithMirrorBleed(page, embeddedPage, baseBox, bleedPt) {
  const xObjectKey = page.node.newXObject('MirrorBleedPage', embeddedPage.ref);
  const overlap = 0.1;
  const drawSource = (clipRect, matrix) => drawClippedPageXObject(page, xObjectKey, {
    x: clipRect.x - overlap, y: clipRect.y - overlap,
    width: clipRect.width + 2 * overlap, height: clipRect.height + 2 * overlap
  }, matrix);
  const {
    x: sourceX = 0,
    y: sourceY = 0,
    width: baseWidth,
    height: baseHeight,
    bottomSampleOffsetX = 0,
    bottomSampleOffsetY = 0
  } = baseBox;

  if (bleedPt <= 0) {
    drawSource(
      { x: 0, y: 0, width: baseWidth, height: baseHeight },
      [1, 0, 0, 1, -sourceX, -sourceY]
    );
    return;
  }

  // Draw only the extra outside bleed, reusing the original PDF page resources.
  drawSource(
    { x: 0, y: bleedPt, width: bleedPt, height: baseHeight },
    [-1, 0, 0, 1, bleedPt + sourceX + overlap, bleedPt - sourceY]
  );

  drawSource(
    { x: bleedPt + baseWidth, y: bleedPt, width: bleedPt, height: baseHeight },
    [-1, 0, 0, 1, bleedPt + (baseWidth * 2) + sourceX - overlap, bleedPt - sourceY]
  );

  drawSource(
    { x: bleedPt, y: bleedPt + baseHeight, width: baseWidth, height: bleedPt },
    [1, 0, 0, -1, bleedPt - sourceX, bleedPt + (baseHeight * 2) + sourceY - overlap]
  );

  drawSource(
    { x: bleedPt, y: 0, width: baseWidth, height: bleedPt },
    [1, 0, 0, -1, bleedPt - sourceX, bleedPt + sourceY + bottomSampleOffsetY + overlap]
  );

  drawSource(
    { x: 0, y: bleedPt + baseHeight, width: bleedPt, height: bleedPt },
    [-1, 0, 0, -1, bleedPt + sourceX + overlap, bleedPt + (baseHeight * 2) + sourceY - overlap]
  );

  drawSource(
    { x: bleedPt + baseWidth, y: bleedPt + baseHeight, width: bleedPt, height: bleedPt },
    [-1, 0, 0, -1, bleedPt + (baseWidth * 2) + sourceX - overlap, bleedPt + (baseHeight * 2) + sourceY - overlap]
  );

  drawSource(
    { x: 0, y: 0, width: bleedPt, height: bleedPt },
    [-1, 0, 0, -1, bleedPt + sourceX + bottomSampleOffsetX + overlap, bleedPt + sourceY + bottomSampleOffsetY + overlap]
  );

  drawSource(
    { x: bleedPt + baseWidth, y: 0, width: bleedPt, height: bleedPt },
    [-1, 0, 0, -1, bleedPt + (baseWidth * 2) + sourceX - overlap, bleedPt + sourceY + bottomSampleOffsetY + overlap]
  );

  drawSource(
    { x: bleedPt, y: bleedPt, width: baseWidth, height: baseHeight },
    [1, 0, 0, 1, bleedPt - sourceX, bleedPt - sourceY]
  );
}

/**
 * Renders a PDF Union Bug to a canvas, tints it to a target color,
 * and keys out any white page background.
 *
 * @param {File} bugFile - The Union Bug PDF file
 * @param {string} targetColor - The hex color code (e.g. '#a855f7') or 'original'
 * @param {number} targetDPI - DPI scale factor (default 4x for 300+ DPI sharpness)
 * @returns {Promise<{canvas: HTMLCanvasElement, width: number, height: number}>}
 */
const bugPreviewCache = new WeakMap();

export async function processUnionBug(bugFile, targetColor = 'original', targetDPI = 4.0) {
  let cache = bugPreviewCache.get(bugFile);
  if (!cache) { cache = new Map(); bugPreviewCache.set(bugFile, cache); }
  const key = `${targetColor}:${targetDPI}`;
  if (!cache.has(key)) {
    // Keep a bounded number of previews as the custom color picker changes.
    if (cache.size >= 5) cache.delete(cache.keys().next().value);
    const promise = renderUnionBug(bugFile, targetColor, targetDPI);
    cache.set(key, promise);
    promise.catch(() => cache.delete(key));
  }
  return cache.get(key);
}

async function renderUnionBug(bugFile, targetColor, targetDPI) {
  const bugDoc = await loadPDF(bugFile);
  try {
    const page = await bugDoc.getPage(1); // Assume single-page PDF

    // Render bug to an offscreen canvas at high resolution
    const viewport = page.getViewport({ scale: targetDPI });
    const offscreenCanvas = document.createElement('canvas');
    offscreenCanvas.width = viewport.width;
    offscreenCanvas.height = viewport.height;

    const ctx = offscreenCanvas.getContext('2d');

    // Fill the canvas with solid white first.
    // This guarantees that any blank page background renders as pure white,
    // which our keying engine will mathematically remove.
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, offscreenCanvas.width, offscreenCanvas.height);

    await page.render({
      canvasContext: ctx,
      viewport
    }).promise;

    // Get raw pixel data
    const imgData = ctx.getImageData(0, 0, offscreenCanvas.width, offscreenCanvas.height);
    const data = imgData.data;

    // Parse target color if tinting is required
    const shouldTint = targetColor !== 'original' && targetColor;
    let rTarget = 0, gTarget = 0, bTarget = 0;

    if (shouldTint) {
      const hex = targetColor.replace('#', '');
      rTarget = parseInt(hex.substring(0, 2), 16);
      gTarget = parseInt(hex.substring(2, 4), 16);
      bTarget = parseInt(hex.substring(4, 6), 16);
    }

    // Single-pass pixel manipulation:
    // Keys out white background and applies colors with perfect anti-aliasing preserved!
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i+1];
      const b = data[i+2];

      // Average brightness
      const brightness = (r + g + b) / 3;

      // Smooth opacity: black/dark pixels become opaque, white pixels become transparent.
      // Preserves smooth gray anti-aliased edge transitions.
      const alpha = Math.max(0, Math.min(255, 255 - brightness));

      if (shouldTint) {
        data[i] = rTarget;
        data[i+1] = gTarget;
        data[i+2] = bTarget;
      } else {
        // Keep it original black/dark
        data[i] = 0;
        data[i+1] = 0;
        data[i+2] = 0;
      }

      // Set the transparency channel
      data[i+3] = alpha;
    }

    // Write modified pixels back to the canvas
    ctx.putImageData(imgData, 0, 0);

    return {
      canvas: offscreenCanvas,
      width: viewport.width,
      height: viewport.height
    };
  } finally { await bugDoc.destroy(); }
}

/**
 * Stitches the Union Bug onto the selected page(s) of the original PDF,
 * optionally applying an immaculate 3mm Mirror Bleed.
 *
 * @param {File} originalPDFFile - The original artwork PDF
 * @param {HTMLCanvasElement} tintedBugCanvas - The pre-tinted bug canvas
 * @param {Object} position - Position in pixels relative to the editor canvas
 * @param {Object} bugSize - Dimensions of the bug in pixels in the editor
 * @param {number} canvasScale - The scale factor used to render the editor canvas
 * @param {Array<number>} targetPages - Array of 1-based page indices to apply the bug
 * @param {number} currentPageIndex - The 1-based index of the currently viewed page
 * @param {number} bleedAmount - Bleed size in PDF points (default 0)
 * @param {boolean} bugEnabled - If false, skips drawing the Union Bug (bleed only)
 * @returns {Promise<Uint8Array>} Raw bytes of the stitched PDF
 */
export async function stitchBugToPDF(
  originalPDFFile,
  bugFile,
  targetColor,
  position,
  bugSize,
  canvasScale,
  targetPages = null,
  currentPageIndex = 1,
  bleedAmount = 0,
  bugEnabled = true,
  pagePositions = {},
  pageSizes = {},
  trimCropEnabled = false,
  manualCropAmount = 0,
  isCropMode = false
) {
  const originalBytes = await originalPDFFile.arrayBuffer();
  const pdfDoc = await PDFDocument.load(originalBytes);

  if (!bugEnabled && !requiresRebuiltPdfOutput({ bleedAmount, trimCropEnabled, manualCropAmount, isCropMode })) return new Uint8Array(originalBytes);
  const pages = pdfDoc.getPages();
  const pagesToStitch = targetPages ?? [currentPageIndex];
  if (bugEnabled && !bugFile) throw new Error('Load a Union Bug PDF before exporting.');
  if (isCropMode) throw new Error('Visual cropping is unavailable. Use TrimBox cropping and manual inset.');

  // Reuse one vector stamp per color in each output document.
  const bugBytes = bugEnabled && pagesToStitch.length > 0 ? await bugFile.arrayBuffer() : null;
  const embeddedBugs = new WeakMap();
  const getEmbeddedBug = async (document, pageNum) => {
    let cache = embeddedBugs.get(document);
    if (!cache) { cache = new Map(); embeddedBugs.set(document, cache); }
    const color = typeof targetColor === 'string' ? targetColor : targetColor[pageNum] || '#000000';
    if (!cache.has(color)) {
      try {
        let source = await PDFDocument.load(bugBytes);
        await tintVectorPDF(source, color);
        const sourcePage = source.getPage(0);
        const angle = ((sourcePage.getRotation().angle % 360) + 360) % 360;
        if (angle) {
          const box = sourcePage.getCropBox();
          const rotated = angle % 180 === 0 ? box : { width: box.height, height: box.width };
          const normalized = await PDFDocument.create();
          const page = normalized.addPage([rotated.width, rotated.height]);
          const original = await normalized.embedPage(sourcePage, { left: box.x, bottom: box.y, right: box.x + box.width, top: box.y + box.height });
          page.drawPage(original, {
            x: angle === 180 || angle === 270 ? rotated.width : 0,
            y: angle === 90 || angle === 180 ? rotated.height : 0,
            width: box.width, height: box.height, rotate: degrees(-angle)
          });
          source = normalized;
        }
        const [embedded] = await document.embedPdf(source, [0]);
        cache.set(color, embedded);
      } catch (error) {
        throw new Error(`Unable to embed the Union Bug: ${error.message}`, { cause: error });
      }
    }
    return cache.get(color);
  };

  // Option A: unchanged page geometry with an optional vector overlay.
  // Any requested trim/crop must use Option B so the output page boxes and
  // visible bounds are rebuilt around the selected trim boundary.
  if (!requiresRebuiltPdfOutput({ bleedAmount, trimCropEnabled, manualCropAmount, isCropMode })) {
    if (bugEnabled) {
      for (const pageNum of pagesToStitch) {
        if (pageNum < 1 || pageNum > pages.length) continue;

        const page = pages[pageNum - 1];
        const activePos = pagePositions[pageNum] || position;
        const activeSize = pageSizes[pageNum] || bugSize;
        const { angle, ...placement } = stampDrawOptions(activePos, activeSize, canvasScale, page.getCropBox(), page.getRotation().angle);
        drawKnockoutStamp(page, await getEmbeddedBug(pdfDoc, pageNum), { ...placement, rotate: degrees(angle) });
      }
    }

    return await pdfDoc.save({ useObjectStreams: true });
  }

  // Option B: rebuilt print output for bleed, TrimBox crop, or manual crop.
  // Trim-only and bleed-only output preserve the original page as vector PDF.
  const outputDoc = await PDFDocument.create();
  const embedArtworkPage = createPDFPageEmbedder(pdfDoc, outputDoc);
  for (let i = 0; i < pages.length; i++) {
    const pageNum = i + 1;
    const originalPage = pages[i];

    const { sourceBox, trimBox, outputBox } = getOutputGeometry({
      cropBox: originalPage.getCropBox(),
      trimBox: originalPage.getTrimBox()
    }, { trimCropEnabled, manualCropAmount, bleedAmount });
    const newPage = outputDoc.addPage([outputBox.width, outputBox.height]);
    newPage.setRotation(originalPage.getRotation());
    newPage.setMediaBox(0, 0, outputBox.width, outputBox.height);
    newPage.setCropBox(0, 0, outputBox.width, outputBox.height);
    newPage.setBleedBox(0, 0, outputBox.width, outputBox.height);
    newPage.setTrimBox(trimBox.x, trimBox.y, trimBox.width, trimBox.height);

    // Structurally blank pages also need a content stream to be embedded.
    if (!originalPage.node.get(PDFName.of('Contents'))) {
      originalPage.drawRectangle({ x: sourceBox.x, y: sourceBox.y, width: 0.01, height: 0.01, opacity: 0 });
    }
    const embeddedOriginalPage = await embedArtworkPage(originalPage, {
      left: sourceBox.x,
      bottom: sourceBox.y,
      right: sourceBox.x + sourceBox.width,
      top: sourceBox.y + sourceBox.height
    });
    drawVectorPDFPageWithMirrorBleed(newPage, embeddedOriginalPage, {
      x: 0, y: 0, width: sourceBox.width, height: sourceBox.height
    }, bleedAmount);

    // Overlay the vector Union Bug last so expanded bleed/crop output cannot cover it.
    if (bugEnabled && pagesToStitch.includes(pageNum)) {
      const activePos = pagePositions[pageNum] || position;
      const activeSize = pageSizes[pageNum] || bugSize;
      const { angle, ...bugRect } = stampDrawOptions(activePos, activeSize, canvasScale, outputBox, originalPage.getRotation().angle);

      drawKnockoutStamp(newPage, await getEmbeddedBug(outputDoc, pageNum), {
        x: bugRect.x,
        y: bugRect.y,
        width: bugRect.width,
        height: bugRect.height,
        rotate: degrees(angle)
      });
    }
  }

  return await outputDoc.save({ useObjectStreams: true });
}
