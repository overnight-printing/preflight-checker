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

// Standard WinAnsiEncoding glyph names, needed as a fallback name source
// (see resolveSimpleGlyph) for fonts with no useful cmap of their own - a
// bare-CFF program wrapped by wrapBareCffAsOpenType below has no real cmap
// at all, so without this, only a /Differences-named code could ever resolve.
const ASCII_GLYPH_NAMES = {
  32: 'space', 33: 'exclam', 34: 'quotedbl', 35: 'numbersign', 36: 'dollar', 37: 'percent', 38: 'ampersand', 39: 'quotesingle',
  40: 'parenleft', 41: 'parenright', 42: 'asterisk', 43: 'plus', 44: 'comma', 45: 'hyphen', 46: 'period', 47: 'slash',
  48: 'zero', 49: 'one', 50: 'two', 51: 'three', 52: 'four', 53: 'five', 54: 'six', 55: 'seven', 56: 'eight', 57: 'nine',
  58: 'colon', 59: 'semicolon', 60: 'less', 61: 'equal', 62: 'greater', 63: 'question', 64: 'at',
  91: 'bracketleft', 92: 'backslash', 93: 'bracketright', 94: 'asciicircum', 95: 'underscore', 96: 'grave',
  123: 'braceleft', 124: 'bar', 125: 'braceright', 126: 'asciitilde'
};
for (let c = 65; c <= 90; c++) ASCII_GLYPH_NAMES[c] = String.fromCharCode(c);
for (let c = 97; c <= 122; c++) ASCII_GLYPH_NAMES[c] = String.fromCharCode(c);

const WIN_ANSI_HIGH_NAMES = {
  128: 'Euro', 130: 'quotesinglbase', 131: 'florin', 132: 'quotedblbase', 133: 'ellipsis', 134: 'dagger', 135: 'daggerdbl',
  136: 'circumflex', 137: 'perthousand', 138: 'Scaron', 139: 'guilsinglleft', 140: 'OE', 142: 'Zcaron', 145: 'quoteleft',
  146: 'quoteright', 147: 'quotedblleft', 148: 'quotedblright', 149: 'bullet', 150: 'endash', 151: 'emdash', 152: 'tilde',
  153: 'trademark', 154: 'scaron', 155: 'guilsinglright', 156: 'oe', 158: 'zcaron', 159: 'Ydieresis'
};

const LATIN1_GLYPH_NAMES = {
  160: 'space', 161: 'exclamdown', 162: 'cent', 163: 'sterling', 164: 'currency', 165: 'yen', 166: 'brokenbar',
  167: 'section', 168: 'dieresis', 169: 'copyright', 170: 'ordfeminine', 171: 'guillemotleft', 172: 'logicalnot',
  173: 'hyphen', 174: 'registered', 175: 'macron', 176: 'degree', 177: 'plusminus', 178: 'twosuperior', 179: 'threesuperior',
  180: 'acute', 181: 'mu', 182: 'paragraph', 183: 'periodcentered', 184: 'cedilla', 185: 'onesuperior', 186: 'ordmasculine',
  187: 'guillemotright', 188: 'onequarter', 189: 'onehalf', 190: 'threequarters', 191: 'questiondown', 192: 'Agrave',
  193: 'Aacute', 194: 'Acircumflex', 195: 'Atilde', 196: 'Adieresis', 197: 'Aring', 198: 'AE', 199: 'Ccedilla',
  200: 'Egrave', 201: 'Eacute', 202: 'Ecircumflex', 203: 'Edieresis', 204: 'Igrave', 205: 'Iacute', 206: 'Icircumflex',
  207: 'Idieresis', 208: 'Eth', 209: 'Ntilde', 210: 'Ograve', 211: 'Oacute', 212: 'Ocircumflex', 213: 'Otilde',
  214: 'Odieresis', 215: 'multiply', 216: 'Oslash', 217: 'Ugrave', 218: 'Uacute', 219: 'Ucircumflex', 220: 'Udieresis',
  221: 'Yacute', 222: 'Thorn', 223: 'germandbls', 224: 'agrave', 225: 'aacute', 226: 'acircumflex', 227: 'atilde',
  228: 'adieresis', 229: 'aring', 230: 'ae', 231: 'ccedilla', 232: 'egrave', 233: 'eacute', 234: 'ecircumflex',
  235: 'edieresis', 236: 'igrave', 237: 'iacute', 238: 'icircumflex', 239: 'idieresis', 240: 'eth', 241: 'ntilde',
  242: 'ograve', 243: 'oacute', 244: 'ocircumflex', 245: 'otilde', 246: 'odieresis', 247: 'divide', 248: 'oslash',
  249: 'ugrave', 250: 'uacute', 251: 'ucircumflex', 252: 'udieresis', 253: 'yacute', 254: 'thorn', 255: 'ydieresis'
};

function winAnsiGlyphName(code) {
  return ASCII_GLYPH_NAMES[code] || WIN_ANSI_HIGH_NAMES[code] || LATIN1_GLYPH_NAMES[code] || null;
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
  // Try by name first (an explicit /Differences name, falling back to the
  // base WinAnsiEncoding name for this code) - the only path that works at
  // all for a bare-CFF-wrapped font, which has no real cmap to speak of.
  const name = differences?.get(code) || winAnsiGlyphName(code);
  if (name) {
    // opentype.js's native GlyphNames.nameToGlyphIndex (used for a normal
    // TrueType 'post' table) returns -1 when not found, Array.indexOf-style
    // - truthy, unlike the 0-for-not-found convention charToGlyphIndex and
    // our own attachCffGlyphNameLookup override use. Must exclude it.
    const byName = font.nameToGlyphIndex(name);
    if (byName > 0) return font.glyphs.get(byName);
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

// opentype.parse() only accepts a complete sfnt container (it sniffs the
// first 4 bytes for 'true'/0x00010000/'OTTO'/'wOFF'), but a bare CFF program
// (FontFile3 /Type1C, the overwhelmingly common case for Adobe-tool-exported
// print PDFs - confirmed directly against a real customer file where every
// embedded font used it) is just the raw CFF table bytes with no wrapper at
// all. Wraps it in the minimum sfnt opentype.js will actually parse without
// crashing, verified empirically against opentype.js's parseBuffer: it reads
// 'name' and 'cmap' unconditionally regardless of outline format (crashes on
// undefined otherwise) and sizes hmtx off maxp.numGlyphs (crashes if that
// doesn't match font.glyphs' real length, which CFF parsing sets
// independently from the real charstrings count) - so maxp/hhea/hmtx here
// deliberately claim exactly 1 glyph, both empty and harmless since glyph
// outlines, counts and metrics all come from the real CFF table regardless;
// PDF's own /Widths array is used for advance width, not hmtx.
function wrapBareCffAsOpenType(cffBytes) {
  const pad4 = bytes => {
    const rem = bytes.length % 4;
    return rem ? new Uint8Array([...bytes, ...new Uint8Array(4 - rem)]) : bytes;
  };
  const head = new DataView(new ArrayBuffer(54));
  head.setUint32(0, 0x00010000); head.setUint32(4, 0x00010000);
  head.setUint32(12, 0x5F0F3CF5); head.setUint16(18, 1000);
  head.setInt16(40, 1000); head.setInt16(42, 1000); head.setInt16(48, 2);

  const hhea = new DataView(new ArrayBuffer(36));
  hhea.setUint32(0, 0x00010000); hhea.setInt16(4, 1000); hhea.setInt16(6, -200);
  hhea.setUint16(10, 1000); hhea.setInt16(16, 1000); hhea.setInt16(18, 1); hhea.setUint16(34, 1);

  const maxp = new DataView(new ArrayBuffer(6));
  maxp.setUint32(0, 0x00005000); maxp.setUint16(4, 1); // CFF-flavored maxp (0.5), numGlyphs=1 (see note above)

  const hmtx = new DataView(new ArrayBuffer(4));
  hmtx.setUint16(0, 500);

  const name = new DataView(new ArrayBuffer(6));
  name.setUint16(4, 6); // empty name table: version 0, count 0, stringOffset 6

  const cmap = new DataView(new ArrayBuffer(4 + 8 + 6 + 256));
  cmap.setUint16(2, 1); cmap.setUint16(4, 1); cmap.setUint32(8, 12); // 1 subtable: platform 1 (Mac), encoding 0
  cmap.setUint16(12, 0); cmap.setUint16(14, 6 + 256); // format 0, length (remaining 256-byte glyphIdArray left zeroed)

  const tables = [
    ['CFF ', cffBytes], ['cmap', new Uint8Array(cmap.buffer)], ['head', new Uint8Array(head.buffer)],
    ['hhea', new Uint8Array(hhea.buffer)], ['hmtx', new Uint8Array(hmtx.buffer)],
    ['maxp', new Uint8Array(maxp.buffer)], ['name', new Uint8Array(name.buffer)]
  ].map(([tag, bytes]) => [tag, pad4(bytes)]).sort(([a], [b]) => a < b ? -1 : 1);

  const numTables = tables.length;
  const entrySelector = Math.floor(Math.log2(numTables));
  const searchRange = Math.pow(2, entrySelector) * 16;
  const headerSize = 12 + numTables * 16;
  let offset = headerSize;
  const dirEntries = [];
  let totalLength = headerSize;
  for (const [, bytes] of tables) { dirEntries.push(offset); offset += bytes.length; totalLength += bytes.length; }

  const out = new Uint8Array(totalLength);
  const outView = new DataView(out.buffer);
  out.set([0x4F, 0x54, 0x54, 0x4F], 0); // 'OTTO'
  outView.setUint16(4, numTables); outView.setUint16(6, searchRange);
  outView.setUint16(8, entrySelector); outView.setUint16(10, numTables * 16 - searchRange);
  tables.forEach(([tag, bytes], i) => {
    const entryOffset = 12 + i * 16;
    for (let c = 0; c < 4; c++) out[entryOffset + c] = tag.charCodeAt(c);
    outView.setUint32(entryOffset + 8, dirEntries[i]);
    outView.setUint32(entryOffset + 12, bytes.length);
    out.set(bytes, dirEntries[i]);
  });
  return out;
}

// Builds a name->glyph-index lookup directly from each glyph's own `.name`
// (populated from the CFF charset during parsing, independent of any 'post'
// table) and overrides Font.nameToGlyphIndex with it - the wrapper above
// provides no 'post' table, so the real implementation
// (`this.glyphNames.nameToGlyphIndex`) would otherwise always fail.
function attachCffGlyphNameLookup(font) {
  const nameToIndex = new Map();
  for (let i = 0; i < font.glyphs.length; i++) {
    const name = font.glyphs.get(i).name;
    if (name && !nameToIndex.has(name)) nameToIndex.set(name, i);
  }
  font.nameToGlyphIndex = name => nameToIndex.get(name) || 0;
}

// Returns { bytes, isBareCff } for the embedded font program opentype.js can
// read: FontFile2 (bare TrueType/glyf) or FontFile3 /OpenType directly; a
// bare CFF program (FontFile3 /Type1C) via wrapBareCffAsOpenType. A
// CID-keyed bare CFF (/CIDFontType0C) is not handled here - its CID-to-GID
// mapping lives in the CFF charset itself, a different mechanism than the
// by-name lookup this wrapper enables - and stays refused.
function getEmbeddedFontBytes(descriptor, lookup) {
  if (!(descriptor instanceof PDFDict)) return null;
  const fontFile2 = lookup(descriptor.get(PDFName.of('FontFile2')));
  if (fontFile2 instanceof PDFRawStream) return { bytes: decodePDFRawStream(fontFile2).decode(), isBareCff: false };
  const fontFile3 = lookup(descriptor.get(PDFName.of('FontFile3')));
  if (fontFile3 instanceof PDFRawStream) {
    const subtype = fontFile3.dict.get(PDFName.of('Subtype'))?.toString();
    if (subtype === '/OpenType') return { bytes: decodePDFRawStream(fontFile3).decode(), isBareCff: false };
    if (subtype === '/Type1C') return { bytes: decodePDFRawStream(fontFile3).decode(), isBareCff: true };
  }
  return null;
}

function parseEmbeddedFont(descriptor, lookup) {
  const embedded = getEmbeddedFontBytes(descriptor, lookup);
  if (!embedded) return null;
  const sfntBytes = embedded.isBareCff ? wrapBareCffAsOpenType(embedded.bytes) : embedded.bytes;
  let font;
  try { font = opentype.parse(sfntBytes.buffer.slice(sfntBytes.byteOffset, sfntBytes.byteOffset + sfntBytes.byteLength)); }
  catch { return null; }
  if (embedded.isBareCff) attachCffGlyphNameLookup(font);
  return font;
}

// Parses a simple (non-CID) font resource's embedded program and its
// /Differences map. Returns null (refuse) when nothing opentype.js can parse
// directly is embedded (non-embedded, or a bare CFF/Type1 program).
function loadSimpleFont(fontDict, lookup) {
  const descriptor = lookup(fontDict.get(PDFName.of('FontDescriptor')));
  const font = parseEmbeddedFont(descriptor, lookup);
  if (!font) return null;

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
  const font = parseEmbeddedFont(descriptor, lookup);
  if (!font) return null;

  const cidToGidMap = lookup(descendant.get(PDFName.of('CIDToGIDMap')));
  let cidToGid = null; // null = Identity (CID === GID), the common case
  if (cidToGidMap instanceof PDFRawStream) {
    const bytes = decodePDFRawStream(cidToGidMap).decode();
    cidToGid = cid => (cid * 2 + 1 < bytes.length ? (bytes[cid * 2] << 8) | bytes[cid * 2 + 1] : 0);
  }
  return { kind: 'cid', font, cidToGid };
}

// Operators a CharProc could use that need a resource-dict lookup to mean
// anything (a named colorspace, pattern, XObject, shading, or ExtGState).
// Inlining a CharProc pastes its body into the page's own content stream, so
// those names would resolve against the PAGE's resources, not the Type3
// font's - silently wrong unless the two happen to share definitions. Rather
// than merge resource dicts (real complexity, real risk of key collisions),
// a CharProc using any of these is refused outright.
const TYPE3_UNSAFE_OPERATORS = new Set(['Do', 'sh', 'gs', 'cs', 'CS']);

// Parses a Type3 font resource: FontMatrix, the required code->glyph-name
// Differences (Type3 has no built-in encoding to fall back on), per-code
// widths, and each CharProc's own content - verified free of resource-dict
// references (see TYPE3_UNSAFE_OPERATORS) and with its leading d0/d1 glyph
// metrics operator stripped, since that isn't a real content-stream operator
// once inlined into the page's own stream.
function loadType3Font(fontDict, lookup) {
  const fontMatrixArray = lookup(fontDict.get(PDFName.of('FontMatrix')));
  const fontMatrix = fontMatrixArray instanceof PDFArray ? fontMatrixArray.asArray().map(v => v.asNumber()) : null;
  if (!fontMatrix || fontMatrix.length !== 6) return null;

  const encoding = lookup(fontDict.get(PDFName.of('Encoding')));
  const diffArray = encoding instanceof PDFDict && lookup(encoding.get(PDFName.of('Differences')));
  if (!(diffArray instanceof PDFArray)) return null; // no way to map codes to glyph names at all

  const differences = new Map();
  let code = 0;
  for (const item of diffArray.asArray()) {
    const value = lookup(item);
    if (value instanceof PDFNumber) code = value.asNumber();
    else { differences.set(code, value.toString().replace(/^\//, '')); code += 1; }
  }

  const charProcs = lookup(fontDict.get(PDFName.of('CharProcs')));
  if (!(charProcs instanceof PDFDict)) return null;
  const firstChar = lookup(fontDict.get(PDFName.of('FirstChar')))?.asNumber() ?? 0;
  const widthsArray = lookup(fontDict.get(PDFName.of('Widths')));
  const widths = widthsArray instanceof PDFArray ? widthsArray.asArray().map(v => lookup(v)?.asNumber() ?? 0) : [];
  const resources = lookup(fontDict.get(PDFName.of('Resources')));

  return { kind: 'type3', fontMatrix, differences, charProcs, firstChar, widths, resources, glyphCache: new Map() };
}

// Resolves and validates one Type3 glyph (by code), caching the result.
// Returns null (refuse) if the code has no /Differences name, the name has
// no CharProc, or the CharProc uses a resource-dependent operator.
function resolveType3Glyph(type3, code, lookup) {
  if (type3.glyphCache.has(code)) return type3.glyphCache.get(code);
  const result = (() => {
    const name = type3.differences.get(code);
    if (!name) return null;
    const stream = lookup(type3.charProcs.get(PDFName.of(name)));
    if (!(stream instanceof PDFRawStream)) return null;
    let text;
    try { text = new TextDecoder('latin1').decode(decodePDFRawStream(stream).decode()); }
    catch { return null; }

    let bodyStart = 0;
    for (const op of contentOperators(text)) {
      if (op.operator === 'd0' || op.operator === 'd1') { bodyStart = op.end; break; }
      break; // first operator must be d0/d1 per spec; anything else means a malformed CharProc
    }
    for (const op of contentOperators(text.slice(bodyStart))) {
      if (TYPE3_UNSAFE_OPERATORS.has(op.operator)) return null;
    }

    const width = type3.widths[code - type3.firstChar] ?? 0;
    return { body: text.slice(bodyStart).trim(), width };
  })();
  type3.glyphCache.set(code, result);
  return result;
}

function loadFont(fontDict, lookup) {
  const subtype = fontDict.get(PDFName.of('Subtype'))?.toString();
  if (subtype === '/Type0') return loadCidFont(fontDict, lookup);
  if (subtype === '/Type3') return loadType3Font(fontDict, lookup);
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
    const { font, kind, differences, cidToGid, fontMatrix } = fontInfo.loaded;

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
      } else if (kind === 'type3') {
        for (const code of item.bytes) {
          const glyph = resolveType3Glyph(fontInfo.loaded, code, lookup);
          if (!glyph) { resolvable = false; break; }
          runs.push({ kind: 'type3glyph', glyph, isSpace: code === 32 });
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

    const unitsPerEm = kind === 'type3' ? null : font.unitsPerEm;
    const pieces = [];
    let localTm = textMatrix;
    for (const run of runs) {
      if (run.kind === 'adjust') {
        const tx = (-run.value / 1000) * state.fontSize * state.hScale;
        localTm = multiplyMatrix([1, 0, 0, 1, tx, 0], localTm);
        continue;
      }
      const renderMatrix = [state.fontSize * state.hScale, 0, 0, state.fontSize, 0, state.rise];
      if (run.kind === 'type3glyph') {
        // A CharProc paints itself (its own f/S/etc at the end) - inline it
        // wrapped in its own q/cm/Q rather than collecting bare path data,
        // unlike the shared-fill TrueType/CID case below.
        const [a, b, c, d, e, f] = multiplyMatrix(multiplyMatrix(fontMatrix, renderMatrix), multiplyMatrix(localTm, state.ctm));
        if (run.glyph.body) pieces.push(`q ${[a, b, c, d, e, f].map(formatNumber).join(' ')} cm ${run.glyph.body} Q`);
        const w0 = fontMatrix[0] * run.glyph.width;
        const tx = (w0 * state.fontSize + charSpace + (run.isSpace ? wordSpace : 0)) * state.hScale;
        localTm = multiplyMatrix([1, 0, 0, 1, tx, 0], localTm);
        continue;
      }
      const transform = multiplyMatrix(multiplyMatrix(renderMatrix, localTm), state.ctm);
      const path = run.glyph.getPath(0, 0, 1);
      if (path.commands.length) pieces.push(glyphPathOperators(path, transform));
      const w0 = run.glyph.advanceWidth / unitsPerEm;
      const tx = (w0 * state.fontSize + charSpace + (run.isSpace ? wordSpace : 0)) * state.hScale;
      localTm = multiplyMatrix([1, 0, 0, 1, tx, 0], localTm);
    }
    textMatrix = localTm; // Tj/TJ advance Tm; Tlm (lineMatrix) is untouched per spec

    const paintOp = state.renderMode === 2 ? 'B' : 'f';
    const value = kind === 'type3' ? pieces.join(' ') : (pieces.length ? `${pieces.join(' ')} ${paintOp}` : '');
    replacements.push({ start, end, value });
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
  const visitedResourceDicts = new Set();

  const processContentList = (streams, resources, ancestors, initialCtm) => {
    for (const stream of streams) {
      if (!(stream instanceof PDFRawStream) || ancestors.has(stream)) continue;
      let text;
      try { text = decodeStreamText(stream); } catch { continue; }

      const result = outlineTextInContent(text, resources, lookup, fontNames, fontCache, { ctm: initialCtm });
      result.converted.forEach(name => fontNames.has(name) && converted.add(name));
      result.unconverted.forEach(name => fontNames.has(name) && unconverted.add(name));
      if (result.text !== text) encodeStreamText(stream, context, result.text);
      visitedResourceDicts.add(resources);

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

  // Without this, a fully-outlined font's resource entry stays in every
  // Resources dict that declared it - unused by any remaining Tf, but still
  // "present" as far as the fontEmbedding preflight check can tell, since it
  // scans resource dictionaries rather than actual Tf usage. That made the
  // Create Outlines button reappear forever even after a real, complete
  // conversion. Safe to delete now: every text run using this font anywhere
  // in the document was either converted or this font would be in
  // `unconverted`, in which case it's excluded here and its entry survives.
  const removable = [...converted].filter(name => !unconverted.has(name));
  if (removable.length) {
    for (const resources of visitedResourceDicts) {
      const fonts = resources instanceof PDFDict && lookup(resources.get(PDFName.of('Font')));
      if (!(fonts instanceof PDFDict)) continue;
      for (const key of fonts.keys()) {
        const fontDict = lookup(fonts.get(key));
        if (!(fontDict instanceof PDFDict)) continue;
        const baseFontName = lookup(fontDict.get(PDFName.of('BaseFont')))?.toString().replace(/^\//, '').replace(/^[A-Z]{6}\+/, '');
        if (removable.includes(baseFontName)) fonts.delete(key);
      }
    }
  }

  return { converted, unconverted };
}
