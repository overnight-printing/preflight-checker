import { PDFDocument, PDFName } from 'pdf-lib';
import { AnnotationMode } from 'pdfjs-dist';
import { getCompatibilityRenderSize, summarizeCompatibilityFit } from './compatibilityGeometry.js';
import { getPdfDocument } from './pdfSource.js';
import { removeOrphanedObjects } from './pdfGarbageCollect.js';

// Cheap, pre-render feasibility check: tells the caller which DPI (600, 300, or
// neither) actually fits before any canvas work starts, instead of letting the
// operator discover the limit via a failed export. Never picks a DPI for the
// caller — it only reports what fits, so a user-selected target is never
// silently lowered.
export async function getCompatibilityDpiFit(file, pdfjsDocument, pageNums = null) {
  const source = await getPdfDocument(file);
  const pages = source.getPages();
  const selected = new Set(pageNums ?? pages.map((_, index) => index + 1));
  if (!selected.size || [...selected].some(number => !Number.isInteger(number) || number < 1 || number > pages.length)) throw new Error('Choose valid pages to flatten.');
  const pageNumbers = [];
  const boxes = [];
  for (const index of pages.keys()) {
    if (!selected.has(index + 1)) continue;
    const renderedPage = await pdfjsDocument.getPage(index + 1);
    // Scale 1 viewport already reflects UserUnit and CropBox∩MediaBox, in points.
    const viewport = renderedPage.getViewport({ scale: 1, rotation: 0 });
    pageNumbers.push(index + 1);
    boxes.push({ width: viewport.width, height: viewport.height });
  }
  const attempts = {};
  let feasibleDpi = null;
  for (const dpi of [600, 300]) {
    const summary = summarizeCompatibilityFit(boxes, dpi);
    attempts[dpi] = { ...summary, perPage: summary.perPage.map((page, i) => ({ ...page, page: pageNumbers[i] })) };
    if (feasibleDpi === null && summary.fits) feasibleDpi = dpi;
  }
  const pagesFittingAt300 = attempts[300].perPage.filter(page => page.fits).map(page => page.page);
  return { feasibleDpi, attempts, pagesFittingAt300 };
}

// Explicit appearance fallback for printer/RIP failures. Canvas rendering is
// RGB and loses source text/vectors/spot plates; normal export never uses this.
export async function createCompatibilityArtworkPdf(file, pdfjsDocument, dpi = 600, pageNums = null) {
  const source = await getPdfDocument(file);
  const pages = source.getPages();
  const selected = new Set(pageNums ?? pages.map((_, index) => index + 1));
  if (!selected.size || [...selected].some(number => !Number.isInteger(number) || number < 1 || number > pages.length)) throw new Error('Choose valid pages to flatten.');
  const partial = selected.size < pages.length;
  let totalPixels = 0;
  const renderPages = new Map();
  for (const index of pages.keys()) {
    if (!selected.has(index + 1)) continue;
    const renderedPage = await pdfjsDocument.getPage(index + 1);
    // PDF.js already applies UserUnit and intersects CropBox with MediaBox.
    const viewport = renderedPage.getViewport({ scale: dpi / 72, rotation: 0 });
    const size = getCompatibilityRenderSize({ width: viewport.width * 72 / dpi, height: viewport.height * 72 / dpi }, dpi);
    renderPages.set(index, { renderedPage, viewport, size });
    totalPixels += size.width * size.height;
  }
  if (totalPixels > 120_000_000) throw new Error('This document is too large to flatten in browser memory. Choose 300 DPI or use a desktop transparency flattener.');

  const output = partial ? await getPdfDocument(file, true) : await PDFDocument.create();
  if (partial) {
    // Keep untouched pages/resources/layers together; RGB repair invalidates any
    // source PDF/X declaration and output-profile promise for the whole file.
    output.catalog.delete(PDFName.of('OutputIntents'));
    output.catalog.delete(PDFName.of('Metadata'));
    const info = output.context.lookup(output.context.trailerInfo.Info);
    for (const key of ['GTS_PDFXVersion', 'GTS_PDFXConformance']) info?.delete(PDFName.of(key));
  }
  for (const [index, page] of pages.entries()) {
    if (!selected.has(index + 1)) continue;
    const { renderedPage, viewport, size } = renderPages.get(index);
    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    try {
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) throw new Error('The browser could not allocate the compatibility canvas.');
      context.fillStyle = '#ffffff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      // Bake the saved visible artwork used by the preview. Annotations/forms
      // remain excluded; overprint separations are not simulated by PDF.js.
      await renderedPage.render({ canvasContext: context, viewport, intent: 'display', annotationMode: AnnotationMode.DISABLE }).promise;
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!png) throw new Error('The browser could not encode the flattened artwork.');
      const image = await output.embedPng(await png.arrayBuffer());
      const media = page.getMediaBox(), crop = page.getCropBox(), bleed = page.getBleedBox(), trim = page.getTrimBox();
      const target = partial ? output.getPage(index) : output.addPage([media.width, media.height]);
      if (partial) {
        target.node.set(PDFName.of('Contents'), output.context.obj([]));
        target.node.set(PDFName.of('Resources'), output.context.obj({}));
        target.node.delete(PDFName.of('Group'));
        target.node.delete(PDFName.of('Annots'));
      }
      target.setMediaBox(media.x, media.y, media.width, media.height);
      target.setCropBox(crop.x, crop.y, crop.width, crop.height);
      target.setBleedBox(bleed.x, bleed.y, bleed.width, bleed.height);
      target.setTrimBox(trim.x, trim.y, trim.width, trim.height);
      if (page.node.has(PDFName.of('ArtBox'))) {
        const art = page.getArtBox();
        target.setArtBox(art.x, art.y, art.width, art.height);
      }
      target.setRotation(page.getRotation());
      const unit = page.node.get(PDFName.of('UserUnit'));
      if (unit) target.node.set(PDFName.of('UserUnit'), source.context.lookup(unit).clone(output.context));
      // PDF.js intersects the CropBox with the MediaBox. Use its actual view
      // coordinates to avoid stretching malformed/out-of-media crop boxes.
      const [x, y, right, top] = renderedPage.view;
      target.drawImage(image, { x, y, width: right - x, height: top - y });
    } finally {
      canvas.width = 0; canvas.height = 0;
    }
  }
  output.setTitle(`${file.name} — compatibility artwork (${dpi} DPI RGB)`);
  output.setProducer('Overnight Preflight Tool: explicit appearance rasterization');
  await removeOrphanedObjects(output);
  return output.save({ useObjectStreams: true });
}
