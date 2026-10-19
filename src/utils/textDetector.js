/**
 * Disclaimer Text Detector Utility
 * Uses pdfjs-dist to extract text layers and find disclaimer-like keywords
 * to locate the optimal position for the Union Bug.
 */

// Keywords commonly used in disclaimers (will be searched space-free)
const DISCLAIMER_KEYWORDS = [
  'paid for by',
  'sponsored by',
  'authorized by',
  'disclaimer',
  'published by',
  'paid for',
  'paid',
  '위원회',
  '선거',
  '광고',
  '후원',
  '유인물',
  '제작',
  '발행',
  '연대',
  '조합'
];

/**
 * Searches for a disclaimer on a rendered PDF page.
 * Uses a line-reconstruction algorithm and space-free matching to overcome character-splitting.
 * 
 * @param {Object} pdfPage - pdfjs-dist page object
 * @returns {Promise<{x: number, y: number, width: number, height: number, text: string} | null>} Coordinates in PDF points (bottom-left origin) or null
 */
export async function findDisclaimerInPDF(pdfPage) {
  try {
    const textContent = await pdfPage.getTextContent();
    const items = textContent.items;
    
    if (!items || items.length === 0) {
      return null;
    }
    
    // Group text items by Y coordinate (with a tolerance of 5 points for baseline variations)
    const linesMap = {};
    for (const item of items) {
      // Skip empty items or structural marked content that lacks a transform matrix!
      if (!item.str || item.str.trim() === '' || !item.transform) continue;
      
      const y = Math.round(item.transform[5]); // Y translation matrix element
      
      // Look for an existing line baseline within 5 points tolerance
      let foundY = Object.keys(linesMap).find(key => Math.abs(Number(key) - y) <= 5);
      
      if (!foundY) {
        foundY = String(y);
        linesMap[foundY] = [];
      }
      
      linesMap[foundY].push(item);
    }
    
    let bestMatch = null;
    
    // Process each reconstructed line baseline
    for (const yStr of Object.keys(linesMap)) {
      const y = Number(yStr);
      const lineItems = linesMap[yStr];
      
      // Sort line items left-to-right by X coordinate
      lineItems.sort((a, b) => a.transform[4] - b.transform[4]);
      
      // Reconstruct line text
      const fullText = lineItems.map(item => item.str).join(' ');
      
      // Normalize text for matching: lower-case and remove ALL spaces.
      // This solves issues where spaces are missing or characters are segmented in PDF data.
      const cleanLineText = fullText.toLowerCase().replace(/\s+/g, '');
      
      
      // Match keywords using space-free matching
      const isMatch = DISCLAIMER_KEYWORDS.some(keyword => {
        const cleanKeyword = keyword.toLowerCase().replace(/\s+/g, '');
        return cleanLineText.includes(cleanKeyword);
      });
      
      if (isMatch) {
        // Calculate the bounding box bounds of the entire line
        const minX = Math.min(...lineItems.map(i => i.transform[4]));
        const maxX = Math.max(...lineItems.map(i => {
          const w = i.width || (i.str.length * 6); // fallback estimated width
          return i.transform[4] + w;
        }));
        
        const height = Math.max(...lineItems.map(i => i.height || i.transform[3]));
        const width = maxX - minX;
        
        // Disclaimers are almost always at the bottom, so choose the lowest matching Y baseline
        if (!bestMatch || y < bestMatch.y) {
          bestMatch = {
            x: minX,
            y,
            width,
            height,
            text: fullText
          };
        }
      }
    }
    
    return bestMatch;
  } catch (error) {
    console.error('Error scanning PDF text layer:', error);
    return null;
  }
}

/**
 * Recommends an optimal Union Bug placement position
 * based on a found disclaimer, safe zones, and target alignment mode.
 * 
 * @param {Object} disclaimer - Output of findDisclaimerInPDF
 * @param {number} pageWidth - Page width in PDF points
 * @param {number} pageHeight - Page height in PDF points
 * @param {number} bugWidth - Desired bug width in PDF points
 * @param {number} bugHeight - Desired bug height in PDF points
 * @param {number} safeMargin - Cut Safe Margin in PDF points
 * @param {string} alignmentMode - 'auto' | 'right' | 'below'
 * @returns {{x: number}} Recommended coordinates (bottom-left origin in PDF points)
 */
export function getRecommendedPosition(
  disclaimer,
  pageWidth,
  pageHeight,
  bugWidth = 24,
  bugHeight = 24,
  safeMargin = 18,
  alignmentMode = 'auto'
) {
  // Fallback to Bottom Right (within safe area) if no disclaimer found
  const fallbackX = pageWidth - safeMargin - bugWidth;
  const fallbackY = safeMargin;
  
  if (!disclaimer) {
    return { x: fallbackX, y: fallbackY };
  }
  
  const disX = disclaimer.x;
  const disY = disclaimer.y;
  const disW = disclaimer.width;
  const disH = disclaimer.height;
  
  let targetX;
  let targetY;
  
  if (alignmentMode === 'right') {
    // Force place to the right of the disclaimer
    targetX = disX + disW + 8;
    targetY = disY + (disH / 2) - (bugHeight / 2);
  } else if (alignmentMode === 'below') {
    // Force place below the disclaimer
    targetY = disY - bugHeight - 4;
    targetX = Math.max(safeMargin, Math.min(disX, pageWidth - safeMargin - bugWidth));
  } else {
    // 'auto' mode: Dynamically choose based on horizontal clearance space
    const idealX = disX + disW + 8;
    const idealY = disY + (disH / 2) - (bugHeight / 2);
    
    if (idealX + bugWidth <= pageWidth - safeMargin) {
      // Fits on the right!
      targetX = idealX;
      targetY = idealY;
    } else {
      // Pushes past the right margin -> Place below the text
      targetY = disY - bugHeight - 4;
      targetX = Math.max(safeMargin, Math.min(disX, pageWidth - safeMargin - bugWidth));
      
      // If below pushes past bottom margin -> Place above
      if (targetY < safeMargin) {
        targetY = disY + disH + 4;
      }
    }
  }
  
  // Ensure the recommended coordinates are STRICTLY within the Cut Safe Area
  const finalX = Math.max(safeMargin, Math.min(targetX, pageWidth - safeMargin - bugWidth));
  const finalY = Math.max(safeMargin, Math.min(targetY, pageHeight - safeMargin - bugHeight));
  
  return { x: finalX, y: finalY };
}
