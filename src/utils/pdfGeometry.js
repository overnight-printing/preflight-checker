// PDF boxes stay in source coordinates; preview coordinates follow page rotation.
export function rotatedSize(box, rotation = 0) {
  return rotation % 180 === 0
    ? { width: box.width, height: box.height }
    : { width: box.height, height: box.width };
}

export function rotateInsets(insets, rotation = 0) {
  const edges = ['left', 'top', 'right', 'bottom'];
  const turns = ((rotation / 90) % 4 + 4) % 4;
  return Object.fromEntries(edges.map((edge, index) => [edge, insets[edges[(index - turns + 4) % 4]]]));
}

export function getOutputGeometry(boxInfo, { trimCropEnabled = false, manualCropAmount = 0, bleedAmount = 0 } = {}) {
  if (![manualCropAmount, bleedAmount].every(value => Number.isFinite(value) && value >= 0)) {
    throw new Error('Crop and bleed amounts must be finite, non-negative numbers.');
  }
  const base = trimCropEnabled ? boxInfo.trimBox : boxInfo.cropBox;
  const sourceBox = {
    x: base.x + manualCropAmount,
    y: base.y + manualCropAmount,
    width: base.width - 2 * manualCropAmount,
    height: base.height - 2 * manualCropAmount
  };
  if (sourceBox.width <= 0 || sourceBox.height <= 0) {
    throw new Error('The crop inset removes the entire page. Reduce the manual inset.');
  }
  const originalTrim = boxInfo.trimBox;
  const left = Math.max(sourceBox.x, originalTrim.x);
  const bottom = Math.max(sourceBox.y, originalTrim.y);
  const right = Math.min(sourceBox.x + sourceBox.width, originalTrim.x + originalTrim.width);
  const top = Math.min(sourceBox.y + sourceBox.height, originalTrim.y + originalTrim.height);
  if (right <= left || top <= bottom) throw new Error('The crop does not contain any of the trim area.');
  const trimBox = {
    x: bleedAmount + left - sourceBox.x,
    y: bleedAmount + bottom - sourceBox.y,
    width: right - left,
    height: top - bottom
  };
  const outputBox = { x: 0, y: 0, width: sourceBox.width + 2 * bleedAmount, height: sourceBox.height + 2 * bleedAmount };
  return { sourceBox, trimBox, outputBox };
}

export function stampDrawOptions(position, size, scale, box, rotation = 0) {
  const display = rotatedSize(box, rotation);
  const x = position.left / scale;
  const y = display.height - (position.top + size.height) / scale;
  const angle = ((rotation % 360) + 360) % 360;
  const [rawX, rawY] = angle === 90 ? [box.width - y, x]
    : angle === 180 ? [box.width - x, box.height - y]
    : angle === 270 ? [y, box.height - x] : [x, y];
  return { x: box.x + rawX, y: box.y + rawY, width: size.width / scale, height: size.height / scale, angle };
}
