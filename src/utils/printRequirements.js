import { PDFArray, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

import { normalizePrintRequirements } from './printSettings.js';
export { normalizePrintRequirements } from './printSettings.js';

const readText = value => value?.decodeText?.() || value?.asString?.() || '';
const inside = (inner, outer) => inner.x >= outer.x - 0.1 && inner.y >= outer.y - 0.1 &&
  inner.x + inner.width <= outer.x + outer.width + 0.1 && inner.y + inner.height <= outer.y + outer.height + 0.1;

export function getPrintDocumentChecks(document, requirements = {}) {
  const { workflow } = normalizePrintRequirements(requirements);
  const checks = {};
  const invalidPages = [], missingTrimPages = [], annotationPages = [], unitPages = [];
  for (const [index, page] of document.getPages().entries()) {
    const number = index + 1;
    const media = page.getMediaBox(), crop = page.getCropBox(), trim = page.getTrimBox(), bleed = page.getBleedBox();
    if (![media, crop, trim, bleed].every(box => Object.values(box).every(Number.isFinite) && box.width > 0 && box.height > 0) ||
        !inside(crop, media) || !inside(trim, crop) || !inside(bleed, media) || !inside(trim, bleed)) invalidPages.push(number);
    if (!page.node.has(PDFName.of('TrimBox'))) missingTrimPages.push(number);
    const annotations = document.context.lookup(page.node.get(PDFName.of('Annots')));
    if (annotations instanceof PDFArray && annotations.size()) annotationPages.push(number);
    const unit = document.context.lookup(page.node.get(PDFName.of('UserUnit')))?.asNumber?.() || 1;
    if (unit !== 1) unitPages.push(number);
  }
  checks.pageGeometry = invalidPages.length
    ? { status: 'error', details: `Invalid or inconsistent PDF page boxes on pages ${invalidPages.join(', ')}. Repair the page geometry in the source file.`, value: invalidPages }
    : missingTrimPages.length
      ? { status: 'warning', details: `No explicit finished TrimBox on pages ${missingTrimPages.join(', ')}. The CropBox is being used as the finished size; confirm it with the job ticket.`, value: missingTrimPages }
      : { status: 'pass', details: 'Explicit finished TrimBoxes and page boundaries are consistent.', value: true };

  const intents = document.context.lookup(document.catalog.get(PDFName.of('OutputIntents')));
  const profiles = [], invalidProfiles = [];
  if (intents instanceof PDFArray) for (const entry of intents.asArray()) {
    const intent = document.context.lookup(entry);
    if (!(intent instanceof PDFDict)) { invalidProfiles.push('Invalid output intent'); continue; }
    const name = readText(intent.get(PDFName.of('OutputConditionIdentifier'))) || 'Unnamed output profile';
    const profile = document.context.lookup(intent.get(PDFName.of('DestOutputProfile')));
    try {
      const bytes = profile instanceof PDFRawStream ? decodePDFRawStream(profile).decode() : null;
      const signature = bytes && new TextDecoder().decode(bytes.slice(36, 40));
      const colorSpace = bytes && new TextDecoder().decode(bytes.slice(16, 20));
      const channels = profile instanceof PDFRawStream && profile.dict.get(PDFName.of('N'))?.asNumber();
      if (!bytes || bytes.length < 128 || signature !== 'acsp' || ![['CMYK', 4], ['RGB ', 3], ['GRAY', 1]].some(([space, count]) => colorSpace === space && channels === count)) {
        invalidProfiles.push(name);
      } else profiles.push({ name, colorSpace: colorSpace.trim(), channels });
    } catch { invalidProfiles.push(name); }
  }
  checks.outputIntent = invalidProfiles.length
    ? { status: 'error', details: `Missing or unreadable embedded output profile: ${invalidProfiles.join(', ')}. Re-export with the printer's ICC output profile.`, value: profiles }
    : profiles.length
      ? { status: 'pass', details: `Embedded output intent: ${profiles.map(profile => `${profile.name} (${profile.colorSpace})`).join(', ')}. Confirm it matches the press and paper.`, value: profiles }
      : { status: workflow === 'general' ? 'warning' : 'error', details: 'No embedded ICC output intent. Obtain the press/paper profile from the printer and export with that profile. This tool does not perform color conversion.', value: [] };

  const info = document.context.lookup(document.context.trailerInfo.Info);
  let declared = info instanceof PDFDict ? readText(info.get(PDFName.of('GTS_PDFXVersion'))) : '';
  const metadata = document.context.lookup(document.catalog.get(PDFName.of('Metadata')));
  if (!declared && metadata instanceof PDFRawStream) {
    try {
      const xmp = new TextDecoder().decode(decodePDFRawStream(metadata).decode());
      declared = xmp.match(/(?:pdfxid|pdfx):GTS_PDFXVersion\s*=\s*["']([^"']+)["']/)?.[1] ||
        xmp.match(/<(?:pdfxid|pdfx):GTS_PDFXVersion>([^<]+)</)?.[1] || '';
    } catch { /* Unreadable metadata cannot establish a PDF/X declaration. */ }
  }
  const expected = workflow === 'legacy' ? 'PDF/X-1a' : 'PDF/X-4';
  checks.pdfxStandard = {
    status: workflow !== 'general' && !declared.startsWith(expected) ? 'error' : 'info',
    details: declared ? `Source declares ${declared}. Full PDF/X conformance is not validated by this checker${workflow !== 'general' ? `; job requires ${expected}` : ''}.`
      : `No PDF/X declaration${workflow !== 'general' ? `; job requires ${expected}` : ''}. Use a dedicated PDF/X validator for certification.`,
    value: declared || null
  };
  checks.interactiveContent = {
    status: annotationPages.length || document.catalog.has(PDFName.of('AcroForm')) ? 'warning' : 'pass',
    details: annotationPages.length || document.catalog.has(PDFName.of('AcroForm'))
      ? `Annotations or form fields are present${annotationPages.length ? ` on pages ${annotationPages.join(', ')}` : ''}. Flatten intended printable appearances before bleed/crop or proofing; page embedding does not include annotations.`
      : 'No page annotations or form fields detected.', value: annotationPages
  };
  checks.pageUnits = {
    status: unitPages.length ? 'warning' : 'pass',
    details: unitPages.length ? `Custom UserUnit scaling on pages ${unitPages.join(', ')}. Confirm physical dimensions in a production PDF editor before modifying this file.`
      : 'Standard PDF page units (72 points per inch).', value: unitPages
  };
  return checks;
}
