const HORIZONTAL_ALIGNMENTS = new Set(['left', 'center', 'right']);
const VERTICAL_ALIGNMENTS = new Set(['top', 'middle', 'bottom']);

export function translatePositionForBleed(position, previousBleed, nextBleed, canvasScale) {
  const deltaPx = (nextBleed - previousBleed) * canvasScale;
  return {
    left: Math.max(0, position.left + deltaPx),
    top: Math.max(0, position.top + deltaPx)
  };
}

export function getAlignedPosition(alignment, bounds, itemSize) {
  const [vertical, horizontal] = alignment.split('-');
  if (!VERTICAL_ALIGNMENTS.has(vertical) || !HORIZONTAL_ALIGNMENTS.has(horizontal)) {
    throw new Error(`Unknown alignment: ${alignment}`);
  }

  let left = bounds.left;
  if (horizontal === 'center') {
    left += (bounds.width - itemSize.width) / 2;
  } else if (horizontal === 'right') {
    left += bounds.width - itemSize.width;
  }

  let top = bounds.top;
  if (vertical === 'middle') {
    top += (bounds.height - itemSize.height) / 2;
  } else if (vertical === 'bottom') {
    top += bounds.height - itemSize.height;
  }

  return { left, top };
}

export function getHorizontallyAlignedPosition(alignment, bounds, itemSize, currentPosition) {
  if (!HORIZONTAL_ALIGNMENTS.has(alignment)) {
    throw new Error(`Unknown horizontal alignment: ${alignment}`);
  }

  let left = bounds.left;
  if (alignment === 'center') {
    left += (bounds.width - itemSize.width) / 2;
  } else if (alignment === 'right') {
    left += bounds.width - itemSize.width;
  }

  return { left, top: currentPosition.top };
}
export function getVerticallyAlignedPosition(alignment, bounds, itemSize, currentPosition) {
  if (!VERTICAL_ALIGNMENTS.has(alignment)) {
    throw new Error(`Unknown vertical alignment: ${alignment}`);
  }

  let top = bounds.top;
  if (alignment === 'middle') {
    top += (bounds.height - itemSize.height) / 2;
  } else if (alignment === 'bottom') {
    top += bounds.height - itemSize.height;
  }

  return { left: currentPosition.left, top };
}
