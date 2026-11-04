import { PDFArray, PDFBool, PDFDict, PDFName, PDFNull, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { contentOperators } from './pdfContent.js';
import { evaluatePdfFunction } from './pdfFunction.js';

const DEVICE_SPACES = ['/DeviceGray', '/DeviceRGB', '/DeviceCMYK'];

function resolveColorSpace(name, resources, lookup) {
  if (typeof name !== 'string') return null;
  if (DEVICE_SPACES.includes(name) || name === '/Pattern') return PDFName.of(name.slice(1));
  const spaces = resources instanceof PDFDict && lookup(resources.get(PDFName.of('ColorSpace')));
  return spaces instanceof PDFDict ? lookup(spaces.get(PDFName.of(name.slice(1)))) || null : null;
}

function namesInSpotSpace(space, lookup) {
  if (!(space instanceof PDFArray) || !['/Separation', '/DeviceN'].includes(space.get(0)?.toString())) return [];
  const names = lookup(space.get(1));
  return (names instanceof PDFArray ? names.asArray() : [names]).map(value => value?.toString());
}

/**
 * Rewrites scn/SCN paint operators that use an operator-selected Separation
 * or DeviceN spot, replacing each with the colorspace's own declared
 * tint-transform equivalent in DeviceCMYK or an explicitly tagged CMYK ICC
 * space. Unsupported source spaces and invalid transforms are reported.
 */
export function convertSpotColorsInContent(text, resources, lookup, spotNames, initialState = {}, colorConversion = null) {
  let state = { fillSpace: PDFName.of('DeviceGray'), strokeSpace: PDFName.of('DeviceGray'), fillTintKnown: true, strokeTintKnown: true, textMode: 0, renderingIntent: 'RelativeColorimetric', ...initialState };
  const stack = [];
  const replacements = [];
  const converted = new Set(), unconverted = new Set(), profiled = new Set();
  const reasons = new Map(), draws = [], shadings = [], patterns = [];
  const reject = (names, reason) => names.forEach(name => { unconverted.add(name); reasons.set(name, reason); });

  for (const { operator, args, start, end } of contentOperators(text)) {
    if (operator === 'BI') { reject(spotNames, 'Inline image color spaces require source-file color management.'); continue; }
    if (operator === 'q') { stack.push({ ...state }); continue; }
    if (operator === 'Q') { state = stack.pop() || state; continue; }
    if (operator === 'cs') { state.fillSpace = resolveColorSpace(args[0], resources, lookup); state.fillTintKnown = false; continue; }
    if (operator === 'CS') { state.strokeSpace = resolveColorSpace(args[0], resources, lookup); state.strokeTintKnown = false; continue; }
    if (operator === 'Tr') { state.textMode = args[0]; continue; }
    if (operator === 'ri') { state.renderingIntent = args[0]?.slice(1); continue; }
    if (operator === 'gs') {
      const states = resources instanceof PDFDict && lookup(resources.get(PDFName.of('ExtGState')));
      const graphics = states instanceof PDFDict && typeof args[0] === 'string' && lookup(states.get(PDFName.of(args[0].slice(1))));
      const intent = graphics instanceof PDFDict && lookup(graphics.get(PDFName.of('RI')));
      if (intent instanceof PDFName) state.renderingIntent = intent.decodeText();
      continue;
    }
    if (operator === 'Do') { draws.push({ name: args[0]?.slice(1), state: { ...state } }); continue; }
    if (operator === 'sh') { shadings.push(args[0]?.slice(1)); continue; }
    if (['g', 'G', 'rg', 'RG', 'k', 'K'].includes(operator)) {
      state[operator === operator.toLowerCase() ? 'fillSpace' : 'strokeSpace'] = PDFName.of({ g: 'DeviceGray', rg: 'DeviceRGB', k: 'DeviceCMYK' }[operator.toLowerCase()]);
      continue;
    }
    const textPaint = ['Tj', 'TJ', "'", '"'].includes(operator);
    const fillPaint = ['f', 'F', 'f*', 'B', 'B*', 'b', 'b*'].includes(operator) || (textPaint && [0, 2, 4, 6].includes(state.textMode));
    const strokePaint = ['S', 's', 'B', 'B*', 'b', 'b*'].includes(operator) || (textPaint && [1, 2, 5, 6].includes(state.textMode));
    if (fillPaint && !state.fillTintKnown) reject(namesInSpotSpace(state.fillSpace, lookup).filter(name => spotNames.has(name)), 'Implicit default spot colors were left unchanged.');
    if (strokePaint && !state.strokeTintKnown) reject(namesInSpotSpace(state.strokeSpace, lookup).filter(name => spotNames.has(name)), 'Implicit default spot colors were left unchanged.');
    if (!['scn', 'SCN', 'sc', 'SC'].includes(operator)) continue;

    const fill = operator === operator.toLowerCase();
    const space = fill ? state.fillSpace : state.strokeSpace;
    if (space === PDFName.of('Pattern') || (space instanceof PDFArray && space.get(0) === PDFName.of('Pattern'))) {
      if (typeof args.at(-1) === 'string') patterns.push({ name: args.at(-1).slice(1), state: { ...state } });
      if (space instanceof PDFArray) reject(namesInSpotSpace(lookup(space.get(1)), lookup).filter(name => spotNames.has(name)), 'Uncolored pattern spot inks were left unchanged.');
      continue;
    }
    if (!(space instanceof PDFArray)) continue;
    const family = space.get(0)?.toString();
    if (family !== '/Separation' && family !== '/DeviceN') continue;

    state[fill ? 'fillTintKnown' : 'strokeTintKnown'] = true;
    const spotList = namesInSpotSpace(space, lookup);
    const selected = spotList.filter(name => spotNames.has(name));
    if (!selected.length) continue;
    // A DeviceN tint transform converts every component together; preserve unselected plates.
    if (selected.length !== spotList.length) { reject(selected, 'Select every ink in this shared DeviceN space to convert it.'); continue; }

    const tint = args.filter(arg => typeof arg === 'number');
    if (tint.length !== spotList.length) { reject(selected, 'The spot tint has an invalid component count.'); continue; }

    let result;
    const alternate = lookup(space.get(2));
    const needsProfile = alternate !== PDFName.of('DeviceCMYK');
    try {
      result = evaluatePdfFunction(lookup(space.get(3)), tint, lookup);
      if (needsProfile) {
        if (!colorConversion) throw new Error('Choose a CMYK press/paper ICC profile for this ink.');
        result = colorConversion.convert(alternate, result, lookup, state.renderingIntent);
      }
    } catch (error) { reject(selected, error.message || 'Unsupported spot tint transform.'); continue; }
    if (!result || result.length !== 4 || result.some(value => !Number.isFinite(value) || value < 0 || value > 1)) {
      reject(selected, 'The tint transform produced invalid CMYK components.'); continue;
    }

    const resultOperator = needsProfile ? (fill ? 'scn' : 'SCN') : (fill ? 'k' : 'K');
    const selector = needsProfile ? `${colorConversion.colorSpace(resources)} ${fill ? 'cs' : 'CS'} ` : '';
    replacements.push({ start, end, value: `${selector}${result.map(value => +value.toFixed(5)).join(' ')} ${resultOperator}` });
    if (needsProfile) selected.forEach(name => profiled.add(name));
    selected.forEach(name => converted.add(name));
  }

  let output = text;
  for (const { start, end, value } of replacements.slice().reverse()) output = output.slice(0, start) + value + output.slice(end);
  return { text: output, converted, unconverted, profiled, reasons, draws, shadings, patterns, state };
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
    const spotList = namesInSpotSpace(space, lookup);
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
 * CMYK equivalent across pages and Forms. Plan the whole document before
 * rewriting so one unsupported use cannot leave a partly converted plate.
 */
export function convertSpotColorsToCmyk(pdfDoc, spotNames, { colorConverter = null, outputProfileBytes = null } = {}) {
  const { context } = pdfDoc;
  const lookup = value => context.lookup(value);
  const converted = new Set(), unconverted = new Set(), profiled = new Set(), reasons = new Map();
  const visitedResourceDicts = new Set();
  const records = [];
  const draftByOwner = new Map();
  const reject = (names, reason) => names.forEach(name => { unconverted.add(name); reasons.set(name, reason); });
  const hasComplexType3Glyphs = dictionary => {
    if (dictionary.get(PDFName.of('Subtype')) !== PDFName.of('Type3')) return false;
    const resources = lookup(dictionary.get(PDFName.of('Resources')));
    if (resources instanceof PDFDict && resources.keys().length) return true;
    const glyphs = lookup(dictionary.get(PDFName.of('CharProcs')));
    if (!(glyphs instanceof PDFDict)) return true;
    try {
      return glyphs.values().some(value => {
        const stream = lookup(value);
        return !(stream instanceof PDFRawStream) || [...contentOperators(decodeStreamText(stream))].some(({ operator }) => ['cs', 'CS', 'sc', 'SC', 'scn', 'SCN', 'Do', 'BI', 'sh', 'gs'].includes(operator));
      });
    } catch { return true; }
  };
  const inspected = new Set();
  const inspect = value => {
    const object = lookup(value);
    if (!object || inspected.has(object)) return;
    inspected.add(object);
    const dictionary = object instanceof PDFRawStream ? object.dict : object;
    if (dictionary instanceof PDFDict) {
      const mask = lookup(dictionary.get(PDFName.of('SMask')));
      if (hasComplexType3Glyphs(dictionary) || dictionary.has(PDFName.of('AP')) || (mask instanceof PDFDict && mask.has(PDFName.of('G')))) {
        reject(spotNames, 'Complex Type3 glyphs, annotation appearances, or soft-mask groups require source-file spot conversion.');
      }
      dictionary.values().forEach(inspect);
    } else if (object instanceof PDFArray) object.asArray().forEach(inspect);
  };
  inspect(pdfDoc.catalog);
  if (unconverted.size) return { converted, unconverted, profiled, reasons };
  const conversion = colorConverter ? { convert: colorConverter.convert, colorSpace: () => '/ConvertedCMYKPreview' } : null;
  const blockNonVectorSpace = (space, resources, visited = new Set()) => {
    if (space instanceof PDFName) space = resolveColorSpace(space.toString(), resources, lookup);
    if (visited.has(space)) { reject(spotNames, 'A cyclic image color space was left unchanged.'); return; }
    visited.add(space);
    if (space instanceof PDFArray && space.get(0) === PDFName.of('Indexed')) return blockNonVectorSpace(lookup(space.get(1)), resources, visited);
    reject(namesInSpotSpace(space, lookup).filter(name => spotNames.has(name)), 'Spot colors in images or shadings are not supported by this vector repair.');
  };

  const processContentList = (streams, resources, ancestors, initialState, owner, allowConversion = true) => {
    if (streams.some(stream => !(stream instanceof PDFRawStream) || ancestors.has(stream))) { reject(spotNames, 'Unreadable or cyclic PDF content was left unchanged.'); return; }
    let text;
    try { text = streams.map(decodeStreamText).join('\n'); }
    catch { reject(spotNames, 'Unreadable PDF content was left unchanged.'); return; }
    const result = convertSpotColorsInContent(text, resources, lookup, spotNames, initialState, conversion);
    if (allowConversion) result.converted.forEach(name => converted.add(name));
    else reject(result.converted, 'Spot colors inside patterns were left unchanged.');
    result.unconverted.forEach(name => unconverted.add(name));
    result.profiled.forEach(name => profiled.add(name));
    result.reasons.forEach((reason, name) => reasons.set(name, reason));
    if (draftByOwner.has(owner) && draftByOwner.get(owner) !== result.text) reject(spotNames, 'A shared Form has different inherited colors or rendering intents; its inks were left unchanged.');
    draftByOwner.set(owner, result.text);
    visitedResourceDicts.add(resources);
    records.push({ streams, resources, text, initialState, owner });

    const xObjects = resources instanceof PDFDict && lookup(resources.get(PDFName.of('XObject')));
    for (const draw of result.draws) {
      if (!(xObjects instanceof PDFDict) || !draw.name) continue;
      const object = lookup(xObjects.get(PDFName.of(draw.name)));
      if (!(object instanceof PDFRawStream)) continue;
      if (object.dict.get(PDFName.of('Subtype')) === PDFName.of('Image')) {
        blockNonVectorSpace(lookup(object.dict.get(PDFName.of('ColorSpace'))), resources);
        if (object.dict.get(PDFName.of('ImageMask')) === PDFBool.True && !draw.state.fillTintKnown) blockNonVectorSpace(draw.state.fillSpace, resources);
        continue;
      }
      if (object.dict.get(PDFName.of('Subtype')) !== PDFName.of('Form')) continue;
      const formResources = lookup(object.dict.get(PDFName.of('Resources'))) || resources;
      processContentList([object], formResources, new Set([...ancestors, ...streams]), draw.state, object, allowConversion);
    }
    const shadings = resources instanceof PDFDict && lookup(resources.get(PDFName.of('Shading')));
    for (const name of result.shadings) {
      const shading = shadings instanceof PDFDict && name && lookup(shadings.get(PDFName.of(name)));
      const dictionary = shading instanceof PDFRawStream ? shading.dict : shading;
      if (dictionary instanceof PDFDict) blockNonVectorSpace(lookup(dictionary.get(PDFName.of('ColorSpace'))), resources);
    }
    const patternResources = resources instanceof PDFDict && lookup(resources.get(PDFName.of('Pattern')));
    for (const draw of result.patterns) {
      const pattern = patternResources instanceof PDFDict && lookup(patternResources.get(PDFName.of(draw.name)));
      if (pattern instanceof PDFRawStream) {
        processContentList([pattern], lookup(pattern.dict.get(PDFName.of('Resources'))) || resources, new Set([...ancestors, ...streams]), draw.state, pattern, false);
      } else if (pattern instanceof PDFDict) {
        const shading = lookup(pattern.get(PDFName.of('Shading')));
        const dictionary = shading instanceof PDFRawStream ? shading.dict : shading;
        if (dictionary instanceof PDFDict) blockNonVectorSpace(lookup(dictionary.get(PDFName.of('ColorSpace'))), resources);
      }
    }
  };

  for (const page of pdfDoc.getPages()) {
    const resources = page.node.Resources();
    if (!(resources instanceof PDFDict)) continue;
    const contents = lookup(page.node.get(PDFName.of('Contents')));
    if (!contents || contents === PDFNull) continue;
    const streams = contents instanceof PDFArray ? contents.asArray().map(lookup) : [contents];
    processContentList(streams, resources, new Set(), {}, streams.length === 1 ? streams[0] : page.node);
  }

  // Safe to prune now that the whole document has been converted: a
  // Separation/DeviceN resource entry is removable only if every spot name it
  // names was converted and never left unconverted anywhere in the document.
  for (const name of spotNames) if (!converted.has(name) && !unconverted.has(name)) reject([name], 'No supported vector paint was found for this ink.');
  const removable = [...converted].filter(name => !unconverted.has(name));
  const eligible = new Set(removable);
  let profileRef;
  const processSpaces = new Map();
  if (colorConverter && !outputProfileBytes) throw new Error('A destination ICC profile is required.');
  const finalConversion = colorConverter ? { convert: colorConverter.convert, colorSpace(resources) {
    if (!processSpaces.has(resources)) {
      if (!profileRef) profileRef = context.register(context.flateStream(outputProfileBytes, { N: 4, Alternate: 'DeviceCMYK' }));
      let spaces = lookup(resources.get(PDFName.of('ColorSpace')));
      if (!(spaces instanceof PDFDict)) { spaces = context.obj({}); resources.set(PDFName.of('ColorSpace'), spaces); }
      const name = spaces.uniqueKey('ConvertedCMYK');
      spaces.set(name, context.obj(['ICCBased', profileRef]));
      processSpaces.set(resources, name.toString());
    }
    return processSpaces.get(resources);
  } } : null;
  const updates = new Map();
  for (const record of records) {
    const result = convertSpotColorsInContent(record.text, record.resources, lookup, eligible, record.initialState, finalConversion);
    if (result.unconverted.size) throw new Error('The ICC conversion could not be completed; artwork was not changed.');
    const text = stripDanglingColorSpaceSelectors(result.text, record.resources, lookup, removable);
    if (updates.has(record.owner) && updates.get(record.owner).text !== text) {
      return { converted: new Set(), unconverted: new Set(spotNames), profiled: new Set(), reasons: new Map([...spotNames].map(name => [name, 'A shared Form requires conflicting resource names; artwork was left unchanged.'])) };
    }
    updates.set(record.owner, { ...record, text });
  }
  for (const record of updates.values()) {
    const original = record.streams.map(decodeStreamText).join('\n');
    if (record.text === original) continue;
    if (record.streams.length === 1) encodeStreamText(record.streams[0], context, record.text);
    else record.owner.set(PDFName.of('Contents'), context.register(context.flateStream(Uint8Array.from(record.text, ch => ch.charCodeAt(0)))));
  }
  for (const resources of visitedResourceDicts) {
    const spaces = lookup(resources.get(PDFName.of('ColorSpace')));
    if (!(spaces instanceof PDFDict)) continue;
    for (const key of spaces.keys()) {
      const space = lookup(spaces.get(key));
      if (!(space instanceof PDFArray)) continue;
      const family = space.get(0)?.toString();
      if (family !== '/Separation' && family !== '/DeviceN') continue;
      const spotList = namesInSpotSpace(space, lookup);
      if (spotList.every(name => removable.includes(name))) spaces.delete(key);
    }
  }

  return { converted: eligible, unconverted, profiled: new Set([...profiled].filter(name => eligible.has(name))), reasons };
}
