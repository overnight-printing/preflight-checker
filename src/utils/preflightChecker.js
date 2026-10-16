import { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFDict, PDFBool, PDFNumber, decodePDFRawStream } from 'pdf-lib';
import { OPS } from 'pdfjs-dist';
import { rotatedSize } from './pdfGeometry.js';
import { getPdfBytes, getPdfDocument } from './pdfSource.js';
import { scanContent, multiplyLinearMatrices } from './pdfContent.js';
import { normalizePrintRequirements, getPrintDocumentChecks, getOrderTrim } from './printRequirements.js';

/**
 * Runs print checks against the selected job requirements.
 * 
 * @param {File} file - The uploaded PDF file
 * @param {Object} pdfjsDoc - The PDF.js document proxy
 * @param {Object} printRequirements - Workflow, minimum DPI, and required bleed
 * @returns {Promise<Object>} Results of all checks
 */
export async function runPreflightChecks(file, pdfjsDoc, printRequirements = {}) {
  const requirements = normalizePrintRequirements(printRequirements);
  const arrayBuffer = await getPdfBytes(file);
  const pdfDoc = await getPdfDocument(file);
  const pages = pdfDoc.getPages();
  const numPages = pages.length;
  
  const firstPage = pages[0];
  const firstBox = firstPage ? (firstPage.getTrimBox() || firstPage.getCropBox() || firstPage.getMediaBox() || { x: 0, y: 0, width: 0, height: 0 }) : { x: 0, y: 0, width: 0, height: 0 };
  const firstSize = rotatedSize(firstBox, firstPage?.getRotation().angle);
  const firstPageW = firstSize.width;
  const firstPageH = firstSize.height;
  
  const lookup = (ref) => pdfDoc.context.lookup(ref);
  
  // Read PDF version from file header bytes (standard %PDF-1.x)
  const headerSlice = arrayBuffer.slice(0, 20);
  const headerText = new TextDecoder('utf-8').decode(headerSlice);
  const match = headerText.match(/%PDF-(\d+\.\d+)/);
  const pdfVersion = match ? match[1] : '1.4';
  
  // Results object
  const results = {
    numPages,
    pdfVersion,
    requirements,
    checks: {
      resolution: { status: 'pass', details: 'Placed images meet the job resolution target', value: null },
      bleed: { status: 'pass', details: `Bleed meets the job target (${(requirements.bleedPoints / 72).toFixed(3)}" each edge)`, value: null, fixable: true },
      overprint: { status: 'pass', details: 'No painted overprint detected', value: null, fixable: false },
      fontEmbedding: { status: 'pass', details: 'Referenced font programs are embedded', value: [], fixable: false },
      colorMode: { status: 'pass', details: 'Process colors (CMYK/Grayscale) only', value: null },
      pageSize: { status: 'pass', details: 'Page sizes are consistent', value: null },
      transparency: { status: 'pass', details: 'No unflattened transparency detected', value: null },
      gradients: { status: 'pass', details: 'No PDF gradient shadings detected', value: [] },
      imageMasks: { status: 'pass', details: 'No stencil or explicit image masks detected', value: null },
      spotColors: { status: 'pass', details: 'No spot colors detected', value: [], fixable: false },
      blankPages: { status: 'pass', details: 'No blank pages detected', value: [], fixable: true },
      hiddenLayers: { status: 'pass', details: 'No optional content layers detected', value: null },
      pdfVersionCheck: { status: 'pass', details: `PDF version is ${pdfVersion}`, value: null },
      ...getPrintDocumentChecks(pdfDoc, requirements)
    }
  };

  // Helper variables to track issues
  let minDPI = Infinity;
  let hasLowRes = false;
  let totalImages = 0;
  let hasInsufficientBleed = false;
  let hasOverprint = false;
  let unmeasuredImages = false;
  const nonEmbeddedFonts = new Set();
  let hasRGBContent = false;
  const rgbPages = new Set(), whiteOverprintPages = new Set(), orderBoxPages = [], orderMismatchPages = [];
  let incompleteContent = false;
  let hasPageSizeMismatch = false;
  let mismatchPageNum = -1;
  let mismatchSizeStr = '';
  let hasTransparency = false;
  const shadingTypes = [];
  let stencilImages = 0;
  let explicitImageMasks = 0;
  const spotColorsFound = new Set();
  const blankPagesList = [];

  // 1. PDF Version check (Warning only)
  const versionNum = parseFloat(results.pdfVersion);
  if (isNaN(versionNum) || (requirements.workflow === 'pdfx4' && versionNum < 1.6)) {
    results.checks.pdfVersionCheck = {
      status: requirements.workflow === 'pdfx4' ? 'error' : 'warning',
      details: `PDF Version is ${results.pdfVersion}. PDF/X-4 requires PDF 1.6 or later. Re-export for the selected workflow.`,
      value: results.pdfVersion
    };
  }

  // Optional layers are valid in modern workflows and retained by export.
  const catalog = pdfDoc.catalog;
  if (catalog.has(PDFName.of('OCProperties'))) {
    results.checks.hiddenLayers = {
      status: 'warning',
      details: 'Optional content layers detected. Export preserves the saved layer configuration. Confirm print visibility with the printer; screen and print visibility may differ.',
      value: true,
      fixable: false
    };
  }

  // Collect mask and shading diagnostics, including nested resources.
  for (const dict of collectPdfDictionaries(pdfDoc)) {

    if (lookup(dict.get(PDFName.of('Subtype'))) === PDFName.of('Image')) {
      if (lookup(dict.get(PDFName.of('ImageMask'))) === PDFBool.True) stencilImages++;
      if (dict.has(PDFName.of('Mask'))) explicitImageMasks++;
    }
    const shadingType = lookup(dict.get(PDFName.of('ShadingType')));
    if (shadingType instanceof PDFNumber) {
      shadingTypes.push(shadingType.asNumber());
    }
  }

  // Scan resource dictionaries of all pages specifically for Fonts, ColorSpace and Images
  for (let idx = 0; idx < numPages; idx++) {
    const page = pages[idx];
    const resourceSets = [];
    const visited = new Set();
    const collectResources = (resources) => {
      if (!(resources instanceof PDFDict) || visited.has(resources)) return;
      visited.add(resources);
      resourceSets.push(resources);
      const xObjects = lookup(resources.get(PDFName.of('XObject')));
      if (xObjects instanceof PDFDict) for (const key of xObjects.keys()) {
        const form = lookup(xObjects.get(key));
        if (form instanceof PDFRawStream) collectResources(lookup(form.dict.get(PDFName.of('Resources'))));
      }
    };
    collectResources(page.node.Resources());
    for (const resources of resourceSets) {
      // Check Fonts referenced by this page
      const fonts = lookup(resources.get(PDFName.of('Font')));
      if (fonts instanceof PDFDict) {
        for (const key of fonts.keys()) {
          const fontObj = lookup(fonts.get(key));
          if (fontObj instanceof PDFDict) {
            const subtype = fontObj.get(PDFName.of('Subtype'));
            const fontName = fontObj.get(PDFName.of('BaseFont'))?.toString() || 'Unnamed Font';
            
            if (subtype !== PDFName.of('Type3')) {
              const descendants = lookup(fontObj.get(PDFName.of('DescendantFonts')));
              const fontPrograms = descendants instanceof PDFArray
                ? descendants.asArray().map(lookup) : [fontObj];
              const isEmbedded = fontPrograms.length > 0 && fontPrograms.every((font) => {
                const descriptor = font instanceof PDFDict && lookup(font.get(PDFName.of('FontDescriptor')));
                return descriptor instanceof PDFDict && ['FontFile', 'FontFile2', 'FontFile3'].some(key => {
                  const program = lookup(descriptor.get(PDFName.of(key)));
                  return program instanceof PDFRawStream && program.contents.length > 0;
                });
              });

              if (!isEmbedded) {
                nonEmbeddedFonts.add(fontName.replace('/', ''));
              }
            }
          }
        }
      }

      const shadings = lookup(resources.get(PDFName.of('Shading')));
      if (shadings instanceof PDFDict) for (const key of shadings.keys()) {
        const shading = lookup(shadings.get(key));
        if (shading instanceof PDFDict && isRgbColorSpace(lookup(shading.get(PDFName.of('ColorSpace'))), lookup)) { hasRGBContent = true; rgbPages.add(idx + 1); }
      }
      // Scan ColorSpace for Spot Colors and RGB
      const colorSpaces = lookup(resources.get(PDFName.of('ColorSpace')));
      if (colorSpaces instanceof PDFDict) {
        for (const key of colorSpaces.keys()) {
          const csVal = lookup(colorSpaces.get(key));
          if (isRgbColorSpace(csVal, lookup)) { hasRGBContent = true; rgbPages.add(idx + 1); }
          if (csVal instanceof PDFArray) {
            const csName = csVal.get(0).toString();
            if (csName === '/Separation' || csName === '/DeviceN') {
              const names = lookup(csVal.get(1));
              for (const name of names instanceof PDFArray ? names.asArray() : [names]) {
                const spotName = name?.toString().replace(/^\//, '');
                if (spotName && !['All', 'None', 'Cyan', 'Magenta', 'Yellow', 'Black'].includes(spotName)) spotColorsFound.add(spotName);
              }
            }
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
    const orderTrim = getOrderTrim(page, requirements);
    const trimBox = orderTrim?.trim || page.getTrimBox();
    if (orderTrim) orderBoxPages.push(pageNum);
    if (requirements.orderSize) {
      const size = rotatedSize(trimBox, page.getRotation().angle);
      if (Math.abs(size.width - requirements.orderSize.width) > 0.5 || Math.abs(size.height - requirements.orderSize.height) > 0.5) orderMismatchPages.push(pageNum);
    }
    const bleedBox = orderTrim?.bleed || page.getBleedBox() || cropBox;
    
    // Compare CropBox/TrimBox width & height with the first page
    const compareBox = rotatedSize(trimBox || cropBox, page.getRotation().angle);
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
    if (requirements.bleedPoints === 0) {
      // Bleed is a job requirement; some products do not require it.
    } else if (!trimBox) {
      hasInsufficientBleed = true; // Missing TrimBox = no bleed defined
    } else {
      const margins = [trimBox.x - bleedBox.x, trimBox.y - bleedBox.y,
        bleedBox.x + bleedBox.width - trimBox.x - trimBox.width,
        bleedBox.y + bleedBox.height - trimBox.y - trimBox.height];
      if (margins.some(value => value < requirements.bleedPoints - 0.1)) {
        hasInsufficientBleed = true;
      }
    }

    const scanImages = (resourceDict, streamText, initialState = {}, ancestors = new Set()) => {
      if (!(resourceDict instanceof PDFDict)) return;
      const scan = scanContent(streamText, resourceDict, lookup, initialState);
      if (scan.rgb) { hasRGBContent = true; rgbPages.add(pageNum); }
      if (scan.whiteOverprint) whiteOverprintPages.add(pageNum);
      hasOverprint ||= scan.overprint;
      hasTransparency ||= scan.transparency;
      const xObjects = lookup(resourceDict.get(PDFName.of('XObject')));
      if (!(xObjects instanceof PDFDict)) return;
      for (const draw of scan.draws) {
        const object = lookup(xObjects.get(PDFName.of(draw.name)));
        if (!(object instanceof PDFRawStream)) { incompleteContent = true; continue; }
        if (ancestors.has(object)) { incompleteContent = true; continue; }
        if (object.dict.get(PDFName.of('Subtype')) === PDFName.of('Form')) {
          const formResources = lookup(object.dict.get(PDFName.of('Resources'))) || resourceDict;
          const formMatrix = lookup(object.dict.get(PDFName.of('Matrix')));
          const transform = formMatrix instanceof PDFArray ? formMatrix.asArray().map(value => lookup(value).asNumber()) : [1, 0, 0, 1];
          let formText;
          try { formText = new TextDecoder('latin1').decode(decodePDFRawStream(object).decode()); }
          catch { incompleteContent = true; unmeasuredImages = true; continue; }
          scanImages(formResources, formText, { ...draw.state, matrix: multiplyLinearMatrices(draw.state.matrix, transform) }, new Set(ancestors).add(object));
        } else if (object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
          totalImages++;
          const width = lookup(object.dict.get(PDFName.of('Width')))?.asNumber() || 0;
          const height = lookup(object.dict.get(PDFName.of('Height')))?.asNumber() || 0;
          const [a, b, c, d] = draw.state.matrix;
          const unit = lookup(page.node.get(PDFName.of('UserUnit')))?.asNumber() || 1;
          const dpi = Math.min(width / Math.hypot(a, b), height / Math.hypot(c, d)) * 72 / unit;
          if (Number.isFinite(dpi) && dpi > 0) { minDPI = Math.min(minDPI, dpi); if (dpi < requirements.minDpi) hasLowRes = true; }
          else unmeasuredImages = true;
          let cs = lookup(object.dict.get(PDFName.of('ColorSpace')));
          const spaces = lookup(resourceDict.get(PDFName.of('ColorSpace')));
          if (cs instanceof PDFName && spaces instanceof PDFDict) cs = lookup(spaces.get(cs)) || cs;
          if (isRgbColorSpace(cs, lookup)) { hasRGBContent = true; rgbPages.add(pageNum); }
          if (object.dict.has(PDFName.of('SMask')) && lookup(object.dict.get(PDFName.of('SMask'))) !== PDFName.of('None')) hasTransparency = true;
        }
      }
    };
    try { scanImages(page.node.Resources(), await getPageContentStreamText(page, pdfDoc)); }
    catch { incompleteContent = true; unmeasuredImages = true; }

    // Drawing operators include outlined text, paths, shadings, and inline images.
    // Missing text and XObjects alone is not evidence that a page is blank.
    const pdfjsPage = await pdfjsDoc.getPage(pageNum);
    const operatorList = await pdfjsPage.getOperatorList();
    if (operatorList.fnArray.some(op => [OPS.paintInlineImageXObject, OPS.paintInlineImageXObjectGroup].includes(op))) {
      unmeasuredImages = true;
      incompleteContent = true;
    }
    const paintOperators = new Set([
      OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke,
      OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke, OPS.shadingFill, OPS.rawFillPath,
      OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject,
      OPS.paintImageMaskXObjectGroup, OPS.paintImageMaskXObjectRepeat, OPS.paintImageXObjectRepeat,
      OPS.paintInlineImageXObjectGroup, OPS.paintSolidColorImageMask,
      OPS.showText, OPS.showSpacedText, OPS.nextLineShowText, OPS.nextLineSetSpacingShowText
    ]);
    const annotations = lookup(page.node.get(PDFName.of('Annots')));
    if (!(annotations instanceof PDFArray && annotations.size()) && !operatorList.fnArray.some((op, index) => paintOperators.has(op) ||
      (op === OPS.constructPath && paintOperators.has(operatorList.argsArray[index]?.[0])))) blankPagesList.push(pageNum);
  }

  // Update Bleed Check Status
  if (hasInsufficientBleed) {
    results.checks.bleed = {
      status: 'error',
      details: `Bleed is below the job target (${(requirements.bleedPoints / 72).toFixed(3)}" each edge) or the finished TrimBox is missing. Confirm edge artwork extends beyond the cut line.`,
      value: false,
      fixable: true
    };
  }

  if (orderBoxPages.length) results.checks.orderBoxes = { status: 'warning', details: `Page bounds match the explicitly selected order size plus bleed on pages ${orderBoxPages.join(', ')}. Set finished boxes after confirming the centered cut line and edge artwork.`, value: orderBoxPages, fixable: true };

  // Update Image Resolution Status
  if (minDPI < 150) {
    results.checks.resolution = { status: 'error', details: `Images below 150 DPI detected. Minimum: ${Math.round(minDPI)} DPI; job target: ${requirements.minDpi} DPI.${unmeasuredImages ? ' Other images could not be measured.' : ''}`, value: Math.round(minDPI) };
  } else if (unmeasuredImages) {
    results.checks.resolution = { status: 'warning', details: 'Some inline images or unsupported image resources could not be measured. Verify their effective resolution in a production PDF editor.', value: Number.isFinite(minDPI) ? Math.round(minDPI) : null };
  } else if (totalImages === 0) {
    results.checks.resolution = {
      status: 'pass',
      details: 'No images detected in document (vector only).',
      value: null
    };
  } else if (hasLowRes) {
    results.checks.resolution = {
      status: 'warning',
      details: `Low resolution images detected. Minimum found: ${Math.round(minDPI)} DPI; job target: ${requirements.minDpi} DPI. Re-export from higher-resolution source artwork.`,
      value: Math.round(minDPI)
    };
  } else {
    results.checks.resolution = {
      status: 'pass',
      details: `All measured images meet the ${requirements.minDpi} DPI job target. Minimum: ${Math.round(minDPI)} DPI.`,
      value: Math.round(minDPI)
    };
  }

  // Update Overprint Status
  if (hasOverprint) {
    results.checks.overprint = {
      status: whiteOverprintPages.size ? 'error' : 'info',
      details: whiteOverprintPages.size ? `White objects painted with overprint on pages ${[...whiteOverprintPages].join(', ')} may disappear on press. Correct those objects in the source application; intentional black overprint is retained.` : 'Painted overprint detected. Black/text overprint can be intentional. Review separations with the printer.',
      value: true,
      fixable: false, pages: [...whiteOverprintPages]
    };
  }

  // Update Font Embedding Status
  if (nonEmbeddedFonts.size > 0) {
    results.checks.fontEmbedding = {
      status: 'error',
      details: `Missing font programs: ${Array.from(nonEmbeddedFonts).join(', ')}. Embed fonts or outline text in the source application. Rasterizing with substituted fonts does not repair missing fonts.`,
      value: Array.from(nonEmbeddedFonts),
      fixable: false
    };
  }

  // Update Color Mode Status
  if (hasRGBContent) {
    results.checks.colorMode = {
      status: requirements.workflow === 'legacy' ? 'error' : 'warning',
      details: requirements.workflow === 'legacy'
        ? `RGB artwork detected on pages ${[...rgbPages].join(', ') || 'with RGB shadings'}. PDF/X-1a requires CMYK/spot colors; convert using the printer’s ICC profile in the source application.`
        : `RGB artwork detected on pages ${[...rgbPages].join(', ') || 'with RGB shadings'}. Color-managed RGB can be valid in PDF/X-4. Confirm source profiles and the press output intent; this tool preserves colors and does not convert to CMYK.`,
      pages: [...rgbPages],
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
      details: `Page size mismatch. Page 1: ${sizeStr}, Page ${mismatchPageNum}: ${mismatchSizeStr}.`,
      value: { firstPageSize: sizeStr, mismatchPageNum, mismatchSize: mismatchSizeStr }
    };
  } else {
    results.checks.pageSize = {
      status: 'pass',
      details: `All pages have the same size: ${sizeStr}.`,
      value: sizeStr
    };
  }

  if (requirements.orderSize) {
    results.checks.pageSize = { status: orderMismatchPages.length ? 'error' : 'pass', details: orderMismatchPages.length ? `Finished size differs from the order on pages ${orderMismatchPages.join(', ')}.` : 'All finished page sizes match the order (0.5 pt tolerance).', value: orderMismatchPages };
  }
  if (incompleteContent) results.checks.contentScan = { status: 'warning', details: 'Some content streams or recursive resources could not be inspected. Color, overprint and resolution results may be incomplete; review in a production PDF editor.', value: true };

  // Update Transparency Status
  if (hasTransparency) {
    results.checks.transparency = {
      status: requirements.workflow === 'legacy' ? 'error' : 'info',
      details: requirements.workflow === 'legacy' ? 'Live transparency detected. PDF/X-1a requires flattening in a color-managed prepress application.'
        : 'Live transparency detected and retained. PDF/X-4 supports transparency; confirm a compatible RIP. If objects disappear in print, test Flatten visible artwork or use a desktop transparency flattener.',
      value: true
    };
  }

  if (shadingTypes.length) {
    results.checks.gradients = {
      status: requirements.workflow === 'legacy' ? 'warning' : 'info',
      value: shadingTypes,
      details: `${shadingTypes.length} PDF gradient shading(s) detected. These are valid print artwork, but some drivers/RIPs render them incorrectly. If gradients disappear, test Flatten visible artwork; use a color-managed desktop flattener when vectors or press colors must be retained.`
    };
  }
  if (stencilImages || explicitImageMasks) {
    results.checks.imageMasks = {
      status: 'info', value: { stencils: stencilImages, explicitMasks: explicitImageMasks },
      details: `${stencilImages} stencil image(s), ${explicitImageMasks} explicit image mask(s). These can be opaque artwork, including white logos, and are not necessarily live transparency. If artwork disappears in print, test Flatten visible artwork to bake masks into the page image.`
    };
  }

  // Update Spot Colors Status
  if (spotColorsFound.size > 0) {
    results.checks.spotColors = {
      status: 'info',
      details: `Spot inks: ${Array.from(spotColorsFound).join(', ')}. Confirm these plates are intended; convert unwanted spots using the printer's color-managed workflow.`,
      value: Array.from(spotColorsFound),
      fixable: false
    };
  }

  // Update Blank Pages Status
  if (blankPagesList.length > 0) {
    results.checks.blankPages = {
      status: 'warning',
      details: `Blank pages detected: Page(s) ${blankPagesList.join(', ')}. They may be intentional for binding or imposition. Confirm the job ticket before removing them.`,
      value: blankPagesList,
      fixable: blankPagesList.length < numPages
    };
  }

  return results;
}

/**
 * Decodes page content streams without changing binary byte values.
 */
async function getPageContentStreamText(page, pdfDoc) {
  const contents = pdfDoc.context.lookup(page.node.get(PDFName.of('Contents')));
  if (!contents) return '';
  
  const lookup = (ref) => pdfDoc.context.lookup(ref);
  let contentText = '';
  
  const processStream = (stream) => {
    if (stream instanceof PDFRawStream) {
      try {
        const decoded = decodePDFRawStream(stream).decode();
        contentText += new TextDecoder('latin1').decode(decoded) + ' ';
      } catch (e) {
        throw new Error('Unable to decode PDF content.', { cause: e });
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

function collectPdfDictionaries(document) {
  const dictionaries = [];
  const visited = new Set();
  const visit = value => {
    const object = document.context.lookup(value);
    if (!object || visited.has(object)) return;
    visited.add(object);
    const dictionary = object instanceof PDFRawStream ? object.dict : object;
    if (dictionary instanceof PDFDict) {
      dictionaries.push(dictionary);
      dictionary.keys().forEach(key => visit(dictionary.get(key)));
    } else if (object instanceof PDFArray) object.asArray().forEach(visit);
  };
  visit(document.catalog);
  return dictionaries;
}

function isRgbColorSpace(space, lookup) {
  if (space?.toString() === '/DeviceRGB' || space?.toString() === '/CalRGB') return true;
  if (!(space instanceof PDFArray)) return false;
  const type = space.get(0)?.toString();
  if (type === '/ICCBased') {
    const profile = lookup(space.get(1));
    return profile instanceof PDFRawStream && profile.dict.get(PDFName.of('N'))?.asNumber() === 3;
  }
  if (type === '/Indexed') return isRgbColorSpace(lookup(space.get(1)), lookup);
  return type === '/DeviceRGB' || type === '/CalRGB';
}

/**
 * Removes confirmed 1-based page numbers, retaining at least one page.
 * 
 * @param {ArrayBuffer} arrayBuffer - The PDF file as arrayBuffer
 * @param {number|number[]} pageNums - 1-based page numbers to remove
 * @returns {Promise<Uint8Array>} Corrected PDF bytes
 */
export async function fixBlankPage(arrayBuffer, pageNums) {
  const pdfDoc = await PDFDocument.load(arrayBuffer);
  const pageCount = pdfDoc.getPageCount();
  const numbers = [...new Set(Array.isArray(pageNums) ? pageNums : [pageNums])];
  if (numbers.some(number => !Number.isInteger(number) || number < 1 || number > pageCount)) throw new Error('Invalid page number.');
  if (numbers.length >= pageCount) throw new Error('The final page cannot be removed.');
  numbers.sort((a, b) => b - a).forEach(number => pdfDoc.removePage(number - 1));
  return pdfDoc.save();
}

export async function fixOrderBoxes(file, requirements) {
  const pdfDoc = await getPdfDocument(file, true);
  for (const page of pdfDoc.getPages()) {
    const boxes = getOrderTrim(page, requirements);
    if (!boxes) continue;
    for (const [name, box] of [['Crop', boxes.bleed], ['Bleed', boxes.bleed], ['Trim', boxes.trim]]) page[`set${name}Box`](box.x, box.y, box.width, box.height);
  }
  return pdfDoc.save();
}
