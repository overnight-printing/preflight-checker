import { useRef, useState, useEffect } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

export default function EditorCanvas({
  artworkCanvas, // HTMLCanvasElement of the artwork
  artworkFile,   // File object of the active artwork
  bugImageSrc,   // DataURL of the tinted bug
  position,      // { left: px, top: px }
  size,          // { width: px, height: px }
  pdfBoxInfo = null, // Geometry box metadata (CropBox, TrimBox)
  sourceHasBleed = true, // Whether the source file already contains 0.125" bleed
  canvasScale = 1.0,
  showSafeLine = true,
  bleedEnabled = false, // Added bleedEnabled to draw the actual Trim Line (Magenta)
  trimCropEnabled = false, // New prop to align guide lines when cropped
  bugEnabled = true, // Toggle to show/hide bug overlay
  zoom = 1.0,       // Zoom scale (0.1 to 3.0)
  onZoomChange,     // callback to update zoom
  onPositionChange,
  onSizeChange,
  onDragEnd,
  totalPages = 1,
  isPageSelectorExpanded = false,
  onWorkspaceClick
}) {
  const containerRef = useRef(null);
  const canvasMountRef = useRef(null);
  
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [bugStartPos, setBugStartPos] = useState({ left: 0, top: 0 });
  const [bugStartSize, setBugStartSize] = useState({ width: 0, height: 0 });
  const [aspectRatio, setAspectRatio] = useState(1.0);

  const hasBoxInfo = !!(pdfBoxInfo && pdfBoxInfo.trimBox && pdfBoxInfo.cropBox);
  
  // If virtual mirror bleed is enabled, coordinates are offset by 9pt on all edges.
  const virtualBleedOffset = bleedEnabled ? 9.0 : 0.0;
  
  // CropBox coordinates mapping (offsetting for virtual bleed if active)
  // If trimCropEnabled is true, the canvas origin (0,0) is effectively the TrimBox's top-left.
  const trimBoxLeft = hasBoxInfo 
    ? (trimCropEnabled ? virtualBleedOffset : (pdfBoxInfo.trimBox.x - pdfBoxInfo.cropBox.x) + virtualBleedOffset) 
    : 0;
  const trimBoxTop = hasBoxInfo 
    ? (trimCropEnabled ? virtualBleedOffset : (pdfBoxInfo.cropBox.height - (pdfBoxInfo.trimBox.y - pdfBoxInfo.cropBox.y + pdfBoxInfo.trimBox.height)) + virtualBleedOffset) 
    : 0;
  const trimBoxWidth = hasBoxInfo ? pdfBoxInfo.trimBox.width : 0;
  const trimBoxHeight = hasBoxInfo ? pdfBoxInfo.trimBox.height : 0;

  // Map PDF geometry to canvas pixels
  const trimLeftPx = trimBoxLeft * canvasScale;
  const trimTopPx = trimBoxTop * canvasScale;
  const trimWidthPx = trimBoxWidth * canvasScale;
  const trimHeightPx = trimBoxHeight * canvasScale;

  // Safe area = 9pt (0.125") inside the TrimBox
  const safeLeftPx = (trimBoxLeft + 9.0) * canvasScale;
  const safeTopPx = (trimBoxTop + 9.0) * canvasScale;
  const safeWidthPx = (trimBoxWidth - 18.0) * canvasScale;
  const safeHeightPx = (trimBoxHeight - 18.0) * canvasScale;

  // Sizing limits in canvas pixels: 0.2 inches (min) to 2.0 inches (max)
  // 1 inch = 72 points (pt). Canvas pixels = points * canvasScale.
  const minWidthPx = 0.2 * 72 * canvasScale;
  const maxWidthPx = 2.0 * 72 * canvasScale;

  // Fallback margins when Box Info is not present (standard image/canvas)
  const bleedPadding = (sourceHasBleed ? 9.0 : 0.0) + (bleedEnabled ? 9.0 : 0.0);
  const fallbackTrimPx = bleedPadding * canvasScale;
  const fallbackSafePx = (bleedPadding + 9.0) * canvasScale;
  
  const canvasWidth = artworkCanvas ? artworkCanvas.width : 0;
  const canvasHeight = artworkCanvas ? artworkCanvas.height : 0;

  // Compute dynamic top/bottom paddings for layout and zoom calculations
  const topPadding = pdfBoxInfo ? 130 : 40;
  let bottomPadding = 40;
  if (totalPages > 1) {
    bottomPadding = isPageSelectorExpanded ? 300 : 140;
  } else {
    bottomPadding = 90; // clear floating zoom controls
  }

  // Recalculates zoom to fit the canvas inside the visible viewport area
  const handleFitToHeight = () => {
    if (!containerRef.current || !artworkCanvas) return;
    
    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight;
    
    const visibleWidth = containerWidth - 80;
    const visibleHeight = containerHeight - topPadding - bottomPadding;
    
    // Leave some padding (48px for both width and height)
    const zoomX = (visibleWidth - 48) / artworkCanvas.width;
    const zoomY = (visibleHeight - 48) / artworkCanvas.height;
    
    // Fit completely inside both bounds, capping at 1.0 (100%)
    const fitZoom = Math.min(1.0, zoomX, zoomY);
    const finalZoom = Math.max(0.1, Math.round(fitZoom * 10) / 10);
    
    onZoomChange(finalZoom);
  };

  const lastFileRef = useRef(null);
  const lastBoxInfoRef = useRef(null);

  // Auto-fit to height on first artwork load (and when pdfBoxInfo is asynchronously resolved)
  useEffect(() => {
    if (!artworkFile) {
      lastFileRef.current = null;
      lastBoxInfoRef.current = null;
      return;
    }

    if (artworkCanvas) {
      const isNewFile = !lastFileRef.current || 
        lastFileRef.current.name !== artworkFile.name;
      
      const isBoxInfoLoaded = pdfBoxInfo !== null && lastBoxInfoRef.current === null;
      
      if (isNewFile || isBoxInfoLoaded) {
        setTimeout(handleFitToHeight, 150);
        lastFileRef.current = artworkFile;
        if (pdfBoxInfo) {
          lastBoxInfoRef.current = pdfBoxInfo;
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artworkCanvas, artworkFile, pdfBoxInfo]);

  // Handle Drag Start
  const handleDragStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    setIsDragging(true);
    setDragStart({ x: clientX, y: clientY });
    setBugStartPos({ left: position.left, top: position.top });
  };

  // Handle Resize Start
  const handleResizeStart = (e) => {
    e.preventDefault();
    e.stopPropagation();
    
    const clientX = e.clientX || (e.touches && e.touches[0].clientX);
    const clientY = e.clientY || (e.touches && e.touches[0].clientY);
    
    setIsResizing(true);
    setDragStart({ x: clientX, y: clientY });
    setBugStartSize({ width: size.width, height: size.height });
    setAspectRatio(size.width / size.height);
  };

  // Handle Mouse/Touch Move with Zoom Factor correction!
  useEffect(() => {
    const handleMove = (e) => {
      if (!isDragging && !isResizing) return;
      
      const clientX = e.clientX || (e.touches && e.touches[0].clientX);
      const clientY = e.clientY || (e.touches && e.touches[0].clientY);
      
      // Divide by zoom factor to map mouse delta to actual high-res canvas pixels!
      const deltaX = (clientX - dragStart.x) / zoom;
      const deltaY = (clientY - dragStart.y) / zoom;
      
      if (isDragging) {
        let newLeft = bugStartPos.left + deltaX;
        let newTop = bugStartPos.top + deltaY;
        
        newLeft = Math.max(0, Math.min(newLeft, canvasWidth - size.width));
        newTop = Math.max(0, Math.min(newTop, canvasHeight - size.height));
        
        onPositionChange({ left: newLeft, top: newTop });
      }
      
      if (isResizing) {
        let newWidth = bugStartSize.width + deltaX;
        // Clamp width between 0.2" and 2.0" in canvas pixels
        newWidth = Math.max(minWidthPx, Math.min(maxWidthPx, newWidth));
        
        const newHeight = newWidth / aspectRatio;
        
        if (position.left + newWidth <= canvasWidth && position.top + newHeight <= canvasHeight) {
          onSizeChange({ width: newWidth, height: newHeight });
        }
      }
    };

    const handleEnd = () => {
      if (isDragging) {
        setIsDragging(false);
        if (onDragEnd) onDragEnd();
      }
      if (isResizing) {
        setIsResizing(false);
        if (onDragEnd) onDragEnd();
      }
    };

    if (isDragging || isResizing) {
      window.addEventListener('mousemove', handleMove);
      window.addEventListener('mouseup', handleEnd);
      window.addEventListener('touchmove', handleMove, { passive: false });
      window.addEventListener('touchend', handleEnd);
    }

    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleEnd);
      window.removeEventListener('touchmove', handleMove);
      window.removeEventListener('touchend', handleEnd);
    };
  }, [
    isDragging,
    isResizing,
    dragStart,
    bugStartPos,
    bugStartSize,
    aspectRatio,
    canvasWidth,
    canvasHeight,
    size,
    position,
    zoom,
    minWidthPx,
    maxWidthPx,
    onPositionChange,
    onSizeChange,
    onDragEnd
  ]);

  // Mount artwork canvas into the view
  useEffect(() => {
    if (canvasMountRef.current && artworkCanvas) {
      canvasMountRef.current.innerHTML = '';
      canvasMountRef.current.appendChild(artworkCanvas);
    }
  }, [artworkCanvas]);

  if (!artworkCanvas) return null;

  return (
    <div className="canvas-workspace" ref={containerRef} onClick={onWorkspaceClick}>
      {/* Scrollable Viewport Wrapper */}
      <div 
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          overflow: 'auto',
          padding: `${topPadding}px 40px ${bottomPadding}px 40px`
        }}
      >
        {/* Layout boundary matching the visual zoomed size */}
        {/* Resolves clipping/centering issues with CSS transform: scale */}
        <div
          style={{
            width: `${canvasWidth * zoom}px`,
            height: `${canvasHeight * zoom}px`,
            position: 'relative',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            flexShrink: 0
          }}
        >
          <div 
            className="canvas-container"
            style={{
              width: `${canvasWidth}px`,
              height: `${canvasHeight}px`,
              position: 'absolute',
              transform: `scale(${zoom})`,
              transformOrigin: 'center center',
              transition: 'transform 0.15s ease-out',
              flexShrink: 0,
              maxWidth: 'none',
              maxHeight: 'none'
            }}
          >
            {/* Rendered Page */}
            <div ref={canvasMountRef} className="artwork-canvas" style={{ pointerEvents: 'none' }} />

             {/* 1. Trim Line / Cut Line Overlay */}
             {hasBoxInfo ? (
               // Render professional Blue Trim Box if geometry exists in PDF
               showSafeLine && (
                  <div 
                    style={{
                      position: 'absolute',
                      top: `${trimTopPx}px`,
                      left: `${trimLeftPx}px`,
                      width: `${trimWidthPx}px`,
                      height: `${trimHeightPx}px`,
                      border: '1.5px solid #0055ff', // Blue Trim Line
                      pointerEvents: 'none',
                      zIndex: 2,
                      boxSizing: 'border-box'
                    }}
                  />
               )
             ) : (
               // Fallback: Render Magenta Trim Box for standard images/bleeds
               bleedPadding > 0 && showSafeLine && (
                  <div 
                    style={{
                      position: 'absolute',
                      top: `${fallbackTrimPx}px`,
                      left: `${fallbackTrimPx}px`,
                      width: `${canvasWidth - (fallbackTrimPx * 2)}px`,
                      height: `${canvasHeight - (fallbackTrimPx * 2)}px`,
                      border: '1.5px solid #ff007f', // Magenta Trim Line
                      pointerEvents: 'none',
                      zIndex: 2,
                      boxSizing: 'border-box'
                    }}
                  />
               )
             )}

             {/* 2. Safe Area Dot Line */}
             {showSafeLine && (
               hasBoxInfo ? (
                 // Render Cyan dashed Safe Zone exactly 9pt inside PDF TrimBox
                  <div 
                    style={{
                      position: 'absolute',
                      top: `${safeTopPx}px`,
                      left: `${safeLeftPx}px`,
                      width: `${safeWidthPx}px`,
                      height: `${safeHeightPx}px`,
                      border: '1.5px dashed #00e5ff', // Cyan Dashed Line
                      pointerEvents: 'none',
                      zIndex: 2,
                      boxSizing: 'border-box'
                    }}
                  />
               ) : (
                 // Fallback: Render Cyan dashed Safe Zone relative to outer canvas edge
                  <div 
                    style={{
                      position: 'absolute',
                      top: `${fallbackSafePx}px`,
                      left: `${fallbackSafePx}px`,
                      width: `${canvasWidth - (fallbackSafePx * 2)}px`,
                      height: `${canvasHeight - (fallbackSafePx * 2)}px`,
                      border: '1.5px dashed #00e5ff', // Cyan Dashed Line
                      pointerEvents: 'none',
                      zIndex: 2,
                      boxSizing: 'border-box'
                    }}
                  />
               )
             )}

            {bugEnabled && bugImageSrc && (
              <div
                className={`draggable-bug ${isDragging || isResizing ? 'active' : ''}`}
                style={{
                  left: `${position.left}px`,
                  top: `${position.top}px`,
                  width: `${size.width}px`,
                  height: `${size.height}px`
                }}
                onMouseDown={handleDragStart}
                onTouchStart={handleDragStart}
                onClick={(e) => e.stopPropagation()}
              >
                <img src={bugImageSrc} alt="Union Bug Preview" />
                <div 
                  className="bug-resize-handle"
                  onMouseDown={handleResizeStart}
                  onTouchStart={handleResizeStart}
                />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Floating Interactive Canvas Zoom Controls */}
      <div 
        className="zoom-controls-bar"
        onClick={(e) => e.stopPropagation()}
        style={{ 
          bottom: totalPages > 1 ? (isPageSelectorExpanded ? '236px' : '76px') : '24px',
          zIndex: 20
        }}
      >
        <button
          className="zoom-btn"
          onClick={() => onZoomChange(Math.max(0.1, zoom - 0.1))}
          title="축소"
        >
          <ZoomOut size={16} />
        </button>

        <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', minWidth: '45px', textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>

        <button
          className="zoom-btn"
          onClick={() => onZoomChange(Math.min(3.0, zoom + 0.1))}
          title="확대"
        >
          <ZoomIn size={16} />
        </button>

        <div style={{ width: '1px', height: '16px', background: 'var(--border-color)' }} />

        <button
          className="zoom-btn"
          onClick={handleFitToHeight}
          title="화면에 맞춤"
        >
          <Maximize2 size={15} />
        </button>
      </div>
    </div>
  );
}
