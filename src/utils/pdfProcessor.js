import * as pdfjsLib from 'pdfjs-dist';
import { PDFDocument, PDFName, PDFRawStream, PDFArray } from 'pdf-lib';
import { decodePDFRawStream } from 'pdf-lib/es/core/streams/decode';

// Set up the PDF.js worker from jsDelivr CDN
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

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
export async function getPDFBoxInfo(file, pageNum) {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const pages = pdfDoc.getPages();
    if (pageNum < 1 || pageNum > pages.length) return null;
    const page = pages[pageNum - 1];
    
    // getTrimBox and other methods return PDFBox definitions { x, y, width, height }
    // Standard fallbacks if they are undefined in the PDF structure
    const mediaBox = page.getMediaBox() || { x: 0, y: 0, width: 0, height: 0 };
    const cropBox = page.getCropBox() || mediaBox;
    const trimBox = page.getTrimBox() || cropBox;
    const bleedBox = page.getBleedBox() || cropBox;
    
    return {
      mediaBox: { x: mediaBox.x, y: mediaBox.y, width: mediaBox.width, height: mediaBox.height },
      cropBox: { x: cropBox.x, y: cropBox.y, width: cropBox.width, height: cropBox.height },
      trimBox: { x: trimBox.x, y: trimBox.y, width: trimBox.width, height: trimBox.height },
      bleedBox: { x: bleedBox.x, y: bleedBox.y, width: bleedBox.width, height: bleedBox.height }
    };
  } catch (error) {
    console.error('Error in getPDFBoxInfo:', error);
    return null;
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

  const pages = bugDoc.getPages();
  if (pages.length === 0) return;
  const page = pages[0];
  
  const contents = page.node.get(PDFName.of('Contents'));
  if (!contents) return;

  const processStream = (stream) => {
    if (stream instanceof PDFRawStream) {
      try {
        const decodedStream = decodePDFRawStream(stream);
        const decompressed = decodedStream.decode();
        let text = new TextDecoder('utf-8').decode(decompressed);
        
        // Replace black colors: RGB ('0 0 0 rg' / '0 0 0 RG'), Grayscale ('0 g' / '0 G'), and CMYK ('0 0 0 1 k' / '0 0 0 1 K')
        // Supports decimals '0.0 0.0 0.0 rg' etc.
        text = text.replace(/\b0(\.0+)?\s+0(\.0+)?\s+0(\.0+)?\s+rg\b/g, `${pdfRgb} rg`);
        text = text.replace(/\b0(\.0+)?\s+0(\.0+)?\s+0(\.0+)?\s+RG\b/g, `${pdfRgb} RG`);
        text = text.replace(/\b0(\.0+)?\s+g\b/g, `${pdfRgb} rg`);
        text = text.replace(/\b0(\.0+)?\s+G\b/g, `${pdfRgb} RG`);
        text = text.replace(/\b0(\.0+)?\s+0(\.0+)?\s+0(\.0+)?\s+1(\.0+)?\s+k\b/g, `${pdfRgb} rg`);
        text = text.replace(/\b0(\.0+)?\s+0(\.0+)?\s+0(\.0+)?\s+1(\.0+)?\s+K\b/g, `${pdfRgb} RG`);
        
        const newBytes = new TextEncoder().encode(text);
        stream.contents = newBytes;
        
        // Delete Filter key so the PDF viewer parses the new content stream as raw plain text
        stream.dict.delete(PDFName.of('Filter'));
      } catch (e) {
        console.error('Error tinting vector stream:', e);
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
  }
}

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
 * Renders a PDF page to a target HTML5 Canvas, applying Mirror Bleed if needed.
 * 
 * @param {pdfjsLib.PDFPageProxy} page - The PDF page object
 * @param {HTMLCanvasElement} canvas - The destination canvas
 * @param {number} scale - Render scale (default 1.5 for high quality)
 * @param {number} bleedAmount - Bleed amount in PDF points (default 0)
 * @param {boolean} trimCropEnabled - If true, crops the render to the TrimBox
 * @param {Object} pdfBoxInfo - Box dimensions for the page
 * @param {number} manualCropAmount - Manual inset in PDF points
 * @returns {Promise<{width: number, height: number}>}
 */
export async function renderPDFPageToCanvas(page, canvas, scale = 1.5, bleedAmount = 0, trimCropEnabled = false, pdfBoxInfo = null, manualCropAmount = 0) {
  const viewport = page.getViewport({ scale });
  
  let originalWidth = viewport.width;
  let originalHeight = viewport.height;
  let offsetX = 0;
  let offsetY = 0;

  // If trim cropping is enabled, calculate the offset from CropBox to TrimBox
  if (trimCropEnabled && pdfBoxInfo && pdfBoxInfo.trimBox && pdfBoxInfo.cropBox) {
    const { trimBox, cropBox } = pdfBoxInfo;
    originalWidth = trimBox.width * scale;
    originalHeight = trimBox.height * scale;
    offsetX = (trimBox.x - cropBox.x) * scale;
    // PDF coordinates are Y-up, canvas is Y-down. 
    // CropBox height - (TrimBox Y - CropBox Y + TrimBox height)
    offsetY = (cropBox.height - (trimBox.y - cropBox.y + trimBox.height)) * scale;
  }

  // Apply manual offset (inset) on top of existing crop
  if (manualCropAmount > 0) {
    const manualOffsetPx = manualCropAmount * scale;
    originalWidth -= manualOffsetPx * 2;
    originalHeight -= manualOffsetPx * 2;
    offsetX += manualOffsetPx;
    offsetY += manualOffsetPx;
  }

  const bleedPx = Math.round(bleedAmount * scale);
  
  // Set canvas size (calculated base + bleed on all 4 edges)
  canvas.width = Math.round(originalWidth + (bleedPx * 2));
  canvas.height = Math.round(originalHeight + (bleedPx * 2));
  
  const canvasContext = canvas.getContext('2d', { willReadFrequently: true });
  
  // Helper to render the specific portion of the PDF page
  const renderToCtx = async (targetCtx, targetW, targetH) => {
    // Fill with white background
    targetCtx.fillStyle = '#ffffff';
    targetCtx.fillRect(0, 0, targetW, targetH);

    if (trimCropEnabled && pdfBoxInfo) {
      // Use a temporary canvas to render the full page, then draw the cropped portion
      const fullCanvas = document.createElement('canvas');
      fullCanvas.width = Math.round(viewport.width);
      fullCanvas.height = Math.round(viewport.height);
      const fullCtx = fullCanvas.getContext('2d');
      
      await page.render({
        canvasContext: fullCtx,
        viewport
      }).promise;

      targetCtx.drawImage(
        fullCanvas,
        Math.round(offsetX), Math.round(offsetY), Math.round(originalWidth), Math.round(originalHeight), // Source (TrimBox in full page)
        0, 0, Math.round(originalWidth), Math.round(originalHeight) // Destination (at origin of target)
      );
    } else {
      // Direct render
      await page.render({
        canvasContext: targetCtx,
        viewport
      }).promise;
    }
  };

  if (bleedPx > 0) {
    // Render the (optionally cropped) page to an offscreen temporary canvas
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = Math.round(originalWidth);
    tempCanvas.height = Math.round(originalHeight);
    const tempCtx = tempCanvas.getContext('2d');
    
    await renderToCtx(tempCtx, tempCanvas.width, tempCanvas.height);
    
    // Draw the centered page with mirrored bleed margins
    drawMirrorBleed(canvasContext, tempCanvas, originalWidth, originalHeight, bleedPx);
  } else {
    // Standard direct render (with optional cropping)
    await renderToCtx(canvasContext, canvas.width, canvas.height);
  }
  
  return {
    width: canvas.width,
    height: canvas.height
  };
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
export async function processUnionBug(bugFile, targetColor = 'original', targetDPI = 4.0) {
  const bugDoc = await loadPDF(bugFile);
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
  targetPages = [],
  currentPageIndex = 1,
  bleedAmount = 0,
  bugEnabled = true,
  pagePositions = {},
  pageSizes = {},
  trimCropEnabled = false,
  manualCropAmount = 0
) {
  const originalBytes = await originalPDFFile.arrayBuffer();
  const pdfDoc = await PDFDocument.load(originalBytes);
  
  const pages = pdfDoc.getPages();
  const pagesToStitch = targetPages.length > 0 ? targetPages : [currentPageIndex];
  
  // Load and prepare the Union Bug as a lossless vector PDF
  let embeddedBugPage = null;
  let embeddedBugPageForOutput = null; // Separate embedding context for Option B outputDoc
  let bugDocObj = null;

  if (bugEnabled && bugFile) {
    try {
      const bugBytes = await bugFile.arrayBuffer();
      bugDocObj = await PDFDocument.load(bugBytes);
      
      // Perform 100% lossless vector color modification on the streams!
      await tintVectorPDF(bugDocObj, targetColor);
      
      // Embed page 0 of the color-modified bug
      const embeddedArr = await pdfDoc.embedPdf(bugDocObj, [0]);
      embeddedBugPage = embeddedArr[0];
    } catch (e) {
      console.error('Error embedding vector union bug:', e);
    }
  }
  
  // Option A: Standard Vector Overlay (Bleed is Disabled AND no manual crop)
  // Note: if manualCrop is active, we MUST go through the rasterize-and-crop path (Option B)
  if (bleedAmount === 0 && manualCropAmount === 0) {
    if (bugEnabled && embeddedBugPage) {
      for (const pageNum of pagesToStitch) {
        if (pageNum < 1 || pageNum > pages.length) continue;
        
        const page = pages[pageNum - 1];
        const cropBox = page.getCropBox();
        const trimBox = page.getTrimBox() || cropBox;

        // If trimCropEnabled is true, we act as if the TrimBox IS the entire page area
        const activeBaseBox = trimCropEnabled ? trimBox : cropBox;

        const cropX = activeBaseBox.x;
        const cropY = activeBaseBox.y;
        const cropH = activeBaseBox.height;
        
        // Retrieve page-specific position and dimensions or fallback to defaults
        const activePos = pagePositions[pageNum] || position;
        const activeSize = pageSizes[pageNum] || bugSize;
        
        // Translate canvas pixels to PDF points, shifting by the active box origin to align with viewport
        const pdfX = cropX + (activePos.left / canvasScale);
        const pdfY = cropY + cropH - ((activePos.top + activeSize.height) / canvasScale);
        const pdfW = activeSize.width / canvasScale;
        const pdfH = activeSize.height / canvasScale;
        
        // Render 100% crisp vector page
        page.drawPage(embeddedBugPage, {
          x: pdfX,
          y: pdfY,
          width: pdfW,
          height: pdfH
        });
      }
    }
    
    return await pdfDoc.save();
  }
  
  // Option B: Expanded Print Output (Bleed OR Manual Crop Enabled)
  const outputDoc = await PDFDocument.create();
  const pdfjsDoc = await loadPDF(originalPDFFile);
  
  // Embed vector bug in the output doc context
  if (bugEnabled && bugDocObj) {
    const embeddedArrOutput = await outputDoc.embedPdf(bugDocObj, [0]);
    embeddedBugPageForOutput = embeddedArrOutput[0];
  }
  
  for (let i = 0; i < pages.length; i++) {
    const pageNum = i + 1;
    const originalPage = pages[i];
    
    // Base layout coordinates and page dimensions on the CropBox or TrimBox
    const cropBox = originalPage.getCropBox();
    const trimBox = originalPage.getTrimBox() || cropBox;
    
    // If trimCropEnabled is true, we act as if the TrimBox IS the entire page area
    const activeBaseBox = trimCropEnabled ? trimBox : cropBox;
    
    let origWidth = activeBaseBox.width;
    let origHeight = activeBaseBox.height;

    // Apply manual crop offset (inset)
    if (manualCropAmount > 0) {
      origWidth -= manualCropAmount * 2;
      origHeight -= manualCropAmount * 2;
    }
    
    // Expanded canvas dimensions
    const newWidth = origWidth + (bleedAmount * 2);
    const newHeight = origHeight + (bleedAmount * 2);
    
    const newPage = outputDoc.addPage([newWidth, newHeight]);
    
    // Render PDF page to a high-DPI canvas
    const pdfjsPage = await pdfjsDoc.getPage(pageNum);
    const renderScale = 3.5; // High definition print resolution
    const viewport = pdfjsPage.getViewport({ scale: renderScale });
    
    const highResCanvas = document.createElement('canvas');
    highResCanvas.width = Math.round((origWidth + (bleedAmount * 2)) * renderScale);
    highResCanvas.height = Math.round((origHeight + (bleedAmount * 2)) * renderScale);
    const hrCtx = highResCanvas.getContext('2d', { willReadFrequently: true });
    
    // Render original vector page to a temp canvas
    const tempCanvasFull = document.createElement('canvas');
    tempCanvasFull.width = Math.round(viewport.width);
    tempCanvasFull.height = Math.round(viewport.height);
    await pdfjsPage.render({
      canvasContext: tempCanvasFull.getContext('2d', { willReadFrequently: true }),
      viewport
    }).promise;

    // If cropped, we need just the TrimBox portion from the full render
    const tempCanvasBase = document.createElement('canvas');
    tempCanvasBase.width = Math.round(origWidth * renderScale);
    tempCanvasBase.height = Math.round(origHeight * renderScale);
    const tcbCtx = tempCanvasBase.getContext('2d', { willReadFrequently: true });
    
    const offsetX = ((trimCropEnabled ? (trimBox.x - cropBox.x) : 0) + manualCropAmount) * renderScale;
    const offsetY = ((trimCropEnabled ? (cropBox.height - (trimBox.y - cropBox.y + trimBox.height)) : 0) + manualCropAmount) * renderScale;
    tcbCtx.drawImage(
      tempCanvasFull,
      Math.round(offsetX), Math.round(offsetY), Math.round(origWidth * renderScale), Math.round(origHeight * renderScale),
      0, 0, Math.round(origWidth * renderScale), Math.round(origHeight * renderScale)
    );
    
    // Apply mirror bleed algorithm at high resolution (background layers only)
    drawMirrorBleed(hrCtx, tempCanvasBase, origWidth * renderScale, origHeight * renderScale, bleedAmount * renderScale);
    
    // Compress high-res canvas to PNG and embed in output PDF page
    const pageDataUrl = highResCanvas.toDataURL('image/png');
    const pageImg = await outputDoc.embedPng(pageDataUrl);
    
    newPage.drawImage(pageImg, {
      x: 0,
      y: 0,
      width: newWidth,
      height: newHeight
    });

    // Set professional prepress boxes for printing
    newPage.setMediaBox(0, 0, newWidth, newHeight);
    newPage.setCropBox(0, 0, newWidth, newHeight);
    newPage.setBleedBox(0, 0, newWidth, newHeight);
    
    // Position the TrimBox precisely, accounting for the bleed offset
    const newTrimX = trimCropEnabled ? (bleedAmount - manualCropAmount) : (bleedAmount + (trimBox.x - cropBox.x) - manualCropAmount);
    const newTrimY = trimCropEnabled ? (bleedAmount - manualCropAmount) : (bleedAmount + (trimBox.y - cropBox.y) - manualCropAmount);
    newPage.setTrimBox(newTrimX, newTrimY, trimBox.width, trimBox.height);

    // Overlay the vector Union Bug if enabled and targeted for this page
    if (bugEnabled && embeddedBugPageForOutput && pagesToStitch.includes(pageNum)) {
      const activePos = pagePositions[pageNum] || position;
      const activeSize = pageSizes[pageNum] || bugSize;
      
      const pdfX = activePos.left / canvasScale;
      const pdfY = newHeight - ((activePos.top + activeSize.height) / canvasScale);
      const pdfW = activeSize.width / canvasScale;
      const pdfH = activeSize.height / canvasScale;
      
      newPage.drawPage(embeddedBugPageForOutput, {
        x: pdfX,
        y: pdfY,
        width: pdfW,
        height: pdfH
      });
    }
  }
  
  return await outputDoc.save();
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
