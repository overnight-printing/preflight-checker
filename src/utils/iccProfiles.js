import { PDFArray, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

export const MAX_ICC_BYTES = 16 * 1024 * 1024;

export function getIccProfileInfo(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 132 || bytes.length > MAX_ICC_BYTES) {
    throw new Error('Choose an ICC profile between 132 bytes and 16 MB.');
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const text = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  const size = view.getUint32(0);
  if (text(36, 40) !== 'acsp' || size < 132 || size > bytes.length) throw new Error('The file is not a complete ICC profile.');
  const colorSpace = text(16, 20).trim();
  const channels = { RGB: 3, GRAY: 1, CMYK: 4, Lab: 3 }[colorSpace];
  if (!channels) throw new Error(`Unsupported ICC color space: ${colorSpace}.`);
  return { colorSpace, channels };
}

export function getEmbeddedCmykProfile(document) {
  const lookup = value => document.context.lookup(value);
  const intents = lookup(document.catalog.get(PDFName.of('OutputIntents')));
  const profiles = [];
  if (intents instanceof PDFArray) for (const ref of intents.asArray()) {
    const intent = lookup(ref);
    if (!(intent instanceof PDFDict)) continue;
    const stream = lookup(intent.get(PDFName.of('DestOutputProfile')));
    if (!(stream instanceof PDFRawStream) || stream.dict.get(PDFName.of('N'))?.asNumber?.() !== 4) continue;
    try {
      const bytes = decodePDFRawStream(stream).decode();
      if (getIccProfileInfo(bytes).colorSpace !== 'CMYK') continue;
      profiles.push({ bytes, name: intent.get(PDFName.of('OutputConditionIdentifier'))?.decodeText?.() || 'Embedded CMYK profile' });
    } catch { /* An invalid profile cannot be used as a destination. */ }
  }
  return profiles.length === 1 ? profiles[0] : null;
}

export function getSpotAlternateInfo(space, lookup) {
  if (space === PDFName.of('DeviceCMYK')) return { needsProfile: false, reason: null };
  if (space instanceof PDFArray && space.get(0) === PDFName.of('ICCBased')) {
    try {
      const profile = lookup(space.get(1));
      if (!(profile instanceof PDFRawStream)) throw new Error('Missing embedded source ICC profile.');
      const info = getIccProfileInfo(decodePDFRawStream(profile).decode());
      if (profile.dict.get(PDFName.of('N'))?.asNumber() !== info.channels) throw new Error('Source ICC profile channel count does not match its color space.');
      return { needsProfile: true, reason: null };
    } catch (error) { return { needsProfile: true, reason: error.message }; }
  }
  if (space instanceof PDFArray && space.get(0) === PDFName.of('Lab')) {
    const parameters = lookup(space.get(1));
    const white = parameters instanceof PDFDict && lookup(parameters.get(PDFName.of('WhitePoint')));
    const black = parameters instanceof PDFDict && lookup(parameters.get(PDFName.of('BlackPoint')));
    const xyz = white instanceof PDFArray ? white.asArray().map(value => lookup(value)?.asNumber?.()) : [];
    const validWhite = xyz.length === 3 && xyz.every(value => Number.isFinite(value) && value > 0) && Math.abs(xyz[1] - 1) < 0.0001;
    const validBlack = !black || (black instanceof PDFArray && black.size() === 3 && black.asArray().every(value => lookup(value)?.asNumber?.() === 0));
    return { needsProfile: true, reason: validWhite && validBlack ? null : 'Unsupported Lab white or black point.' };
  }
  return { needsProfile: false, reason: 'This alternate color space has no supported CMYK conversion.' };
}
