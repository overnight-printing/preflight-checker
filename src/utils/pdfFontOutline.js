import opentype from 'opentype.js';
import { PDFArray, PDFDict, PDFName, PDFNumber, PDFRawStream, decodePDFRawStream } from 'pdf-lib';
import { contentOperators } from './pdfContent.js';

// Converts embedded-font text runs into filled vector paths ("Create
// Outlines"). Scope of this increment: simple (FontFile2 TrueType) and
// Type0/CIDFontType2 (Identity-H, also FontFile2) fonts, horizontal writing,
// fill-painting render modes only. Everything else - non-embedded fonts (no
// glyph data exists anywhere to outline from - a correctness wall, not a
// laziness cut), Type3 fonts, FontFile3/CFF (Type1/CIDFontType0), a
// non-Identity CMap, vertical writing (Identity-V), and clipping text render
// modes (Tr 4-7) - is left completely untouched and reported in
// `unconverted`, never guessed at or approximated.

// --- WinAnsiEncoding: codes 32-126 and 160-255 map 1:1 to their Unicode
// codepoint; only 128-159 deviate from Latin-1 (smart quotes, dashes, etc).
// Used as the default base encoding (also matches ASCII for Standard/Mac
// in the ranges that matter for most real text) when a simple font's
// /Encoding doesn't name a specific code via /Differences.
const WIN_ANSI_HIGH = {
  128: 0x20AC, 130: 0x201A, 131: 0x0192, 132: 0x201E, 133: 0x2026, 134: 0x2020, 135: 0x2021,
  136: 0x02C6, 137: 0x2030, 138: 0x0160, 139: 0x2039, 140: 0x0152, 142: 0x017D, 145: 0x2018,
  146: 0x2019, 147: 0x201C, 148: 0x201D, 149: 0x2022, 150: 0x2013, 151: 0x2014, 152: 0x02DC,
  153: 0x2122, 154: 0x0161, 155: 0x203A, 156: 0x0153, 158: 0x017E, 159: 0x0178
};
function winAnsiCodepoint(code) {
  if (code in WIN_ANSI_HIGH) return WIN_ANSI_HIGH[code];
  if ((code >= 32 && code <= 126) || (code >= 160 && code <= 255)) return code;
  return null;
}

function decodeLiteralString(raw) {
  const bytes = [];
  for (let i = 0; i < raw.length; i++) {
    const c = raw[i];
    if (c !== '\\') { bytes.push(c.charCodeAt(0) & 0xff); continue; }
    const next = raw[++i];
    if (next === 'n') bytes.push(10);
    else if (next === 'r') bytes.push(13);
    else if (next === 't') bytes.push(9);
    else if (next === 'b') bytes.push(8);
    else if (next === 'f') bytes.push(12);
    else if (next === '(') bytes.push(40);
    else if (next === ')') bytes.push(41);
    else if (next === '\\') bytes.push(92);
    else if (next === '\n') { /* line continuation: emits nothing */ }
    else if (next === '\r') { if (raw[i + 1] === '\n') i++; }
    else if (/[0-7]/.test(next)) {
      let octal = next;
      for (let k = 0; k < 2 && /[0-7]/.test(raw[i + 1]); k++) octal += raw[++i];
      bytes.push(parseInt(octal, 8) & 0xff);
    } else bytes.push(next.charCodeAt(0) & 0xff);
  }
  return Uint8Array.from(bytes);
}

function decodeHexString(raw) {
  const hex = raw.replace(/[^0-9a-fA-F]/g, '');
  const padded = hex.length % 2 ? hex + '0' : hex;
  const bytes = [];
  for (let i = 0; i < padded.length; i += 2) bytes.push(parseInt(padded.slice(i, i + 2), 16));
  return Uint8Array.from(bytes);
}

// Re-parses one Tj/TJ/'/" operator's own source text for its string/number
// operands. contentOperators() deliberately collapses strings and arrays to
// a single `null` placeholder (it never needed their content before now).
function parseShowTextOperands(source) {
  const items = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '(') {
      let depth = 1, j = i + 1;
      while (j < source.length && depth) {
        if (source[j] === '\\') j += 2;
        else { if (source[j] === '(') depth++; else if (source[j] === ')') depth--; j++; }
      }
      items.push({ type: 'string', bytes: decodeLiteralString(source.slice(i + 1, j - 1)) });
      i = j; continue;
    }
    if (c === '<') {
      const end = source.indexOf('>', i + 1);
      items.push({ type: 'string', bytes: decodeHexString(source.slice(i + 1, end)) });
      i = end + 1; continue;
    }
    if (c === '[' || c === ']') { i++; continue; }
    const start = i;
    while (i < source.length && !/[\s()<>[\]]/.test(source[i])) i++;
    const token = source.slice(start, i);
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) items.push({ type: 'number', value: Number(token) });
    i = Math.max(i, start + 1);
  }
  return items;
}

function multiplyMatrix(m1, m2) {
  const [a1, b1, c1, d1, e1, f1] = m1, [a2, b2, c2, d2, e2, f2] = m2;
  return [a1 * a2 + b1 * c2, a1 * b2 + b1 * d2, c1 * a2 + d1 * c2, c1 * b2 + d1 * d2, e1 * a2 + f1 * c2 + e2, e1 * b2 + f1 * d2 + f2];
}

function formatNumber(value) {
  return Number(value.toFixed(4)).toString();
}

// Converts an opentype.js glyph path (already normalized to 1 unit = 1 em)
// into PDF path operators under `transform`, converting TrueType quadratic
// curves to PDF's cubic `c` operator (done in glyph space, before the affine
// transform is applied - affine transforms commute with Bezier conversion).
function glyphPathOperators(path, transform) {
  const apply = (x, y) => [transform[0] * x + transform[2] * y + transform[4], transform[1] * x + transform[3] * y + transform[5]];
  const ops = [];
  let current = [0, 0];
  for (const cmd of path.commands) {
    if (cmd.type === 'M') { current = [cmd.x, cmd.y]; const [x, y] = apply(cmd.x, cmd.y); ops.push(`${formatNumber(x)} ${formatNumber(y)} m`); }
    else if (cmd.type === 'L') { current = [cmd.x, cmd.y]; const [x, y] = apply(cmd.x, cmd.y); ops.push(`${formatNumber(x)} ${formatNumber(y)} l`); }
    else if (cmd.type === 'C') {
      const [x1, y1] = apply(cmd.x1, cmd.y1), [x2, y2] = apply(cmd.x2, cmd.y2), [x, y] = apply(cmd.x, cmd.y);
      ops.push(`${formatNumber(x1)} ${formatNumber(y1)} ${formatNumber(x2)} ${formatNumber(y2)} ${formatNumber(x)} ${formatNumber(y)} c`);
      current = [cmd.x, cmd.y];
    } else if (cmd.type === 'Q') {
      const c1 = [current[0] + (2 / 3) * (cmd.x1 - current[0]), current[1] + (2 / 3) * (cmd.y1 - current[1])];
      const c2 = [cmd.x + (2 / 3) * (cmd.x1 - cmd.x), cmd.y + (2 / 3) * (cmd.y1 - cmd.y)];
      const [x1, y1] = apply(c1[0], c1[1]), [x2, y2] = apply(c2[0], c2[1]), [x, y] = apply(cmd.x, cmd.y);
      ops.push(`${formatNumber(x1)} ${formatNumber(y1)} ${formatNumber(x2)} ${formatNumber(y2)} ${formatNumber(x)} ${formatNumber(y)} c`);
      current = [cmd.x, cmd.y];
    } else if (cmd.type === 'Z') ops.push('h');
  }
  return ops.join(' ');
}

// Resolves one simple-font character code to an opentype.js glyph, or null
// if nothing can be resolved - the caller treats null as a reason to refuse
// the whole text-showing operator rather than paint a missing/wrong glyph.
function resolveSimpleGlyph(font, code, differences) {
  const name = differences?.get(code);
  if (name) {
    const byName = font.nameToGlyphIndex(name);
    if (byName) return font.glyphs.get(byName);
  }
  const codepoint = winAnsiCodepoint(code);
  if (codepoint != null) {
    const byUnicode = font.charToGlyphIndex(String.fromCharCode(codepoint));
    if (byUnicode) return font.glyphs.get(byUnicode);
  }
  const bySymbol = font.charToGlyphIndex(String.fromCharCode(0xF000 + code));
  if (bySymbol) return font.glyphs.get(bySymbol);
  return null;
}

// Returns the embedded font program's bytes if opentype.js can parse them
// directly: FontFile2 (bare TrueType/glyf), or FontFile3 with /Subtype
// /OpenType (a complete sfnt-wrapped font, TrueType- or CFF-flavored - either
// way opentype.js parses it the same way). A bare CFF program (FontFile3
// /Type1C or /CIDFontType0C) has no sfnt wrapper at all - no cmap, head, or
// hmtx tables - so it isn't something opentype.parse() can read standalone;
// that stays refused rather than attempting a hand-built sfnt wrapper.
function getEmbeddedFontBytes(descriptor, lookup) {
  if (!(descriptor instanceof PDFDict)) return null;
  const fontFile2 = lookup(descriptor.get(PDFName.of('FontFile2')));
  if (fontFile2 instanceof PDFRawStream) return decodePDFRawStream(fontFile2).decode();
  const fontFile3 = lookup(descriptor.get(PDFName.of('FontFile3')));
  if (fontFile3 instanceof PDFRawStream && fontFile3.dict.get(PDFName.of('Subtype'))?.toString() === '/OpenType') {
    return decodePDFRawStream(fontFile3).decode();
  }
  return null;
}

// Parses a simple (non-CID) font resource's embedded program and its
// /Differences map. Returns null (refuse) when nothing opentype.js can parse
// directly is embedded (non-embedded, or a bare CFF/Type1 program).
function loadSimpleFont(fontDict, lookup) {
  const descriptor = lookup(fontDict.get(PDFName.of('FontDescriptor')));
  const bytes = getEmbeddedFontBytes(descriptor, lookup);
  if (!bytes) return null;

  let font;
  try { font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); }
  catch { return null; }

  const differences = new Map();
  const encoding = lookup(fontDict.get(PDFName.of('Encoding')));
  const diffArray = encoding instanceof PDFDict && lookup(encoding.get(PDFName.of('Differences')));
  if (diffArray instanceof PDFArray) {
    let code = 0;
    for (const item of diffArray.asArray()) {
      const value = lookup(item);
      if (value instanceof PDFNumber) code = value.asNumber();
      else { differences.set(code, value.toString().replace(/^\//, '')); code += 1; }
    }
  }
  return { kind: 'simple', font, differences };
}

// Parses a Type0/CIDFontType2 (TrueType-based composite) font resource.
// Scope of this increment: /Identity-H only (the overwhelming majority of
// subset-embedded CID fonts use it) and CIDFontType2 (GID indexing works the
// same whether the program arrives as bare TrueType via FontFile2 or
// sfnt-wrapped via FontFile3 /OpenType); a predefined/embedded non-Identity
// CMap, vertical writing (Identity-V), or a CFF-keyed CIDFontType0 (a
// genuinely different CID-to-GID mechanism, not just a different wrapper)
// are refused, not guessed at.
function loadCidFont(fontDict, lookup) {
  if (fontDict.get(PDFName.of('Encoding'))?.toString() !== '/Identity-H') return null;
  const descendants = lookup(fontDict.get(PDFName.of('DescendantFonts')));
  const descendant = descendants instanceof PDFArray && descendants.size() === 1 && lookup(descendants.get(0));
  if (!(descendant instanceof PDFDict) || descendant.get(PDFName.of('Subtype'))?.toString() !== '/CIDFontType2') return null;
  const descriptor = lookup(descendant.get(PDFName.of('FontDescriptor')));
  const bytes = getEmbeddedFontBytes(descriptor, lookup);
  if (!bytes) return null;

  let font;
  try { font = opentype.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)); }
  catch { return null; }

  const cidToGidMap = lookup(descendant.get(PDFName.of('CIDToGIDMap')));
  let cidToGid = null; // null = Identity (CID === GID), the common case
  if (cidToGidMap instanceof PDFRawStream) {
    const bytes = decodePDFRawStream(cidToGidMap).decode();
    cidToGid = cid => (cid * 2 + 1 < bytes.length ? (bytes[cid * 2] << 8) | bytes[cid * 2 + 1] : 0);
  }
  return { kind: 'cid', font, cidToGid };
}

function loadFont(fontDict, lookup) {
  const subtype = fontDict.get(PDFName.of('Subtype'))?.toString();
  if (subtype === '/Type0') return loadCidFont(fontDict, lookup);
  if (subtype === '/Type3') return null; // Type3 "outlining" means inlining CharProcs, not font parsing - deferred
  return loadSimpleFont(fontDict, lookup);
}

/**
 * Outlines fill-painting Tj/TJ/'/" calls for operator-selected simple
 * embedded TrueType fonts. `fontCache` maps font dict identity to
 * `loadFont()`'s result (or `false` for an already-refused font) and
 * is shared across every content stream in the document so each font is
 * parsed once. `fontNames` is the set of BaseFont names (per the Font
 * Embedding preflight check) the operator asked to outline.
 */
export function outlineTextInContent(text, resources, lookup, fontNames, fontCache, initialState = {}) {
  const fontsDict = resources instanceof PDFDict && lookup(resources.get(PDFName.of('Font')));
  let state = { ctm: [1, 0, 0, 1, 0, 0], fontName: null, fontSize: 0, charSpace: 0, wordSpace: 0, hScale: 1, leading: 0, rise: 0, renderMode: 0, ...initialState };
  let textMatrix = null, lineMatrix = null;
  const stack = [];
  const replacements = [];
  const draws = [];
  const converted = new Set(), unconverted = new Set();

  const getFont = fontResourceName => {
    if (!(fontsDict instanceof PDFDict) || typeof fontResourceName !== 'string') return null;
    const fontDict = lookup(fontsDict.get(PDFName.of(fontResourceName.slice(1))));
    if (!(fontDict instanceof PDFDict)) return null;
    if (!fontCache.has(fontDict)) fontCache.set(fontDict, loadFont(fontDict, lookup) || false);
    const baseFontName = lookup(fontDict.get(PDFName.of('BaseFont')))?.toString().replace(/^\//, '').replace(/^[A-Z]{6}\+/, '') || fontResourceName;
    const loaded = fontCache.get(fontDict);
    return { loaded, baseFontName };
  };

  for (const { operator, args, start, end } of contentOperators(text)) {
    if (operator === 'q') { stack.push({ ...state }); continue; }
    if (operator === 'Q') { state = stack.pop() || state; continue; }
    if (operator === 'cm' && args.length === 6 && args.every(Number.isFinite)) { state.ctm = multiplyMatrix(args, state.ctm); continue; }
    if (operator === 'Do' && typeof args[0] === 'string') { draws.push({ name: args[0].slice(1), ctm: state.ctm }); continue; }
    if (operator === 'BT') { textMatrix = [1, 0, 0, 1, 0, 0]; lineMatrix = [1, 0, 0, 1, 0, 0]; continue; }
    if (operator === 'ET') { textMatrix = null; lineMatrix = null; continue; }
    if (operator === 'Tf') { state.fontName = args[0]; state.fontSize = args[1]; continue; }
    if (operator === 'Tc') { state.charSpace = args[0]; continue; }
    if (operator === 'Tw') { state.wordSpace = args[0]; continue; }
    if (operator === 'Tz') { state.hScale = args[0] / 100; continue; }
    if (operator === 'TL') { state.leading = args[0]; continue; }
    if (operator === 'Ts') { state.rise = args[0]; continue; }
    if (operator === 'Tr') { state.renderMode = args[0]; continue; }
    if (operator === 'Td' && lineMatrix) { lineMatrix = multiplyMatrix([1, 0, 0, 1, args[0], args[1]], lineMatrix); textMatrix = lineMatrix; continue; }
    if (operator === 'TD' && lineMatrix) { state.leading = -args[1]; lineMatrix = multiplyMatrix([1, 0, 0, 1, args[0], args[1]], lineMatrix); textMatrix = lineMatrix; continue; }
    if (operator === 'Tm' && args.length === 6) { lineMatrix = args.slice(); textMatrix = lineMatrix; continue; }
    if (operator === 'T*' && lineMatrix) { lineMatrix = multiplyMatrix([1, 0, 0, 1, 0, -state.leading], lineMatrix); textMatrix = lineMatrix; continue; }
    if (!['Tj', 'TJ', "'", '"'].includes(operator) || !textMatrix) continue;

    // Clipping modes (4-7) add to the clip path instead of painting; outside
    // this increment's scope. Mode 3 (invisible) and 7 (clip-only) paint
    // nothing today either way, so leaving them untouched changes nothing.
    if (state.renderMode !== 0 && state.renderMode !== 2) continue;

    const fontInfo = getFont(state.fontName);
    if (!fontInfo || !fontNames.has(fontInfo.baseFontName)) continue; // never convert a font the operator didn't select
    if (!fontInfo.loaded) { unconverted.add(fontInfo.baseFontName); continue; }
    const { font, kind, differences, cidToGid } = fontInfo.loaded;

    const raw = text.slice(start, end);
    const items = parseShowTextOperands(raw);
    let charSpace = state.charSpace, wordSpace = state.wordSpace;
    if (operator === '"') { const numbers = items.filter(item => item.type === 'number'); [wordSpace, charSpace] = [numbers[0]?.value ?? wordSpace, numbers[1]?.value ?? charSpace]; }

    // Resolve every glyph before committing to a rewrite - a single
    // unresolved character means the whole call is refused, not partially
    // guessed.
    const runs = [];
    let resolvable = true;
    for (const item of items) {
      if (item.type === 'number') { runs.push({ kind: 'adjust', value: item.value }); continue; }
      if (kind === 'cid') {
        if (item.bytes.length % 2 !== 0) { resolvable = false; break; }
        for (let i = 0; i < item.bytes.length; i += 2) {
          const cid = (item.bytes[i] << 8) | item.bytes[i + 1]; // Identity-H: code === CID
          const gid = cidToGid ? cidToGid(cid) : cid;
          const glyph = gid < font.glyphs.length ? font.glyphs.get(gid) : null;
          if (!glyph) { resolvable = false; break; }
          runs.push({ kind: 'glyph', glyph, isSpace: false }); // word spacing never applies to multi-byte CID codes
        }
      } else {
        for (const code of item.bytes) {
          const glyph = resolveSimpleGlyph(font, code, differences);
          if (!glyph) { resolvable = false; break; }
          runs.push({ kind: 'glyph', glyph, isSpace: code === 32 });
        }
      }
      if (!resolvable) break;
    }
    if (!resolvable) { unconverted.add(fontInfo.baseFontName); continue; }

    const unitsPerEm = font.unitsPerEm;
    const pieces = [];
    let localTm = textMatrix;
    for (const run of runs) {
      if (run.kind === 'adjust') {
        const tx = (-run.value / 1000) * state.fontSize * state.hScale;
        localTm = multiplyMatrix([1, 0, 0, 1, tx, 0], localTm);
        continue;
      }
      const renderMatrix = [state.fontSize * state.hScale, 0, 0, state.fontSize, 0, state.rise];
      const transform = multiplyMatrix(multiplyMatrix(renderMatrix, localTm), state.ctm);
      const path = run.glyph.getPath(0, 0, 1);
      if (path.commands.length) pieces.push(glyphPathOperators(path, transform));
      const w0 = run.glyph.advanceWidth / unitsPerEm;
      const tx = (w0 * state.fontSize + charSpace + (run.isSpace ? wordSpace : 0)) * state.hScale;
      localTm = multiplyMatrix([1, 0, 0, 1, tx, 0], localTm);
    }
    textMatrix = localTm; // Tj/TJ advance Tm; Tlm (lineMatrix) is untouched per spec

    const paintOp = state.renderMode === 2 ? 'B' : 'f';
    replacements.push({ start, end, value: pieces.length ? `${pieces.join(' ')} ${paintOp}` : '' });
    converted.add(fontInfo.baseFontName);
  }

  let output = text;
  for (const { start, end, value } of replacements.slice().reverse()) output = output.slice(0, start) + value + output.slice(end);
  return { text: output, converted, unconverted, draws };
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
 * Outlines operator-selected fonts (by BaseFont name) across every page and
 * nested Form XObject. Returns which fonts were converted everywhere their
 * text appeared, and which were left alone anywhere - a non-embedded font,
 * a Type0/CID or Type3 font, vertical text, a clipping render mode, or any
 * character the embedded program couldn't resolve.
 */
export function outlineFontsInPdf(pdfDoc, fontNames) {
  const { context } = pdfDoc;
  const lookup = value => context.lookup(value);
  const fontCache = new Map();
  const converted = new Set(), unconverted = new Set();

  const processContentList = (streams, resources, ancestors, initialCtm) => {
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream) || ancestors.has(stream)) continue;
      let text;
      try { text = decodeStreamText(stream); } catch { continue; }

      const result = outlineTextInContent(text, resources, lookup, fontNames, fontCache, { ctm: initialCtm });
      result.converted.forEach(name => fontNames.has(name) && converted.add(name));
      result.unconverted.forEach(name => fontNames.has(name) && unconverted.add(name));
      if (result.text !== text) encodeStreamText(stream, context, result.text);

      const xObjects = resources instanceof PDFDict && lookup(resources.get(PDFName.of('XObject')));
      if (!(xObjects instanceof PDFDict)) continue;
      for (const draw of result.draws) {
        const object = lookup(xObjects.get(PDFName.of(draw.name)));
        if (!(object instanceof PDFRawStream) || object.dict.get(PDFName.of('Subtype')) !== PDFName.of('Form')) continue;
        const formResources = lookup(object.dict.get(PDFName.of('Resources'))) || resources;
        const formMatrix = lookup(object.dict.get(PDFName.of('Matrix')));
        const matrix = formMatrix instanceof PDFArray ? formMatrix.asArray().map(value => lookup(value).asNumber()) : [1, 0, 0, 1, 0, 0];
        processContentList([object], formResources, new Set(ancestors).add(stream), multiplyMatrix(matrix, draw.ctm));
      }
    }
  };

  for (const page of pdfDoc.getPages()) {
    const resources = page.node.Resources();
    if (!(resources instanceof PDFDict)) continue;
    const contents = lookup(page.node.get(PDFName.of('Contents')));
    const streams = contents instanceof PDFArray ? contents.asArray().map(lookup) : [contents];
    processContentList(streams, resources, new Set(), [1, 0, 0, 1, 0, 0]);
  }

  return { converted, unconverted };
}
