// Pixel analysis only: these preview pixels are never used in PDF export.
// shortcut: conventional dark corner marks only; extend using production samples for other styles.
export function detectCropMarks({ data, width, height }, widthPoints, heightPoints) {
  const scaleX = width / widthPoints, scaleY = height / heightPoints;
  if (!data || data.length !== width * height * 4 || ![scaleX, scaleY].every(value => Number.isFinite(value) && value > 0)) throw new Error('Invalid crop-mark preview.');
  const ink = (x, y) => {
    const i = (y * width + x) * 4;
    return (255 - (0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])) * data[i + 3] / 255;
  };
  const dark = (x, y) => {
    const i = (y * width + x) * 4;
    const r = data[i], g = data[i + 1], b = data[i + 2];
    const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) * data[i + 3] / 255 + 255 - data[i + 3];
    return Math.max(r, g, b) - Math.min(r, g, b) <= 60 && luminance < 180;
  };
  const white = (x, y) => {
    const i = (y * width + x) * 4, alpha = data[i + 3] / 255;
    return Math.min(data[i], data[i + 1], data[i + 2]) * alpha + 255 * (1 - alpha) >= 235;
  };
  const scan = horizontal => {
    const across = horizontal ? width : height, along = horizontal ? height : width;
    const acrossScale = horizontal ? scaleX : scaleY, alongScale = horizontal ? scaleY : scaleX;
    const minLength = Math.max(2, 3 * acrossScale), maxLength = 36 * acrossScale;
    const tolerance = Math.max(1, acrossScale), maxThickness = Math.max(1, 2 * alongScale);
    const clearance = Math.max(2, Math.ceil(2 * alongScale));
    let active = [];
    const segments = [];
    const finish = group => {
      if (group.last - group.first + 1 > maxThickness) return;
      let weight = 0, center = 0;
      const column = Math.floor((group.start + group.end) / 2);
      // Include antialiased edge pixels so thin marks do not snap to a half-point grid.
      for (let row = Math.max(0, group.first - 1); row <= Math.min(along - 1, group.last + 1); row++) {
        const value = horizontal ? ink(column, row) : ink(row, column);
        weight += value; center += (row + 0.5) * value;
      }
      segments.push({
        axis: center / weight / alongScale,
        start: group.start / acrossScale, end: group.end / acrossScale,
      });
    };
    for (let row = 0; row < along; row++) {
      const runs = [];
      const before = Math.max(0, row - clearance), after = Math.min(along - 1, row + clearance);
      if (row < along * 0.25 || row >= along * 0.75) {
        for (const [from, to] of [[0, Math.floor(across * 0.25)], [Math.ceil(across * 0.75), across]]) {
          let start = -1;
          for (let column = from; column <= to; column++) {
            // White sides separate printed marks from text/photos, even when a mark touches the artwork.
            const marked = column < to && (horizontal
              ? dark(column, row) && white(column, before) && white(column, after)
              : dark(row, column) && white(before, column) && white(after, column));
            if (marked && start < 0) start = column;
            if (!marked && start >= 0) {
              if (column - start >= minLength && column - start <= maxLength) runs.push({ start, end: column });
              start = -1;
            }
          }
        }
      }
      const next = [];
      for (const run of runs) {
        const index = active.findIndex(group => Math.abs(group.start - run.start) <= tolerance && Math.abs(group.end - run.end) <= tolerance);
        const group = index >= 0 ? active.splice(index, 1)[0] : { ...run, first: row };
        group.last = row;
        next.push(group);
      }
      active.forEach(finish);
      active = next;
    }
    active.forEach(finish);
    return segments;
  };
  const pair = (segments, size) => segments.filter(line => line.end < size * 0.25).flatMap(first =>
    segments.filter(line => line.start > size * 0.75 && Math.abs(line.axis - first.axis) <= 1).map(last => ({ first, last, axis: (first.axis + last.axis) / 2 })));
  const horizontalSegments = scan(true), verticalSegments = scan(false);
  const ambiguous = { status: 'ambiguous', message: 'Multiple possible cut lines. Set and check the trim manually.' };
  if (horizontalSegments.length > 256 || verticalSegments.length > 256) return ambiguous;
  const horizontal = pair(horizontalSegments, widthPoints), vertical = pair(verticalSegments, heightPoints);
  if (horizontal.length > 32 || vertical.length > 32) return ambiguous;
  const candidates = [];
  for (const top of horizontal.filter(line => line.axis < heightPoints * 0.25)) {
    for (const bottom of horizontal.filter(line => line.axis > heightPoints * 0.75)) {
      for (const left of vertical.filter(line => line.axis < widthPoints * 0.25)) {
        for (const right of vertical.filter(line => line.axis > widthPoints * 0.75)) {
          if ([top, bottom].some(line => line.first.end >= left.axis - 1 || line.last.start <= right.axis + 1) ||
              [left, right].some(line => line.first.end >= top.axis - 1 || line.last.start <= bottom.axis + 1)) continue;
          const insets = { top: top.axis, bottom: heightPoints - bottom.axis, left: left.axis, right: widthPoints - right.axis };
          const segments = [top, bottom].flatMap(pair => [pair.first, pair.last].map(line => ({ x1: line.start, x2: line.end, y1: line.axis, y2: line.axis })))
            .concat([left, right].flatMap(pair => [pair.first, pair.last].map(line => ({ x1: line.axis, x2: line.axis, y1: line.start, y2: line.end }))));
          if (!candidates.some(candidate => Object.keys(insets).every(edge => Math.abs(candidate.insets[edge] - insets[edge]) <= 1))) candidates.push({ insets, segments });
          if (candidates.length > 1) return { status: 'ambiguous', message: 'Multiple possible cut lines. Set and check the trim manually.' };
        }
      }
    }
  }
  return candidates.length ? { status: 'found', detected: true, ...candidates[0] }
    : { status: 'none', message: 'No reliable trim detected. You can set the trim manually.' };
}
