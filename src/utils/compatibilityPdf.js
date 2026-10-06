import { PDFDocument, PDFName } from 'pdf-lib';
import { AnnotationMode } from 'pdfjs-dist';
import { getCompatibilityRenderSize } from './compatibilityGeometry.js';

// Explicit appearance fallback for printer/RIP failures. Canvas rendering is
// RGB and loses source text/vectors/spot plates; normal export never uses this.
export async function createCompatibilityArtworkPdf(file, pdfjsDocument, dpi = 600) {
  const source = await PDFDocument.load(await file.arrayBuffer());
  const pages = source.getPages();
  let totalPixels = 0;
  for (const page of pages) {
    const unit = source.context.lookup(page.node.get(PDFName.of('UserUnit')))?.asNumber?.() || 1;
    const box = page.getCropBox();
    const size = getCompatibilityRenderSize({ width: box.width * unit, height: box.height * unit }, dpi);
    totalPixels += size.width * size.height;
  }
  if (totalPixels > 120_000_000) throw new Error('This document is too large to flatten in browser memory. Choose 300 DPI or use a desktop transparency flattener.');

  const output = await PDFDocument.create();
  for (const [index, page] of pages.entries()) {
    const renderedPage = await pdfjsDocument.getPage(index + 1);
    const viewport = renderedPage.getViewport({ scale: dpi / 72, rotation: 0 });
    const size = getCompatibilityRenderSize({ width: viewport.width * 72 / dpi, height: viewport.height * 72 / dpi }, dpi);
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
      const target = output.addPage([media.width, media.height]);
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
  return output.save({ useObjectStreams: true });
}
