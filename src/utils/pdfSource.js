import { PDFDocument, EncryptedPDFError } from 'pdf-lib';

const sources = new WeakMap();

export function getPdfBytes(file) {
  if (!sources.has(file)) sources.set(file, { bytes: file.arrayBuffer() });
  return sources.get(file).bytes;
}

// Cached documents are read-only; every editing operation loads a fresh copy.
export async function getPdfDocument(file, fresh = false) {
  const bytes = await getPdfBytes(file);
  const load = () => PDFDocument.load(bytes).catch(error => {
    // pdf-lib's ES5 Error subclass does not reliably retain instanceof in Node.
    if (error instanceof EncryptedPDFError || /Input document to .* is encrypted/.test(error.message)) throw new Error('This PDF is encrypted or password protected. Save an unencrypted copy in your PDF editor, then upload it again.');
    throw error;
  });
  if (fresh) return load();
  const source = sources.get(file);
  source.document ||= load();
  return source.document;
}
