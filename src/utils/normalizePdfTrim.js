import { getPDFBoxInfo } from './pdfProcessor.js';
import { getPdfDocument } from './pdfSource.js';
import { detectPageCropMarks } from './detectPageCropMarks.js';
import { setPageTrim } from './reviewedTrim.js';

export async function normalizePdfTrim(file, pdf, signal) {
  const reviews = {};
  let editable;
  let changed = false;
  for (let number = 1; number <= pdf.numPages; number++) {
    signal.throwIfAborted();
    const boxes = await getPDFBoxInfo(file, number);
    if (!boxes || boxes.hasDistinctTrimBox) continue;
    let page;
    try {
      page = await pdf.getPage(number);
      const result = await detectPageCropMarks(page, signal);
      if (result.status === 'found') {
        editable ||= await getPdfDocument(file, true);
        signal.throwIfAborted();
        setPageTrim(editable, number, result.insets, result.segments);
        result.applied = true;
        changed = true;
      }
      reviews[number] = result;
    } catch (error) {
      signal.throwIfAborted();
      reviews[number] = { status: 'error', message: error.message };
    } finally {
      page?.cleanup();
    }
  }
  signal.throwIfAborted();
  const bytes = changed ? await editable.save({ useObjectStreams: true }) : null;
  signal.throwIfAborted();
  return { bytes, reviews };
}
