export const MAX_PDF_BYTES = 250 * 1024 * 1024;

export function validateArtworkFile(file) {
  if (!file || !/\.(pdf|png|jpe?g)$/i.test(file.name)) return 'Choose a PDF, PNG, JPG, or JPEG artwork file.';
  if (/\.pdf$/i.test(file.name) && file.size > MAX_PDF_BYTES) return 'This PDF exceeds the 250 MB browser limit. Use a desktop PDF editor or choose a smaller PDF.';
  if (file.size === 0) return 'This file is empty. Choose a file containing artwork.';
  return '';
}
