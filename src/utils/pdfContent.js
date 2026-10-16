import { PDFArray, PDFDict, PDFName, PDFNumber, PDFBool } from 'pdf-lib';

// PDF operands are not whitespace-separated words: strings, comments and image
// bytes can contain arbitrary operator-looking text. Preserve spans for tinting.
export function* contentOperators(text) {
  const whitespace = /[\0\t\n\f\r ]/;
  const delimiter = /[\0\t\n\f\r ()<>[\]{}/%]/;
  let i = 0, args = [], start = 0, depth = 0;
  while (i < text.length) {
    if (whitespace.test(text[i])) { i++; continue; }
    if (text[i] === '%') { while (i < text.length && !/[\r\n]/.test(text[i])) i++; continue; }
    if (!args.length) start = i;
    if (text[i] === '(') {
      let nesting = 1; i++;
      while (i < text.length && nesting) {
        const c = text[i++];
        if (c === '\\') i++;
        else if (c === '(') nesting++;
        else if (c === ')') nesting--;
      }
      if (!depth) args.push(null);
      continue;
    }
    if (text[i] === '<' && text[i + 1] !== '<') {
      i = text.indexOf('>', i + 1); i = i < 0 ? text.length : i + 1;
      if (!depth) args.push(null);
      continue;
    }
    if (text[i] === '[' || text.slice(i, i + 2) === '<<') {
      if (!depth) args.push(null);
      depth++; i += text[i] === '[' ? 1 : 2; continue;
    }
    if (text[i] === ']' || text.slice(i, i + 2) === '>>') { depth = Math.max(0, depth - 1); i += text[i] === ']' ? 1 : 2; continue; }
    const tokenStart = i++;
    while (i < text.length && !delimiter.test(text[i])) i++;
    const token = text.slice(tokenStart, i);
    if (depth) continue;
    if (token[0] === '/') { args.push(token.replace(/#([\da-f]{2})/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)))); continue; }
    if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(token)) { args.push(Number(token)); continue; }
    if (['true', 'false', 'null'].includes(token)) { args.push(null); continue; }
    if (token === 'BI') {
      // shortcut: EI is delimiter-based for inline images; PDF.js remains the
      // authority for painting and flags inline image resolution as unmeasured.
      const end = /[\0\t\n\f\r ]EI(?=[\0\t\n\f\r ])/g;
      end.lastIndex = i;
      const match = end.exec(text);
      i = match ? end.lastIndex : text.length;
    }
    yield { operator: token, args, start, end: i };
    args = [];
  }
}

export function multiplyLinearMatrices(parent, local) {
  return [parent[0] * local[0] + parent[2] * local[1], parent[1] * local[0] + parent[3] * local[1],
    parent[0] * local[2] + parent[2] * local[3], parent[1] * local[2] + parent[3] * local[3]];
}

export function scanContent(text, resources, lookup, initialState = {}) {
  const stack = [], draws = [];
  let state = { matrix: [1, 0, 0, 1], fill: false, stroke: false, op: false, OP: false, textMode: 0, ...initialState };
  let rgb = false, whiteOverprint = false, overprint = false, transparency = false;
  const paint = (fill, stroke) => {
    overprint ||= (fill && state.op) || (stroke && state.OP);
    whiteOverprint ||= (fill && state.fill && state.op) || (stroke && state.stroke && state.OP);
  };
  for (const { operator, args } of contentOperators(text)) {
    if (operator === 'q') stack.push({ ...state });
    else if (operator === 'Q') state = stack.pop() || state;
    else if (operator === 'cm' && args.length === 6 && args.every(Number.isFinite)) state.matrix = multiplyLinearMatrices(state.matrix, args);
    else if (['g', 'G', 'rg', 'RG', 'k', 'K'].includes(operator)) {
      const fill = operator === operator.toLowerCase();
      const space = { g: '/DeviceGray', rg: '/DeviceRGB', k: '/DeviceCMYK' }[operator.toLowerCase()];
      state[fill ? 'fillSpace' : 'strokeSpace'] = space;
      state[fill ? 'fill' : 'stroke'] = space === '/DeviceCMYK' ? args.length === 4 && args.every(n => n === 0)
        : args.length === (space === '/DeviceGray' ? 1 : 3) && args.every(n => n === 1);
      rgb ||= space === '/DeviceRGB';
    } else if (operator === 'cs' || operator === 'CS') {
      state[operator === 'cs' ? 'fillSpace' : 'strokeSpace'] = args[0];
      state[operator === 'cs' ? 'fill' : 'stroke'] = false;
      rgb ||= args[0] === '/DeviceRGB';
    } else if (['sc', 'SC', 'scn', 'SCN'].includes(operator)) {
      const fill = operator === operator.toLowerCase();
      const space = state[fill ? 'fillSpace' : 'strokeSpace'] || '/DeviceGray';
      state[fill ? 'fill' : 'stroke'] = space === '/DeviceCMYK' ? args.length === 4 && args.every(n => n === 0)
        : ['/DeviceGray', '/DeviceRGB'].includes(space) && args.length === (space === '/DeviceGray' ? 1 : 3) && args.every(n => n === 1);
    } else if (operator === 'gs') {
      const states = resources instanceof PDFDict && lookup(resources.get(PDFName.of('ExtGState')));
      const gs = states instanceof PDFDict && lookup(states.get(PDFName.of(args[0]?.slice(1) || '')));
      if (!(gs instanceof PDFDict)) continue;
      const get = key => lookup(gs.get(PDFName.of(key)));
      if (get('OP') instanceof PDFBool) { state.OP = get('OP') === PDFBool.True; if (!gs.has(PDFName.of('op'))) state.op = state.OP; }
      if (get('op') instanceof PDFBool) state.op = get('op') === PDFBool.True;
      const blend = get('BM');
      const blends = blend instanceof PDFArray ? blend.asArray().map(lookup) : [blend];
      transparency ||= ['ca', 'CA'].some(key => get(key) instanceof PDFNumber && get(key).asNumber() < 1) ||
        blends.some(value => value && !['/Normal', '/Compatible'].includes(value.toString())) ||
        Boolean(get('SMask') && get('SMask') !== PDFName.of('None'));
    } else if (operator === 'Do' && typeof args[0] === 'string') draws.push({ name: args[0].slice(1), state: { ...state } });
    else if (operator === 'Tr') state.textMode = args[0];
    else if (['f', 'F', 'f*'].includes(operator)) paint(true, false);
    else if (['S', 's'].includes(operator)) paint(false, true);
    else if (['B', 'B*', 'b', 'b*'].includes(operator)) paint(true, true);
    else if (['Tj', 'TJ', "'", '"'].includes(operator)) paint([0, 2, 4, 6].includes(state.textMode), [1, 2, 5, 6].includes(state.textMode));
  }
  return { draws, rgb, overprint, whiteOverprint, transparency };
}
