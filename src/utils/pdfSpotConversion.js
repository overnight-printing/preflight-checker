import { PDFArray, PDFDict, PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { contentOperators, scanContent } from './pdfContent.js';
import { evaluatePdfFunction } from './pdfFunction.js';

const DEVICE_SPACES = ['/DeviceGray', '/DeviceRGB', '/DeviceCMYK'];
const PAINT_OPERATOR = { '/DeviceGray': 'g', '/DeviceRGB': 'rg', '/DeviceCMYK': 'k' };

function resolveColorSpace(name, resources, lookup) {
  if (typeof name !== 'string' || DEVICE_SPACES.includes(name) || name === '/Pattern') return null;
  const spaces = resources instanceof PDFDict && lookup(resources.get(PDFName.of('ColorSpace')));
  return spaces instanceof PDFDict ? lookup(spaces.get(PDFName.of(name.slice(1)))) || null : null;
}

// Resolve an alternate colorspace to one of Gray/RGB/CMYK, following
// CalGray/CalRGB and ICCBased channel count the way preflightChecker.js's
// isRgbColorSpace already does - or null to refuse rather than guess (Lab,
// an unusual ICC channel count, or anything else unrecognized).
function deviceEquivalent(space, lookup) {
  const name = space?.toString?.();
  if (DEVICE_SPACES.includes(name)) return name;
  if (!(space instanceof PDFArray)) return null;
  const type = space.get(0)?.toString();
  if (type === '/CalGray') return '/DeviceGray';
  if (type === '/CalRGB') return '/DeviceRGB';
  if (type === '/ICCBased') {
    const profile = lookup(space.get(1));
    const channels = profile instanceof PDFRawStream && profile.dict.get(PDFName.of('N'))?.asNumber();
    return { 1: '/DeviceGray', 3: '/DeviceRGB', 4: '/DeviceCMYK' }[channels] || null;
  }
  return null;
}

/**
 * Rewrites scn/SCN paint operators that use an operator-selected Separation
 * or DeviceN spot, replacing each with the colorspace's own declared
 * tint-transform equivalent in its alternate space - spec-correct, not an
 * approximation. A spot whose alternate space isn't Gray/RGB/CMYK, or whose
 * tint-transform fails to evaluate, or whose operands don't match the
 * colorspace's component count, is left completely untouched and reported
 * in `unconverted` rather than guessed at.
 */
export function convertSpotColorsInContent(text, resources, lookup, spotNames, initialState = {}) {
  let fillSpaceName = initialState.fillSpaceName || '/DeviceGray';
  let strokeSpaceName = initialState.strokeSpaceName || '/DeviceGray';
  const stack = [];
  const replacements = [];
  const converted = new Set(), unconverted = new Set();

  for (const { operator, args, start, end } of contentOperators(text)) {
    if (operator === 'q') { stack.push([fillSpaceName, strokeSpaceName]); continue; }
    if (operator === 'Q') { [fillSpaceName, strokeSpaceName] = stack.pop() || [fillSpaceName, strokeSpaceName]; continue; }
    if (operator === 'cs') { fillSpaceName = args[0]; continue; }
    if (operator === 'CS') { strokeSpaceName = args[0]; continue; }
    if (operator !== 'scn' && operator !== 'SCN') continue;

    const fill = operator === 'scn';
    const space = resolveColorSpace(fill ? fillSpaceName : strokeSpaceName, resources, lookup);
    if (!(space instanceof PDFArray)) continue;
    const family = space.get(0)?.toString();
    if (family !== '/Separation' && family !== '/DeviceN') continue;

    const namesEntry = lookup(space.get(1));
    const spotList = (namesEntry instanceof PDFArray ? namesEntry.asArray() : [namesEntry]).map(value => value?.toString());
    const selected = spotList.filter(name => spotNames.has(name));
    if (!selected.length) continue;

    const tint = args.filter(arg => typeof arg === 'number');
    if (tint.length !== spotList.length) { selected.forEach(name => unconverted.add(name)); continue; }

    const targetSpace = deviceEquivalent(lookup(space.get(2)), lookup);
    const paintOp = targetSpace && PAINT_OPERATOR[targetSpace];
    if (!paintOp) { selected.forEach(name => unconverted.add(name)); continue; }

    let result;
    try { result = evaluatePdfFunction(lookup(space.get(3)), tint, lookup); }
    catch { result = null; }
    if (!result) { selected.forEach(name => unconverted.add(name)); continue; }

    const resultOperator = fill ? paintOp : paintOp.toUpperCase();
    replacements.push({ start, end, value: `${result.map(value => +value.toFixed(5)).join(' ')} ${resultOperator}` });
    selected.forEach(name => converted.add(name));
  }

  let output = text;
  for (const { start, end, value } of replacements.slice().reverse()) output = output.slice(0, start) + value + output.slice(end);
  return { text: output, converted, unconverted, fillSpaceName, strokeSpaceName };
}

// A cs/CS call selecting a spot colorspace that ends up fully converted (see
// `removable` below) becomes a dangling reference once that colorspace's
// resource entry is deleted - still present in the stream, pointing at
// nothing, which some renderers flag as an "unrecognized colorspace" even
// though nothing downstream still needs it (every scn/SCN using it was
// already rewritten to a direct g/rg/k operator). Blanked out for the same
// reason the resource entry itself is deleted: safe only once nothing in the
// whole document still needs that name.
function stripDanglingColorSpaceSelectors(text, resources, lookup, removable) {
  if (!removable.length) return text;
  const replacements = [];
  for (const { operator, args, start, end } of contentOperators(text)) {
    if (operator !== 'cs' && operator !== 'CS') continue;
    const space = resolveColorSpace(args[0], resources, lookup);
    if (!(space instanceof PDFArray)) continue;
    const family = space.get(0)?.toString();
    if (family !== '/Separation' && family !== '/DeviceN') continue;
    const namesEntry = lookup(space.get(1));
    const spotList = (namesEntry instanceof PDFArray ? namesEntry.asArray() : [namesEntry]).map(value => value?.toString());
    if (spotList.every(name => removable.includes(name))) replacements.push({ start, end, value: '' });
  }
  if (!replacements.length) return text;
  let output = text;
  for (const { start, end, value } of replacements.slice().reverse()) output = output.slice(0, start) + value + output.slice(end);
  return output;
}

function decodeStreamText(stream) {
  return new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode());
}

function encodeStreamText(stream, context, text) {
  stream.contents = context.flateStream(Uint8Array.from(text, ch => ch.charCodeAt(0))).contents;
  stream.dict.set(PDFName.of('Filter'), PDFName.of('FlateDecode'));
  stream.dict.delete(PDFName.of('DecodeParms'));
}

/**
 * Converts operator-selected Separation/DeviceN spots to their declared
 * CMYK/Gray/RGB equivalent across every page and nested Form XObject, then
 * removes the now-unused colorspace resource entries. Returns which spot
 * names were converted everywhere they appeared, and which were left alone
 * anywhere (an unsupported alternate space, a malformed tint-transform, or
 * mismatched operands) - surfaced to the operator, never silently dropped.
 */
export function convertSpotColorsToCmyk(pdfDoc, spotNames) {
  const { context } = pdfDoc;
  const lookup = value => context.lookup(value);
  const converted = new Set(), unconverted = new Set();
  const visitedResourceDicts = new Set();
  const visitedStreams = [];

  const processContentList = (streams, resources, ancestors, initialState) => {
    let state = initialState;
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream) || ancestors.has(stream)) continue;
      let text;
      try { text = decodeStreamText(stream); } catch { continue; }

      const result = convertSpotColorsInContent(text, resources, lookup, spotNames, state);
      result.converted.forEach(name => converted.add(name));
      result.unconverted.forEach(name => unconverted.add(name));
      if (result.text !== text) encodeStreamText(stream, context, result.text);
      state = { fillSpaceName: result.fillSpaceName, strokeSpaceName: result.strokeSpaceName };
      visitedResourceDicts.add(resources);
      visitedStreams.push({ stream, resources });

      const xObjects = resources instanceof PDFDict && lookup(resources.get(PDFName.of('XObject')));
      if (!(xObjects instanceof PDFDict)) continue;
      const scan = scanContent(text, resources, lookup);
      for (const draw of scan.draws) {
        const object = lookup(xObjects.get(PDFName.of(draw.name)));
        if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of('Subtype')) !== PDFName.of('Form')) continue;
        const formResources = lookup(object.dict.get(PDFName.of('Resources'))) || resources;
        // A Form XObject's content always starts from default graphics state.
        processContentList([object], formResources, new Set(ancestors).add(stream), {});
      }
    }
  };

  for (const page of pdfDoc.getPages()) {
    const resources = page.node.Resources();
    if (!(resources instanceof PDFDict)) continue;
    const contents = lookup(page.node.get(PDFName.of('Contents')));
    const streams = contents instanceof PDFArray ? contents.asArray().map(lookup) : [contents];
    processContentList(streams, resources, new Set(), {});
  }

  // Safe to prune now that the whole document has been converted: a
  // Separation/DeviceN resource entry is removable only if every spot name it
  // names was converted and never left unconverted anywhere in the document.
  const removable = [...converted].filter(name => !unconverted.has(name));
  for (const { stream, resources } of visitedStreams) {
    let text;
    try { text = decodeStreamText(stream); } catch { continue; }
    const stripped = stripDanglingColorSpaceSelectors(text, resources, lookup, removable);
    if (stripped !== text) encodeStreamText(stream, context, stripped);
  }
  for (const resources of visitedResourceDicts) {
    const spaces = lookup(resources.get(PDFName.of('ColorSpace')));
    if (!(spaces instanceof PDFDict)) continue;
    for (const key of spaces.keys()) {
      const space = lookup(spaces.get(key));
      if (!(space instanceof PDFArray)) continue;
      const family = space.get(0)?.toString();
      if (family !== '/Separation' && family !== '/DeviceN') continue;
      const namesEntry = lookup(space.get(1));
      const spotList = (namesEntry instanceof PDFArray ? namesEntry.asArray() : [namesEntry]).map(value => value?.toString());
      if (spotList.every(name => removable.includes(name))) spaces.delete(key);
    }
  }

  return { converted, unconverted };
}
