import { contentOperators } from './pdfContent.js';

export function tintStampContent(text, hex) {
  if (!/^#[\da-f]{6}$/i.test(hex || '')) return text;
  const [r, g, b] = [1, 3, 5].map(index => parseInt(hex.slice(index, index + 2), 16) / 255);
  // Unprofiled process approximation; exact press matching needs the shop ICC profile.
  const max = Math.max(r, g, b);
  const cmyk = [...[r, g, b].map(channel => max ? (max - channel) / max : 0), 1 - max].map(value => Number(value.toFixed(4))).join(' ');
  const replacements = [];
  for (const { operator, args, start, end } of contentOperators(text)) {
    const black = ['g', 'G'].includes(operator) ? args.length === 1 && args[0] === 0
      : ['rg', 'RG'].includes(operator) ? args.length === 3 && args.every(value => value === 0)
        : ['k', 'K'].includes(operator) && args.length === 4 && args.slice(0, 3).every(value => value === 0) && args[3] === 1;
    if (black) replacements.push({ start, end, value: `${cmyk} ${operator === operator.toLowerCase() ? 'k' : 'K'}` });
  }
  for (const { start, end, value } of replacements.reverse()) text = text.slice(0, start) + value + text.slice(end);
  return text;
}
