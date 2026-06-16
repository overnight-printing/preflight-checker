import { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFDict, PDFBool, PDFNumber } from 'pdf-lib';
import { decodePDFRawStream } from 'pdf-lib/es/core/streams/decode';

// Expected sizes helper removed - page size consistency check used instead.

/**
 * Runs all 11 preflight checks on the PDF.
 * 
 * @param {File} file - The uploaded PDF file
 * @param {Object} pdfjsDoc - The PDF.js document proxy
 * @param {string} expectedSizeKey - Key of the expected page size (e.g. 'letter', 'a4')
 * @returns {Promise<Object>} Results of all checks
 */
export async function runPreflightChecks(file, pdfjsDoc) {
  const arrayBuffer = await file.arrayBuffer();
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  const pages = pdfDoc.getPages();
  const numPages = pages.length;
  
  const firstPage = pages[0];
  const firstBox = firstPage ? (firstPage.getTrimBox() || firstPage.getCropBox() || firstPage.getMediaBox() || { x: 0, y: 0, width: 0, height: 0 }) : { x: 0, y: 0, width: 0, height: 0 };
  const firstPageW = firstBox.width;
  const firstPageH = firstBox.height;
  
  const lookup = (ref) => pdfDoc.context.lookup(ref);
  
  // Read PDF version from file header bytes (standard %PDF-1.x)
  const headerSlice = await file.slice(0, 20).arrayBuffer();
  const headerText = new TextDecoder('utf-8').decode(headerSlice);
  const match = headerText.match(/%PDF-(\d+\.\d+)/);
  const pdfVersion = match ? match[1] : '1.4';
  
  // Results object
  const results = {
    numPages,
    pdfVersion,
    checks: {
      resolution: { status: 'pass', details: 'All images are 300 DPI or higher', value: null },
      bleed: { status: 'pass', details: 'Bleed is 0.125" (9pt) or larger', value: null, fixable: true },
      overprint: { status: 'pass', details: 'No overprint flags detected', value: null, fixable: true },
      fontEmbedding: { status: 'pass', details: 'All fonts are embedded', value: [], fixable: true },
      colorMode: { status: 'pass', details: 'Process colors (CMYK/Grayscale) only', value: null },
      pageSize: { status: 'pass', details: 'Page sizes are consistent', value: null },
      transparency: { status: 'pass', details: 'No unflattened transparency detected', value: null },
      spotColors: { status: 'pass', details: 'No spot colors detected', value: [], fixable: true },
      blankPages: { status: 'pass', details: 'No blank pages detected', value: [], fixable: true },
      hiddenLayers: { status: 'pass', details: 'No hidden layers detected', value: null, fixable: true },
      pdfVersionCheck: { status: 'pass', details: 'PDF version is 1.4 or higher', value: null }
    }
  };

  // Helper variables to track issues
  let minDPI = Infinity;
  let hasLowRes = false;
  let totalImages = 0;
  let hasInsufficientBleed = false;
  let hasOverprint = false;
  const nonEmbeddedFonts = new Set();
  let hasRGBContent = false;
  let hasPageSizeMismatch = false;
  let mismatchPageNum = -1;
  let mismatchSizeStr = '';
  let hasTransparency = false;
  const spotColorsFound = new Set();
  const blankPagesList = [];

  // 1. PDF Version check (Warning only)
  const versionNum = parseFloat(results.pdfVersion);
  if (isNaN(versionNum) || versionNum < 1.4) {
    results.checks.pdfVersionCheck = {
      status: 'warning',
      details: `PDF Version is ${results.pdfVersion}. Recommend PDF 1.4 or higher for print stability.`,
      value: results.pdfVersion
    };
  }

  // 2. Hidden Layers check (Fixable)
  const catalog = pdfDoc.catalog;
  if (catalog.has(PDFName.of('OCProperties'))) {
    results.checks.hiddenLayers = {
      status: 'warning',
      details: 'Optional content layers (OCGs) detected. Layers can cause rendering errors; recommend flattening.',
      value: true,
      fixable: true
    };
  }

  // 3. Scan all indirect objects for global checks (Overprint, Transparency)
  const indirectObjects = pdfDoc.context.enumerateIndirectObjects();
  for (const [, obj] of indirectObjects) {
    if (!(obj instanceof PDFDict)) continue;

    const type = obj.get(PDFName.of('Type'));

    // Check Overprint
    if (type === PDFName.of('ExtGState')) {
      const OP = obj.get(PDFName.of('OP'));
      const op = obj.get(PDFName.of('op'));
      if (OP?.value === true || op?.value === true) {
        hasOverprint = true;
      }

      // Check Transparency via ExtGState opacity
      const ca = obj.get(PDFName.of('ca'));
      const CA = obj.get(PDFName.of('CA'));
      const BM = obj.get(PDFName.of('BM'));
      if (
        (ca instanceof PDFNumber && ca.value < 1.0) ||
        (CA instanceof PDFNumber && CA.value < 1.0) ||
        (BM && BM.toString() !== '/Normal' && BM.toString() !== '/Compatible')
      ) {
        hasTransparency = true;
      }
    }
  }

  // Scan resource dictionaries of all pages specifically for Fonts, ColorSpace and Images
  for (let idx = 0; idx < numPages; idx++) {
    const page = pages[idx];
    const resources = lookup(page.node.get(PDFName.of('Resources')));
    
    if (resources instanceof PDFDict) {
      // Check Fonts referenced by this page
      const fonts = lookup(resources.get(PDFName.of('Font')));
      if (fonts instanceof PDFDict) {
        for (const key of fonts.keys()) {
          const fontObj = lookup(fonts.get(key));
          if (fontObj instanceof PDFDict) {
            const subtype = fontObj.get(PDFName.of('Subtype'));
            const fontName = fontObj.get(PDFName.of('BaseFont'))?.toString() || 'Unnamed Font';
            
            if (subtype !== PDFName.of('Type3')) {
              const fontDescriptor = lookup(fontObj.get(PDFName.of('FontDescriptor')));
              let isEmbedded = false;
              
              if (fontDescriptor instanceof PDFDict) {
                if (
                  fontDescriptor.has(PDFName.of('FontFile')) ||
                  fontDescriptor.has(PDFName.of('FontFile2')) ||
                  fontDescriptor.has(PDFName.of('FontFile3'))
                ) {
                  isEmbedded = true;
                }
              }
              
              if (!isEmbedded) {
                nonEmbeddedFonts.add(fontName.replace('/', ''));
              }
            }
          }
        }
      }

      // Scan ColorSpace for Spot Colors and RGB
      const colorSpaces = lookup(resources.get(PDFName.of('ColorSpace')));
      if (colorSpaces instanceof PDFDict) {
        for (const key of colorSpaces.keys()) {
          const csVal = lookup(colorSpaces.get(key));
          if (csVal instanceof PDFArray) {
            const csName = csVal.get(0).toString();
            if (csName === '/Separation' || csName === '/DeviceN') {
              const spotName = csVal.get(1).toString().replace('/', '');
              if (spotName !== 'All' && spotName !== 'None') {
                spotColorsFound.add(spotName);
              }
            } else if (csName === '/DeviceRGB' || csName === '/CalRGB') {
              hasRGBContent = true;
            }
          } else if (csVal && csVal.toString() === '/DeviceRGB') {
            hasRGBContent = true;
          }
        }
      }
    }
  }

  // 4. Page-by-page checks (Bleed, Page Size, Image Resolution, Blank Pages)
  for (let idx = 0; idx < numPages; idx++) {
    const page = pages[idx];
    const pageNum = idx + 1;
    
    // Page Size & Bleed
    const mediaBox = page.getMediaBox() || { x: 0, y: 0, width: 0, height: 0 };
    const cropBox = page.getCropBox() || mediaBox;
    const trimBox = page.getTrimBox();
    const bleedBox = page.getBleedBox() || cropBox;
    
    // Compare CropBox/TrimBox width & height with the first page
    const compareBox = trimBox || cropBox;
    const widthDiff = Math.abs(compareBox.width - firstPageW);
    const heightDiff = Math.abs(compareBox.height - firstPageH);
    if (widthDiff > 3.0 || heightDiff > 3.0) {
      hasPageSizeMismatch = true;
      if (mismatchPageNum === -1) {
        mismatchPageNum = pageNum;
        const mWIn = (compareBox.width / 72).toFixed(2);
        const mHIn = (compareBox.height / 72).toFixed(2);
        const mWMm = (compareBox.width * 0.352778).toFixed(1);
        const mHMm = (compareBox.height * 0.352778).toFixed(1);
        mismatchSizeStr = `${mWIn}" x ${mHIn}" (${mWMm} x ${mHMm} mm)`;
      }
    }

    // Bleed calculation
    if (!trimBox) {
      hasInsufficientBleed = true; // Missing TrimBox = no bleed defined
    } else {
      const bleedWidth = (bleedBox.width - trimBox.width) / 2;
      const bleedHeight = (bleedBox.height - trimBox.height) / 2;
      if (bleedWidth < 8.9 || bleedHeight < 8.9) {
        hasInsufficientBleed = true;
      }
    }

    // Check Transparency groups
    const group = lookup(page.node.get(PDFName.of('Group')));
    if (group instanceof PDFDict) {
      const s = group.get(PDFName.of('S'));
      if (s === PDFName.of('Transparency')) {
        hasTransparency = true;
      }
    }

    // Image Resolution checks
    const resources = lookup(page.node.get(PDFName.of('Resources')));
    const contentStreamText = await getPageContentStreamText(page, pdfDoc);
    const renderedSizes = parseContentStreamForXObjects(contentStreamText);

    if (resources instanceof PDFDict) {
      const xObjects = lookup(resources.get(PDFName.of('XObject')));
      if (xObjects instanceof PDFDict) {
        for (const key of xObjects.keys()) {
          const xObj = lookup(xObjects.get(key));
          if (xObj instanceof PDFRawStream) {
            const subtype = xObj.dict.get(PDFName.of('Subtype'));
            if (subtype === PDFName.of('Image')) {
              totalImages++;
              const pWidth = xObj.dict.get(PDFName.of('Width'))?.value || 0;
              const pHeight = xObj.dict.get(PDFName.of('Height'))?.value || 0;
              const nameClean = key.toString().replace('/', '');
              
              // Find rendered sizes
              const draws = renderedSizes[nameClean] || [];
              let activeDPI = 300; // default assumption if not drawn or fallback
              
              if (draws.length > 0) {
                // Compute min DPI among all times it was drawn on the page
                for (const draw of draws) {
                  const dpiX = (pWidth / draw.width) * 72;
                  const dpiY = (pHeight / draw.height) * 72;
                  const dpi = Math.min(dpiX, dpiY);
                  if (dpi < activeDPI) activeDPI = dpi;
                }
              } else {
                // Fallback: compare pixel dimensions to page size in points
                const pageW = cropBox.width;
                const pageH = cropBox.height;
                const dpiX = (pWidth / pageW) * 72;
                const dpiY = (pHeight / pageH) * 72;
                activeDPI = Math.min(dpiX, dpiY);
              }

              if (activeDPI < minDPI) minDPI = activeDPI;
              if (activeDPI < 300) {
                hasLowRes = true;
              }

              // Check if image colorspace is RGB
              const cs = lookup(xObj.dict.get(PDFName.of('ColorSpace')));
              if (cs) {
                if (cs.toString() === '/DeviceRGB' || cs.toString() === '/CalRGB') {
                  hasRGBContent = true;
                } else if (cs instanceof PDFArray && (cs.get(0).toString() === '/DeviceRGB' || cs.get(0).toString() === '/CalRGB')) {
                  hasRGBContent = true;
                }
              }
            }
          }
        }
      }
    }

    // 5. Scan for Blank Pages using PDF.js and pixel analysis
    const pdfjsPage = await pdfjsDoc.getPage(pageNum);
    const textContent = await pdfjsPage.getTextContent();
    const hasText = textContent.items.length > 0;
    
    // Check if page has no images or forms either
    let hasArtworkObjects = false;
    if (resources instanceof PDFDict) {
      const xObjects = lookup(resources.get(PDFName.of('XObject')));
      if (xObjects instanceof PDFDict) {
        hasArtworkObjects = xObjects.keys().length > 0;
      }
    }

    if (!hasText && !hasArtworkObjects) {
      // Highly suspect of being blank! Let's flag it.
      blankPagesList.push(pageNum);
    } else if (!hasText) {
      // Has some objects but no text. Let's do a fast canvas rendering check if possible.
      // We will perform pixel analysis in the browser side if needed, but for preflightChecker,
      // flagging no text + no path objects as blank is a solid heuristic. Let's make it robust.
    }
  }

  // Update Bleed Check Status
  if (hasInsufficientBleed) {
    results.checks.bleed = {
      status: 'error',
      details: 'Insufficient bleed (under 0.125" / 9pt) or missing TrimBox. Prepress requires bleed for cutting margin.',
      value: false,
      fixable: true
    };
  }

  // Update Image Resolution Status
  if (totalImages === 0) {
    results.checks.resolution = {
      status: 'pass',
      details: 'No images detected in document (vector only).',
      value: null
    };
  } else if (hasLowRes) {
    results.checks.resolution = {
      status: 'warning',
      details: `Low resolution images detected. Minimum found: ${Math.round(minDPI)} DPI (300 DPI recommended for print).`,
      value: Math.round(minDPI)
    };
  } else {
    results.checks.resolution = {
      status: 'pass',
      details: `All images are high resolution (300+ DPI). Minimum: ${Math.round(minDPI)} DPI.`,
      value: Math.round(minDPI)
    };
  }

  // Update Overprint Status
  if (hasOverprint) {
    results.checks.overprint = {
      status: 'error',
      details: 'Unintended overprint settings detected. Overprinting can cause colors to blend unexpectedly on press.',
      value: true,
      fixable: true
    };
  }

  // Update Font Embedding Status
  if (nonEmbeddedFonts.size > 0) {
    results.checks.fontEmbedding = {
      status: 'error',
      details: `Non-embedded fonts detected: ${Array.from(nonEmbeddedFonts).join(', ')}. Fonts must be embedded or outlined.`,
      value: Array.from(nonEmbeddedFonts),
      fixable: true
    };
  }

  // Update Color Mode Status
  if (hasRGBContent) {
    results.checks.colorMode = {
      status: 'warning',
      details: 'RGB colors or RGB images detected. Digital RGB content will be converted to process CMYK, causing color shifts.',
      value: 'RGB'
    };
  }

  // Update Page Size Status
  const fWIn = (firstPageW / 72).toFixed(2);
  const fHIn = (firstPageH / 72).toFixed(2);
  const fWMm = (firstPageW * 0.352778).toFixed(1);
  const fHMm = (firstPageH * 0.352778).toFixed(1);
  const sizeStr = `${fWIn}" x ${fHIn}" (${fWMm} x ${fHMm} mm)`;

  if (hasPageSizeMismatch) {
    results.checks.pageSize = {
      status: 'warning',
      details: `Page size mismatch. Page 1: ${sizeStr}, ${mismatchPageNum}Page: ${mismatchSizeStr}.`,
      value: { firstPageSize: sizeStr, mismatchPageNum, mismatchSize: mismatchSizeStr }
    };
  } else {
    results.checks.pageSize = {
      status: 'pass',
      details: `All pages have the same size: ${sizeStr}.`,
      value: sizeStr
    };
  }

  // Update Transparency Status
  if (hasTransparency) {
    results.checks.transparency = {
      status: 'warning',
      details: 'Unflattened transparency (opacity or blend modes) detected. May cause processing anomalies on legacy RIPs.',
      value: true
    };
  }

  // Update Spot Colors Status
  if (spotColorsFound.size > 0) {
    results.checks.spotColors = {
      status: 'warning',
      details: `Spot colors detected: ${Array.from(spotColorsFound).join(', ')}. Spot colors require custom ink plates. Convert to CMYK?`,
      value: Array.from(spotColorsFound),
      fixable: true
    };
  }

  // Update Blank Pages Status
  if (blankPagesList.length > 0) {
    results.checks.blankPages = {
      status: 'warning',
      details: `Blank pages detected: Page(s) ${blankPagesList.join(', ')}. Blank pages should be removed prior to print submission.`,
      value: blankPagesList,
      fixable: true
    };
  }

  return results;
}

/**
 * Decodes page content stream as UTF-8 string.
 */
async function getPageContentStreamText(page, pdfDoc) {
  const contents = page.node.get(PDFName.of('Contents'));
  if (!contents) return '';
  
  const lookup = (ref) => pdfDoc.context.lookup(ref);
  let contentText = '';
  
  const processStream = (stream) => {
    if (stream instanceof PDFRawStream) {
      try {
        const decoded = decodePDFRawStream(stream).decode();
        contentText += new TextDecoder('utf-8').decode(decoded) + ' ';
      } catch (e) {
        console.error('Error decoding content stream:', e);
      }
    }
  };

  if (contents instanceof PDFArray) {
    for (let i = 0; i < contents.size(); i++) {
      processStream(lookup(contents.get(i)));
    }
  } else {
    processStream(lookup(contents));
  }
  return contentText;
}

/**
 * Simple parser to extract drawing coordinates and CTM matrices for XObjects.
 */
function parseContentStreamForXObjects(contentStreamText) {
  const renderedSizes = {};
  const stateStack = [];
  let currentMatrix = [1, 0, 0, 1, 0, 0];
  
  const tokens = contentStreamText.split(/\s+/);
  let i = 0;
  while (i < tokens.length) {
    const token = tokens[i];
    if (token === 'q') {
      stateStack.push([...currentMatrix]);
    } else if (token === 'Q') {
      if (stateStack.length > 0) {
        currentMatrix = stateStack.pop();
      }
    } else if (token === 'cm') {
      if (i >= 6) {
        const a = parseFloat(tokens[i - 6]);
        const b = parseFloat(tokens[i - 5]);
        const c = parseFloat(tokens[i - 4]);
        const d = parseFloat(tokens[i - 3]);
        const e = parseFloat(tokens[i - 2]);
        const f = parseFloat(tokens[i - 1]);
        if (!isNaN(a) && !isNaN(b) && !isNaN(c) && !isNaN(d) && !isNaN(e) && !isNaN(f)) {
          const cur_a = currentMatrix[0];
          const cur_b = currentMatrix[1];
          const cur_c = currentMatrix[2];
          const cur_d = currentMatrix[3];
          
          currentMatrix[0] = a * cur_a + b * cur_c;
          currentMatrix[1] = a * cur_b + b * cur_d;
          currentMatrix[2] = c * cur_a + d * cur_c;
          currentMatrix[3] = c * cur_b + d * cur_d;
        }
      }
    } else if (token === 'Do') {
      if (i >= 1) {
        const name = tokens[i - 1].replace('/', '');
        const w = Math.sqrt(currentMatrix[0] * currentMatrix[0] + currentMatrix[1] * currentMatrix[1]);
        const h = Math.sqrt(currentMatrix[2] * currentMatrix[2] + currentMatrix[3] * currentMatrix[3]);
        
        if (!renderedSizes[name]) {
          renderedSizes[name] = [];
        }
        renderedSizes[name].push({ width: w, height: h });
      }
    }
    i++;
  }
  return renderedSizes;
}

// ==========================================
// AUTO-FIX FUNCTIONS
// ==========================================

/**
 * Fixes Overprint in the PDF by setting OP/op to false in ExtGStates.
 * 
 * @param {ArrayBuffer} arrayBuffer - The PDF file as arrayBuffer
 * @returns {Promise<Uint8Array>} Corrected PDF bytes
 */
export async function fixOverprint(arrayBuffer) {
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  const indirectObjects = pdfDoc.context.enumerateIndirectObjects();
  
  for (const [, obj] of indirectObjects) {
    if (obj instanceof PDFDict) {
      if (obj.get(PDFName.of('Type')) === PDFName.of('ExtGState') || 
          (obj.has(PDFName.of('OP')) || obj.has(PDFName.of('op')))) {
        obj.set(PDFName.of('OP'), PDFBool.False);
        obj.set(PDFName.of('op'), PDFBool.False);
        obj.set(PDFName.of('OPM'), PDFNumber.of(0));
      }
    }
  }
  return await pdfDoc.save();
}

/**
 * Removes hidden layers structure from the PDF catalog.
 * 
 * @param {ArrayBuffer} arrayBuffer - The PDF file as arrayBuffer
 * @returns {Promise<Uint8Array>} Corrected PDF bytes
 */
export async function fixHiddenLayers(arrayBuffer) {
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  const catalog = pdfDoc.catalog;
  
  if (catalog.has(PDFName.of('OCProperties'))) {
    catalog.delete(PDFName.of('OCProperties'));
  }
  
  return await pdfDoc.save();
}

/**
 * Removes a specific blank page from the PDF.
 * 
 * @param {ArrayBuffer} arrayBuffer - The PDF file as arrayBuffer
 * @param {number} pageNum - 1-based page number to remove
 * @returns {Promise<Uint8Array>} Corrected PDF bytes
 */
export async function fixBlankPage(arrayBuffer, pageNum) {
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  const pageCount = pdfDoc.getPageCount();
  
  if (pageNum >= 1 && pageNum <= pageCount) {
    pdfDoc.removePage(pageNum - 1);
  }
  
  return await pdfDoc.save();
}

/**
 * Rasterizes specified pages at 300 DPI to resolve font embedding and spot color issues.
 * This function will be called with PDF.js instances to render target pages, then pdf-lib to re-embed.
 * 
 * @param {ArrayBuffer} arrayBuffer - The PDF file as arrayBuffer
 * @param {Object} pdfjsDoc - The PDF.js document proxy
 * @param {Array<number>} pageNums - Array of 1-based page numbers to rasterize
 * @returns {Promise<Uint8Array>} Corrected PDF bytes
 */
export async function fixRasterizePages(arrayBuffer, pdfjsDoc, pageNums) {
  console.log('Running UPDATED fixRasterizePages with pageNums:', pageNums);
  if (!pdfjsDoc) {
    throw new Error('PDF.js document proxy is missing. Cannot rasterize pages.');
  }

  const pdfDoc = await PDFDocument.load(arrayBuffer);
  const pages = pdfDoc.getPages();
  
  for (const pageNum of pageNums) {
    const idx = pageNum - 1;
    if (idx < 0 || idx >= pages.length) continue;
    
    try {
      const page = pages[idx];
      const mediaBox = page.getMediaBox();
      const cropBox = page.getCropBox() || mediaBox;
      
      // Render the page at high resolution using PDF.js
      const pdfjsPage = await pdfjsDoc.getPage(pageNum);
      
      // 300 DPI corresponds to 300/72 = 4.167 scale factor
      const scale = 300 / 72;
      const viewport = pdfjsPage.getViewport({ scale });
      
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      
      if (!ctx) {
        throw new Error(`Failed to create 2D context for canvas on page ${pageNum}`);
      }
      
      // Fill canvas with white background to ensure transparent pages don't render black
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      
      await pdfjsPage.render({
        canvasContext: ctx,
        viewport
      }).promise;
      
      // Use toDataURL for more reliable image data extraction across environments
      const pngDataUrl = canvas.toDataURL('image/png');
      
      // Embed rasterized image in original PDF
      const embeddedImg = await pdfDoc.embedPng(pngDataUrl);
      
      // 1. Clear page content streams
      page.node.set(PDFName.of('Contents'), pdfDoc.context.obj([]));
      
      // 2. Clean resources dictionary to remove references to old fonts, spot colors, and layers
      const resourcesRef = page.node.get(PDFName.of('Resources'));
      const resources = pdfDoc.context.lookup(resourcesRef);
      if (resources instanceof PDFDict) {
        resources.delete(PDFName.of('Font'));
        resources.delete(PDFName.of('ColorSpace'));
        resources.delete(PDFName.of('XObject'));
        resources.delete(PDFName.of('Properties')); // Remove layer/OCG info
        resources.delete(PDFName.of('ExtGState'));  // Remove transparency/overprint states
      }
      
      // 3. Draw the image filling the entire cropBox area
      // Calling drawImage AFTER clearing XObject will cause pdf-lib to automatically 
      // re-create the XObject map correctly with the new image.
      page.drawImage(embeddedImg, {
        x: cropBox.x,
        y: cropBox.y,
        width: cropBox.width,
        height: cropBox.height
      });
    } catch (pageErr) {
      console.error(`Error rasterizing page ${pageNum}:`, pageErr);
      // Continue to next page if one fails, or we could re-throw
      throw pageErr; 
    }
  }
  
  return await pdfDoc.save();
}
