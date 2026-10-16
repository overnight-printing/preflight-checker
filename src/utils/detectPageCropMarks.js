import { AnnotationMode } from 'pdfjs-dist';
import { detectCropMarks } from './cropMarkDetection.js';

export async function detectPageCropMarks(page, signal) {
  const size = page.getViewport({ scale: 1 });
  const scale = Math.min(2, 4096 / Math.max(size.width, size.height));
  if (page.userUnit !== 1) return { status: 'unsupported', message: 'Custom UserUnit scaling needs review in a production PDF editor before trim can be changed.' };
  if (scale < 1) return { status: 'none', message: 'Automatic detection is unavailable at this page size. Set and check the trim manually.' };
  if (signal.aborted) throw new DOMException('Detection canceled', 'AbortError');
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Unable to create a crop-mark preview.');
  const task = page.render({ canvasContext: context, viewport, annotationMode: AnnotationMode.DISABLE, background: '#ffffff' });
  const cancel = () => task.cancel();
  signal.addEventListener('abort', cancel, { once: true });
  try {
    await task.promise;
    if (signal.aborted) throw new DOMException('Detection canceled', 'AbortError');
    const result = detectCropMarks(context.getImageData(0, 0, canvas.width, canvas.height), canvas.width / scale, canvas.height / scale);
    // Ceil-sized canvases include fractional padding beyond the PDF's right/bottom edges.
    if (result.insets) {
      result.insets.right -= canvas.width / scale - size.width;
      result.insets.bottom -= canvas.height / scale - size.height;
    }
    return result;
  } finally {
    signal.removeEventListener('abort', cancel);
    canvas.width = 0; canvas.height = 0;
  }
}
