export function parseCustomPageSelection(input, totalPages) {
  const value = input.trim();
  if (!value) {
    return { pages: [], error: 'Enter pages like 2, 4, 7-10.' };
  }

  const selectedPages = new Set();
  const tokens = value.split(',').map((token) => token.trim());

  for (const token of tokens) {
    if (!token) {
      return { pages: [], error: 'Remove the extra comma.' };
    }

    const singlePageMatch = token.match(/^\d+$/);
    const rangeMatch = token.match(/^(\d+)\s*-\s*(\d+)$/);

    if (singlePageMatch) {
      const page = Number(token);
      if (page < 1 || page > totalPages) {
        return { pages: [], error: `Page ${page} is outside 1-${totalPages}.` };
      }
      selectedPages.add(page);
      continue;
    }

    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      if (start > end) {
        return { pages: [], error: `Range ${token} must go from low to high.` };
      }
      if (start < 1 || end > totalPages) {
        return { pages: [], error: `Range ${token} is outside 1-${totalPages}.` };
      }
      for (let page = start; page <= end; page += 1) {
        selectedPages.add(page);
      }
      continue;
    }

    return { pages: [], error: `“${token}” is not a valid page or range.` };
  }

  return {
    pages: [...selectedPages].sort((a, b) => a - b),
    error: ''
  };
}

export function resolveTargetPages(options, totalPages, currentPage) {
  switch (options.applyTo) {
    case 'current':
      return { pages: [currentPage], error: '' };
    case 'all':
      return { pages: Array.from({ length: totalPages }, (_, index) => index + 1), error: '' };
    case 'first':
      return { pages: [1], error: '' };
    case 'last':
      return { pages: [totalPages], error: '' };
    case 'even':
      return {
        pages: Array.from({ length: totalPages }, (_, index) => index + 1)
          .filter((page) => page % 2 === 0),
        error: ''
      };
    case 'odd':
      return {
        pages: Array.from({ length: totalPages }, (_, index) => index + 1)
          .filter((page) => page % 2 === 1),
        error: ''
      };
    case 'custom':
      return parseCustomPageSelection(options.customPages || '', totalPages);
    default:
      return { pages: [], error: `Unknown page selection: ${options.applyTo}` };
  }
}
