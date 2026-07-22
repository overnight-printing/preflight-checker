import { PDFDocument, PDFName, StandardFonts, rgb } from 'pdf-lib';

const LETTER_PORTRAIT = [612, 792];
const LETTER_LANDSCAPE = [792, 612];
const PAGE_MARGIN = 36;

export function normalizeProofId(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function proofIdForFilename(value) {
  return normalizeProofId(value)
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || 'proof';
}

function fitText(text, font, size, maxWidth) {
  const normalized = String(text ?? '');
  if (font.widthOfTextAtSize(normalized, size) <= maxWidth) return normalized;

  let result = normalized;
  while (result.length > 1 && font.widthOfTextAtSize(`${result}...`, size) > maxWidth) {
    result = result.slice(0, -1);
  }
  return `${result}...`;
}

function formatDimensions(box) {
  return `${(box.width / 72).toFixed(3)} in x ${(box.height / 72).toFixed(3)} in`;
}

function getProofArtworkBox(sourcePage, trimBox) {
  const bleedBox = sourcePage.getBleedBox() || sourcePage.getCropBox() || trimBox;
  const containsTrim = (
    bleedBox.x <= trimBox.x
    && bleedBox.y <= trimBox.y
    && bleedBox.x + bleedBox.width >= trimBox.x + trimBox.width
    && bleedBox.y + bleedBox.height >= trimBox.y + trimBox.height
  );
  return containsTrim ? bleedBox : trimBox;
}

function formatBleed(trimBox, artworkBox) {
  const bleed = Math.max(
    trimBox.x - artworkBox.x,
    trimBox.y - artworkBox.y,
    (artworkBox.x + artworkBox.width) - (trimBox.x + trimBox.width),
    (artworkBox.y + artworkBox.height) - (trimBox.y + trimBox.height)
  );
  return bleed > 0.01 ? `${(bleed / 72).toFixed(3)} in` : 'none shown';
}

function formatProofDate(generatedAt) {
  return new Intl.DateTimeFormat('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric'
  }).format(generatedAt);
}

/**
 * Places the production artwork and its bleed on a customer-facing review sheet,
 * with the finished TrimBox drawn as a visible cut line.
 */
export async function createCustomerProofPdf({
  sourcePdfBytes,
  proofId,
  sourceName,
  logoPngBytes,
  generatedAt = new Date()
}) {
  const normalizedProofId = normalizeProofId(proofId);
  if (!normalizedProofId) {
    throw new Error('Enter an estimate or invoice number before creating a customer proof.');
  }

  const sourceDocument = await PDFDocument.load(sourcePdfBytes);
  const sourcePages = sourceDocument.getPages();
  if (sourcePages.length === 0) throw new Error('The artwork PDF does not contain any pages.');

  const proofDocument = await PDFDocument.create();
  const regularFont = await proofDocument.embedFont(StandardFonts.Helvetica);
  const boldFont = await proofDocument.embedFont(StandardFonts.HelveticaBold);
  const logo = logoPngBytes ? await proofDocument.embedPng(logoPngBytes) : null;
  const proofDate = formatProofDate(generatedAt);

  proofDocument.setTitle(`Customer Proof ${normalizedProofId}`);
  proofDocument.setSubject('Customer review copy of production-prepared artwork');
  proofDocument.setCreator('Overnight Preflight Tool');
  proofDocument.setProducer('Overnight Preflight Tool');

  for (let index = 0; index < sourcePages.length; index += 1) {
    const sourcePage = sourcePages[index];
    const trimBox = sourcePage.getTrimBox() || sourcePage.getCropBox() || sourcePage.getMediaBox();
    const artworkBox = getProofArtworkBox(sourcePage, trimBox);
    if (!sourcePage.node.get(PDFName.of('Contents'))) {
      // pdf-lib cannot embed a structurally blank page. Add an invisible mark
      // to the in-memory copy so blank customer pages still get a proof sheet.
      sourcePage.drawRectangle({
        x: artworkBox.x,
        y: artworkBox.y,
        width: 0.01,
        height: 0.01,
        opacity: 0
      });
    }
    const sheetSize = artworkBox.width > artworkBox.height ? LETTER_LANDSCAPE : LETTER_PORTRAIT;
    const [sheetWidth, sheetHeight] = sheetSize;
    const sheet = proofDocument.addPage(sheetSize);
    const embeddedArtwork = await proofDocument.embedPage(sourcePage, {
      left: artworkBox.x,
      bottom: artworkBox.y,
      right: artworkBox.x + artworkBox.width,
      top: artworkBox.y + artworkBox.height
    });

    if (logo) {
      const logoHeight = 46;
      const logoWidth = logo.width * (logoHeight / logo.height);
      sheet.drawImage(logo, {
        x: PAGE_MARGIN,
        y: sheetHeight - 58,
        width: logoWidth,
        height: logoHeight
      });
    }
    sheet.drawText('CUSTOMER PROOF - REVIEW COPY', {
      x: logo ? PAGE_MARGIN + 42 : PAGE_MARGIN,
      y: sheetHeight - 42,
      size: 15,
      font: boldFont,
      color: rgb(0.12, 0.2, 0.48)
    });
    sheet.drawText(`Proof ID: ${fitText(normalizedProofId, boldFont, 10, 210)}`, {
      x: sheetWidth - PAGE_MARGIN - 210,
      y: sheetHeight - 40,
      size: 10,
      font: boldFont,
      color: rgb(0.12, 0.15, 0.2)
    });
    sheet.drawLine({
      start: { x: PAGE_MARGIN, y: sheetHeight - 64 },
      end: { x: sheetWidth - PAGE_MARGIN, y: sheetHeight - 64 },
      thickness: 1,
      color: rgb(0.82, 0.84, 0.87)
    });

    sheet.drawText(fitText(sourceName, regularFont, 9, sheetWidth - 250), {
      x: PAGE_MARGIN,
      y: sheetHeight - 81,
      size: 9,
      font: regularFont,
      color: rgb(0.25, 0.28, 0.34)
    });
    sheet.drawText(`Proof date: ${proofDate}`, {
      x: sheetWidth - PAGE_MARGIN - 150,
      y: sheetHeight - 81,
      size: 9,
      font: regularFont,
      color: rgb(0.25, 0.28, 0.34)
    });
    sheet.drawText(`Page ${index + 1} of ${sourcePages.length}  |  Finished size: ${formatDimensions(trimBox)}  |  Bleed: ${formatBleed(trimBox, artworkBox)}`, {
      x: PAGE_MARGIN,
      y: sheetHeight - 97,
      size: 9,
      font: boldFont,
      color: rgb(0.12, 0.15, 0.2)
    });

    sheet.drawLine({
      start: { x: PAGE_MARGIN, y: sheetHeight - 110 },
      end: { x: PAGE_MARGIN + 20, y: sheetHeight - 110 },
      thickness: 1.5,
      color: rgb(0.86, 0.08, 0.48)
    });
    sheet.drawText('Cut line', {
      x: PAGE_MARGIN + 25,
      y: sheetHeight - 113,
      size: 8,
      font: boldFont,
      color: rgb(0.25, 0.28, 0.34)
    });
    sheet.drawText('Artwork outside the cut line is bleed.', {
      x: PAGE_MARGIN + 78,
      y: sheetHeight - 113,
      size: 8,
      font: regularFont,
      color: rgb(0.38, 0.4, 0.45)
    });

    const previewTop = sheetHeight - 122;
    const previewBottom = 101;
    const previewWidth = sheetWidth - (PAGE_MARGIN * 2);
    const previewHeight = previewTop - previewBottom;
    const scale = Math.min(previewWidth / artworkBox.width, previewHeight / artworkBox.height);
    const artworkWidth = artworkBox.width * scale;
    const artworkHeight = artworkBox.height * scale;
    const artworkX = (sheetWidth - artworkWidth) / 2;
    const artworkY = previewBottom + ((previewHeight - artworkHeight) / 2);

    sheet.drawRectangle({
      x: artworkX - 1,
      y: artworkY - 1,
      width: artworkWidth + 2,
      height: artworkHeight + 2,
      borderWidth: 1,
      borderColor: rgb(0.35, 0.38, 0.43),
      color: rgb(1, 1, 1)
    });
    sheet.drawPage(embeddedArtwork, {
      x: artworkX,
      y: artworkY,
      width: artworkWidth,
      height: artworkHeight
    });
    sheet.drawRectangle({
      x: artworkX + ((trimBox.x - artworkBox.x) * scale),
      y: artworkY + ((trimBox.y - artworkBox.y) * scale),
      width: trimBox.width * scale,
      height: trimBox.height * scale,
      borderWidth: 1.5,
      borderColor: rgb(0.86, 0.08, 0.48),
      borderDashArray: [5, 3]
    });

    sheet.drawLine({
      start: { x: PAGE_MARGIN, y: 88 },
      end: { x: sheetWidth - PAGE_MARGIN, y: 88 },
      thickness: 1,
      color: rgb(0.82, 0.84, 0.87)
    });
    sheet.drawText('Please review spelling, content, placement, page order, and finished size.', {
      x: PAGE_MARGIN,
      y: 69,
      size: 9,
      font: boldFont,
      color: rgb(0.12, 0.15, 0.2)
    });
    sheet.drawText('Screen colors may differ from print. Production-prepared artwork is shown inside this review sheet.', {
      x: PAGE_MARGIN,
      y: 51,
      size: 8,
      font: regularFont,
      color: rgb(0.38, 0.4, 0.45)
    });
    sheet.drawText('Use the separate production export for press output.', {
      x: sheetWidth - PAGE_MARGIN - 205,
      y: 21,
      size: 8,
      font: boldFont,
      color: rgb(0.38, 0.4, 0.45)
    });
    sheet.drawText(`Proof ID: ${fitText(normalizedProofId, boldFont, 8, 220)}`, {
      x: PAGE_MARGIN,
      y: 21,
      size: 8,
      font: boldFont,
      color: rgb(0.38, 0.4, 0.45)
    });
  }

  // Object streams reduce structural overhead without decoding, rasterizing, or
  // transcoding the embedded artwork. Its original color spaces and resources
  // therefore remain intact in the customer proof.
  return proofDocument.save({ useObjectStreams: true });
}

export async function createPngProofSourcePdf({
  pngDataUrl,
  widthPoints,
  heightPoints,
  bleedPoints = 0
}) {
  const document = await PDFDocument.create();
  const image = await document.embedPng(pngDataUrl);
  const page = document.addPage([widthPoints, heightPoints]);
  page.drawImage(image, { x: 0, y: 0, width: widthPoints, height: heightPoints });
  page.setMediaBox(0, 0, widthPoints, heightPoints);
  page.setCropBox(0, 0, widthPoints, heightPoints);
  page.setBleedBox(0, 0, widthPoints, heightPoints);
  page.setTrimBox(
    bleedPoints,
    bleedPoints,
    Math.max(1, widthPoints - (bleedPoints * 2)),
    Math.max(1, heightPoints - (bleedPoints * 2))
  );
  return document.save({ useObjectStreams: false });
}
