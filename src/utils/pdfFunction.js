import { PDFName, PDFRawStream, decodePDFRawStream } from 'pdf-lib';

// PDF Function evaluator (ISO 32000-1 §7.10), Types 0/2/3/4. pdf-lib has no
// Function classes at all; pdfjs-dist has a complete one but it lives only
// inside the worker bundle and is not reachable from the public pdf.mjs
// entry point. Needed to evaluate a Separation/DeviceN tint-transform
// function and get the file's own declared CMYK/Gray/RGB equivalent for a
// spot color, rather than approximating one.

function numbersOf(array) {
  return array ? array.asArray().map(n => n.asNumber()) : null;
}

function getDict(functionObj) {
  return functionObj instanceof PDFRawStream ? functionObj.dict : functionObj;
}

function clamp(value, lo, hi) {
  return lo <= hi ? Math.min(Math.max(value, lo), hi) : Math.min(Math.max(value, hi), lo);
}

function interpolate(x, xmin, xmax, ymin, ymax) {
  if (xmax === xmin) return ymin;
  return ymin + ((x - xmin) * (ymax - ymin)) / (xmax - xmin);
}

export function evaluatePdfFunction(functionObj, input, lookup) {
  const dict = getDict(functionObj);
  const type = dict.get(PDFName.of('FunctionType'))?.asNumber();
  const domain = numbersOf(dict.get(PDFName.of('Domain')));
  const clipped = domain ? input.map((value, i) => clamp(value, domain[2 * i], domain[2 * i + 1])) : input;

  if (type === 2) return evalExponential(dict, clipped[0]);
  if (type === 3) return evalStitching(dict, clipped[0], domain, lookup);
  if (type === 0) return evalSampled(functionObj, dict, clipped, domain);
  if (type === 4) return evalPostScript(functionObj, dict, clipped);
  throw new Error(`Unsupported PDF function type: ${type}`);
}

function evalExponential(dict, x) {
  const C0 = numbersOf(dict.get(PDFName.of('C0'))) || [0];
  const C1 = numbersOf(dict.get(PDFName.of('C1'))) || [1];
  const N = dict.get(PDFName.of('N')).asNumber();
  const xn = N === 1 ? x : Math.pow(x, N);
  return C0.map((c0, i) => c0 + xn * ((C1[i] ?? 1) - c0));
}

function evalStitching(dict, x, domain, lookup) {
  const functions = dict.get(PDFName.of('Functions'));
  const bounds = numbersOf(dict.get(PDFName.of('Bounds'))) || [];
  const encode = numbersOf(dict.get(PDFName.of('Encode')));
  let index = 0;
  while (index < bounds.length && x >= bounds[index]) index += 1;
  const low = index === 0 ? domain[0] : bounds[index - 1];
  const high = index === bounds.length ? domain[1] : bounds[index];
  const encodedX = interpolate(x, low, high, encode[2 * index], encode[2 * index + 1]);
  const subFunction = lookup(functions.get(index));
  return evaluatePdfFunction(subFunction, [encodedX], lookup);
}

function readBits(data, bitOffset, numBits) {
  let value = 0;
  for (let i = 0; i < numBits; i++) {
    const bitIndex = bitOffset + i;
    const byte = data[bitIndex >> 3] ?? 0;
    const bit = (byte >> (7 - (bitIndex & 7))) & 1;
    value = value * 2 + bit;
  }
  return value;
}

function evalSampled(functionObj, dict, input, domain) {
  if (!(functionObj instanceof PDFRawStream)) throw new Error('Type 0 PDF function must be a stream.');
  const size = numbersOf(dict.get(PDFName.of('Size'))).map(Math.round);
  const bitsPerSample = dict.get(PDFName.of('BitsPerSample')).asNumber();
  const range = numbersOf(dict.get(PDFName.of('Range')));
  const numOutputs = range.length / 2;
  const encode = numbersOf(dict.get(PDFName.of('Encode'))) || size.flatMap(s => [0, s - 1]);
  const decode = numbersOf(dict.get(PDFName.of('Decode'))) || range;
  const data = decodePDFRawStream(functionObj).decode();
  const maxSampleValue = Math.pow(2, bitsPerSample) - 1;

  const m = size.length;
  const e = input.map((x, i) => clamp(interpolate(x, domain[2 * i], domain[2 * i + 1], encode[2 * i], encode[2 * i + 1]), 0, size[i] - 1));
  const floors = e.map(Math.floor);
  const fracs = e.map((v, i) => v - floors[i]);

  const readSample = (flatIndex, outputIndex) => readBits(data, (flatIndex * numOutputs + outputIndex) * bitsPerSample, bitsPerSample);

  const outputs = new Array(numOutputs).fill(0);
  const corners = 1 << m;
  for (let c = 0; c < corners; c++) {
    let weight = 1;
    let flatIndex = 0;
    let stride = 1;
    for (let dim = 0; dim < m; dim++) {
      const bit = (c >> dim) & 1;
      const idx = Math.min(floors[dim] + bit, size[dim] - 1);
      weight *= bit ? fracs[dim] : 1 - fracs[dim];
      flatIndex += idx * stride;
      stride *= size[dim];
    }
    if (weight === 0) continue;
    for (let o = 0; o < numOutputs; o++) outputs[o] += weight * readSample(flatIndex, o);
  }

  return outputs.map((raw, o) => clamp(interpolate(raw, 0, maxSampleValue, decode[2 * o], decode[2 * o + 1]), range[2 * o], range[2 * o + 1]));
}

// Type 4: a small stack-based calculator language (ISO 32000-1 §7.10.5), not
// general PostScript - only the operator set the spec defines for this
// function type.
function tokenizePostScript(source) {
  return source.match(/\{|\}|[^\s{}]+/g) || [];
}

function parsePostScript(source) {
  const tokens = tokenizePostScript(source);
  let pos = tokens[0] === '{' ? 1 : 0;
  const parseBlock = () => {
    const body = [];
    while (pos < tokens.length) {
      const token = tokens[pos++];
      if (token === '{') { body.push(parseBlock()); continue; }
      if (token === '}') return body;
      const number = Number(token);
      body.push(Number.isNaN(number) ? token : number);
    }
    return body;
  };
  return parseBlock();
}

function execProgram(program, stack) {
  for (const item of program) {
    if (typeof item === 'number' || Array.isArray(item)) { stack.push(item); continue; }
    execOperator(item, stack);
  }
}

const BINARY_OPS = {
  add: (a, b) => a + b, sub: (a, b) => a - b, mul: (a, b) => a * b, div: (a, b) => a / b,
  idiv: (a, b) => Math.trunc(a / b), mod: (a, b) => a % b,
  eq: (a, b) => a === b, ne: (a, b) => a !== b, gt: (a, b) => a > b, ge: (a, b) => a >= b, lt: (a, b) => a < b, le: (a, b) => a <= b,
  and: (a, b) => typeof a === 'boolean' ? a && b : a & b,
  or: (a, b) => typeof a === 'boolean' ? a || b : a | b,
  xor: (a, b) => typeof a === 'boolean' ? a !== b : a ^ b,
  bitshift: (a, shift) => shift >= 0 ? a << shift : a >> -shift
};

const UNARY_OPS = {
  neg: a => -a, abs: Math.abs, ceiling: Math.ceil, floor: Math.floor, round: Math.round,
  truncate: a => Math.trunc(a), sqrt: Math.sqrt,
  sin: a => Math.sin((a * Math.PI) / 180), cos: a => Math.cos((a * Math.PI) / 180),
  ln: Math.log, log: Math.log10, cvi: a => Math.trunc(a), cvr: a => a,
  not: a => typeof a === 'boolean' ? !a : ~a
};

function execOperator(op, stack) {
  if (op === 'true') { stack.push(true); return; }
  if (op === 'false') { stack.push(false); return; }
  if (op === 'pop') { stack.pop(); return; }
  if (op === 'exch') { const b = stack.pop(), a = stack.pop(); stack.push(b, a); return; }
  if (op === 'dup') { stack.push(stack[stack.length - 1]); return; }
  if (op === 'copy') { const n = stack.pop(); if (n > 0) stack.push(...stack.slice(stack.length - n)); return; }
  if (op === 'index') { const n = stack.pop(); stack.push(stack[stack.length - 1 - n]); return; }
  if (op === 'roll') {
    const j = stack.pop(), n = stack.pop();
    if (n > 0) {
      const slice = stack.splice(stack.length - n, n);
      const shift = ((j % n) + n) % n;
      stack.push(...slice.slice(n - shift).concat(slice.slice(0, n - shift)));
    }
    return;
  }
  if (op === 'atan') { const den = stack.pop(), num = stack.pop(); let deg = (Math.atan2(num, den) * 180) / Math.PI; if (deg < 0) deg += 360; stack.push(deg); return; }
  if (op === 'exp') { const exponent = stack.pop(), base = stack.pop(); stack.push(Math.pow(base, exponent)); return; }
  if (op === 'if') { const proc = stack.pop(), cond = stack.pop(); if (cond) execProgram(proc, stack); return; }
  if (op === 'ifelse') { const proc2 = stack.pop(), proc1 = stack.pop(), cond = stack.pop(); execProgram(cond ? proc1 : proc2, stack); return; }
  if (op in UNARY_OPS) { stack.push(UNARY_OPS[op](stack.pop())); return; }
  if (op in BINARY_OPS) { const b = stack.pop(), a = stack.pop(); stack.push(BINARY_OPS[op](a, b)); return; }
  throw new Error(`Unsupported PostScript calculator operator: ${op}`);
}

function evalPostScript(functionObj, dict, input) {
  if (!(functionObj instanceof PDFRawStream)) throw new Error('Type 4 PDF function must be a stream.');
  const range = numbersOf(dict.get(PDFName.of('Range')));
  const numOutputs = range.length / 2;
  const source = new TextDecoder('latin1').decode(decodePDFRawStream(functionObj).decode());
  const stack = [...input];
  execProgram(parsePostScript(source), stack);
  const results = stack.slice(stack.length - numOutputs);
  return results.map((value, i) => clamp(value, range[2 * i], range[2 * i + 1]));
}
