/**
 * Color Analyzer Utility
 * Samples pixels from the artwork canvas to determine:
 * 1. Luminance at the Union Bug's placement to auto-recommend black or white.
 * 2. Dominant colors in the artwork to build a matching theme palette.
 */

/**
 * Analyzes the average luminance of a background area on a canvas.
 * 
 * @param {HTMLCanvasElement} canvas - The artwork canvas
 * @param {number} x - Left coordinate (in canvas pixels)
 * @param {number} y - Top coordinate (in canvas pixels)
 * @param {number} width - Width of the area (in canvas pixels)
 * @param {number} height - Height of the area (in canvas pixels)
 * @returns {{isDark: boolean, avgLuminance: number}} Luminance analysis
 */
export function analyzeBackgroundLuminance(canvas, x, y, width, height) {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return { isDark: false, avgLuminance: 255 };

    // Clamp coordinates to canvas boundaries
    const startX = Math.max(0, Math.min(x, canvas.width - 1));
    const startY = Math.max(0, Math.min(y, canvas.height - 1));
    const sampleW = Math.max(1, Math.min(width, canvas.width - startX));
    const sampleH = Math.max(1, Math.min(height, canvas.height - startY));

    // Get pixel data
    const imgData = ctx.getImageData(startX, startY, sampleW, sampleH);
    const data = imgData.data;

    let rSum = 0;
    let gSum = 0;
    let bSum = 0;
    let count = 0;

    // Sample pixels (step by 2 to improve speed on larger areas)
    for (let i = 0; i < data.length; i += 8) {
      rSum += data[i];
      gSum += data[i + 1];
      bSum += data[i + 2];
      count++;
    }

    if (count === 0) return { isDark: false, avgLuminance: 255 };

    const rAvg = rSum / count;
    const gAvg = gSum / count;
    const bAvg = bSum / count;

    // Standard perceived luminance formula (ITU-R BT.601)
    const avgLuminance = 0.299 * rAvg + 0.587 * gAvg + 0.114 * bAvg;

    // A luminance of < 130 is generally dark background (needs white text)
    // 130 to 255 is light background (needs black text)
    return {
      isDark: avgLuminance < 135,
      avgLuminance
    };
  } catch (error) {
    console.error('Error analyzing background luminance:', error);
    return { isDark: false, avgLuminance: 255 };
  }
}

/**
 * Extracts a palette of dominant colors from a canvas.
 * Samples a grid across the canvas (or specifically the bottom area)
 * and groups similar colors.
 * 
 * @param {HTMLCanvasElement} canvas - The artwork canvas
 * @param {boolean} bottomOnly - If true, only samples from the bottom 30% of the canvas
 * @returns {string[]} Array of Hex color strings (5 unique colors)
 */
export function extractDominantColors(canvas, bottomOnly = true) {
  try {
    const ctx = canvas.getContext('2d');
    if (!ctx) return ['#000000', '#ffffff', '#333333', '#cccccc', '#888888'];

    let colors = sampleCanvas(ctx, canvas, bottomOnly);
    
    // If we have almost no non-neutral colored pixels, scan the whole canvas to capture key colors
    const nonNeutralCount = colors.filter(c => !isNeutral(c.r, c.g, c.b)).length;
    if (bottomOnly && nonNeutralCount < 10) {
      colors = sampleCanvas(ctx, canvas, false);
    }

    if (colors.length === 0) {
      return ['#000000', '#ffffff', '#333333', '#cccccc', '#888888'];
    }

    // Cluster colors without lossy rounding to 32.
    // Group colors that are close in RGB Euclidean distance (distance < 30)
    const clusters = [];
    
    for (const rgb of colors) {
      let foundCluster = false;
      for (const cluster of clusters) {
        if (colorDiffRgb(cluster.representative, rgb) < 30) {
          cluster.count++;
          foundCluster = true;
          break;
        }
      }
      if (!foundCluster) {
        clusters.push({
          representative: rgb,
          count: 1
        });
      }
    }

    // Sort clusters by count descending
    clusters.sort((a, b) => b.count - a.count);

    // Convert clusters to hex palette
    const palette = [];
    const extractedColors = [];
    
    for (const cluster of clusters) {
      const hex = rgbToHex(cluster.representative.r, cluster.representative.g, cluster.representative.b);
      // Skip neutral colors (black, white, greys) to highlight actual brand hues
      if (isNeutral(cluster.representative.r, cluster.representative.g, cluster.representative.b)) {
        continue;
      }
      // Ensure color is sufficiently different from other extracted colors
      const isUnique = extractedColors.every(c => colorDiff(c, hex) > 45);
      if (isUnique) {
        extractedColors.push(hex);
      }
    }

    // Always include standard dark/light options first
    palette.push('#000000');
    palette.push('#ffffff');

    // Add up to 3 dominant colored highlights
    for (const color of extractedColors) {
      if (palette.length >= 5) break;
      palette.push(color);
    }

    // If we still need more colors (e.g., artwork only has 1 main color),
    // dynamically generate tints, shades, and analogous variations of the first dominant color.
    if (palette.length < 5 && extractedColors.length > 0) {
      const primaryColor = extractedColors[0];
      const variations = generateColorVariations(primaryColor);
      for (const variant of variations) {
        if (palette.length >= 5) break;
        if (!palette.includes(variant) && palette.every(p => colorDiff(p, variant) > 30)) {
          palette.push(variant);
        }
      }
    }

    // Fallback neutral shades if absolutely no colors are found
    const neutralShades = ['#333333', '#cccccc', '#888888', '#555555', '#aaaaaa'];
    while (palette.length < 5 && neutralShades.length > 0) {
      const ns = neutralShades.shift();
      if (!palette.includes(ns)) {
        palette.push(ns);
      }
    }

    return palette.slice(0, 5); // Return top 5
  } catch (error) {
    console.error('Error extracting dominant colors:', error);
    return ['#000000', '#ffffff', '#333333', '#cccccc', '#888888'];
  }
}

// Helper to sample pixels on a grid from canvas
function sampleCanvas(ctx, canvas, bottomOnly) {
  const heightStart = bottomOnly ? Math.floor(canvas.height * 0.7) : 0;
  const sampleHeight = canvas.height - heightStart;
  
  const gridCols = 20;
  const gridRows = 15;
  const colors = [];

  const cellWidth = canvas.width / gridCols;
  const cellHeight = sampleHeight / gridRows;

  for (let r = 0; r < gridRows; r++) {
    for (let c = 0; c < gridCols; c++) {
      const x = Math.floor(c * cellWidth + cellWidth / 2);
      const y = Math.floor(heightStart + r * cellHeight + cellHeight / 2);
      
      if (x >= canvas.width || y >= canvas.height) continue;

      const pixel = ctx.getImageData(x, y, 1, 1).data;
      const alpha = pixel[3];

      // Skip transparent pixels
      if (alpha < 200) continue;

      colors.push({
        r: pixel[0],
        g: pixel[1],
        b: pixel[2]
      });
    }
  }
  return colors;
}

// Helper to determine if a color is a neutral grayscale (white, black, grey)
function isNeutral(r, g, b) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max - min > 20) return false;
  return true;
}

// Helper for RGB Euclidean distance
function colorDiffRgb(rgb1, rgb2) {
  return Math.sqrt(
    Math.pow(rgb1.r - rgb2.r, 2) +
    Math.pow(rgb1.g - rgb2.g, 2) +
    Math.pow(rgb1.b - rgb2.b, 2)
  );
}

// Helper to generate dynamic color variations (tints, shades, analogous) from a base color
function generateColorVariations(hex) {
  const r = parseInt(hex.substring(1, 3), 16);
  const g = parseInt(hex.substring(3, 5), 16);
  const b = parseInt(hex.substring(5, 7), 16);

  const { h, s, l } = rgbToHsl(r, g, b);
  const variants = [];

  // Lighter Tint
  variants.push(hslToHex(h, s, Math.min(95, l + 20)));
  // Darker Shade
  variants.push(hslToHex(h, s, Math.max(10, l - 20)));
  // Analogous Hue Shifts
  variants.push(hslToHex((h + 30) % 360, s, l));
  variants.push(hslToHex((h + 330) % 360, s, l));

  return variants;
}

// RGB to HSL conversion helper
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h, s, l = (max + min) / 2;

  if (max === min) {
    h = s = 0;
  } else {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h: Math.round(h * 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

// HSL to Hex conversion helper
function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, 9 - k(n), 1));
  const toHex = x => {
    const hex = Math.round(x * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}

// Utility: RGB to Hex
function rgbToHex(r, g, b) {
  const toHex = c => {
    const hex = c.toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// Utility: Euclidean color distance
function colorDiff(hex1, hex2) {
  const r1 = parseInt(hex1.substring(1, 3), 16);
  const g1 = parseInt(hex1.substring(3, 5), 16);
  const b1 = parseInt(hex1.substring(5, 7), 16);

  const r2 = parseInt(hex2.substring(1, 3), 16);
  const g2 = parseInt(hex2.substring(3, 5), 16);
  const b2 = parseInt(hex2.substring(5, 7), 16);

  return Math.sqrt(Math.pow(r1 - r2, 2) + Math.pow(g1 - g2, 2) + Math.pow(b1 - b2, 2));
}
