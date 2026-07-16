import { useRef, useState, useEffect, useCallback } from 'react';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

export default function EditorCanvas({
  artworkCanvas, // HTMLCanvasElement of the artwork
  artworkFile,   // File object of the active artwork
  bugImageSrc,   // DataURL of the tinted bug
  position,      // { left: px, top: px }
  size,          // { width: px, height: px }
  pdfBoxInfo = null, // Geometry box metadata (CropBox, TrimBox)
  canvasScale = 1.0,
  showSafeLine = true,
  bleedEnabled = false, // Added bleedEnabled to draw the actual Trim Line (Magenta)
  bleedAmount = 9.0,    // Added mirror bleed in PDF points
  trimCropEnabled = false,
  manualCropAmount = 0,
  isCropMode = false,
  manualCropGuides = { top: 0, right: 0, bottom: 0, left: 0 },
  bugEnabled = true, // Toggle to show/hide bug overlay
  showGrid = false,
  snapToGrid = false,
  gridSize = 0.125,
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

  const canvasWidth = artworkCanvas ? artworkCanvas.width : 0;
  const canvasHeight = artworkCanvas ? artworkCanvas.height : 0;

  // REFACTORED GUIDE LINE LOGIC: 
  // Anchor everything to the CURRENT processed artwork canvas, not metadata.
  
  // If virtual mirror bleed is enabled, inset the artwork by the selected bleed.
  const virtualBleedPx = bleedEnabled ? (bleedAmount * canvasScale) : 0;
  
  const hasMetadataTrim = Boolean(pdfBoxInfo?.hasDistinctTrimBox && !trimCropEnabled);
  const metadataLeftPx = hasMetadataTrim
    ? Math.max(0, (pdfBoxInfo.trimInsets.left - manualCropAmount) * canvasScale)
    : 0;
  const metadataRightPx = hasMetadataTrim
    ? Math.max(0, (pdfBoxInfo.trimInsets.right - manualCropAmount) * canvasScale)
    : 0;
  const metadataTopPx = hasMetadataTrim
    ? Math.max(0, (pdfBoxInfo.trimInsets.top - manualCropAmount) * canvasScale)
    : 0;
  const metadataBottomPx = hasMetadataTrim
    ? Math.max(0, (pdfBoxInfo.trimInsets.bottom - manualCropAmount) * canvasScale)
    : 0;

  // Visual crop guides override metadata because they represent the user's
  // chosen physical cut line. The current canvas is not cropped a second time.
  const cropLeftPx = isCropMode ? manualCropGuides.left : metadataLeftPx;
  const cropTopPx = isCropMode ? manualCropGuides.top : metadataTopPx;
  const cropRightPx = isCropMode ? manualCropGuides.right : metadataRightPx;
  const cropBottomPx = isCropMode ? manualCropGuides.bottom : metadataBottomPx;

  const trimLeftPx = virtualBleedPx + cropLeftPx;
  const trimTopPx = virtualBleedPx + cropTopPx;
  const trimWidthPx = Math.max(0, canvasWidth - (virtualBleedPx * 2) - cropLeftPx - cropRightPx);
  const trimHeightPx = Math.max(0, canvasHeight - (virtualBleedPx * 2) - cropTopPx - cropBottomPx);

  // The Safe Zone (Cyan) is ALWAYS 9pt (0.125") inside the Trim Line.
  const safeInsetPx = 9.0 * canvasScale;
  const safeLeftPx = trimLeftPx + safeInsetPx;
  const safeTopPx = trimTopPx + safeInsetPx;
  const safeWidthPx = Math.max(0, trimWidthPx - (safeInsetPx * 2));
  const safeHeightPx = Math.max(0, trimHeightPx - (safeInsetPx * 2));

  // Keep guide strokes inside the clipped canvas. Borders positioned exactly
  // on the outer right/bottom edges can disappear after browser zoom scaling.
  const clampGuideToCanvas = (left, top, width, height) => {
    const edgeInset = 2;
    const clampedLeft = Math.max(edgeInset, left);
    const clampedTop = Math.max(edgeInset, top);
    const clampedRight = Math.min(canvasWidth - edgeInset, left + width);
    const clampedBottom = Math.min(canvasHeight - edgeInset, top + height);
    return {
      left: clampedLeft,
      top: clampedTop,
      width: Math.max(0, clampedRight - clampedLeft),
      height: Math.max(0, clampedBottom - clampedTop)
    };
  };
  const trimGuide = clampGuideToCanvas(trimLeftPx, trimTopPx, trimWidthPx, trimHeightPx);
  const safeGuide = clampGuideToCanvas(safeLeftPx, safeTopPx, safeWidthPx, safeHeightPx);

  // Sizing limits in canvas pixels: 0.2 inches (min) to 2.0 inches (max)
  const minWidthPx = 0.2 * 72 * canvasScale;
  const maxWidthPx = 2.0 * 72 * canvasScale;
  const gridSizePx = Math.max(1, gridSize * 72 * canvasScale);

  const snapValueToGrid = useCallback((value) => {
    if (!snapToGrid) return value;
    return Math.round(value / gridSizePx) * gridSizePx;
  }, [gridSizePx, snapToGrid]);

  // Compute dynamic top/bottom paddings for layout and zoom calculations
  const topPadding = pdfBoxInfo ? 46 : 40;
  let bottomPadding = 40;
  if (totalPages > 1) {
    bottomPadding = isPageSelectorExpanded ? 300 : 140;
  } else {
    bottomPadding = 90; // clear floating zoom controls
  }

  // Recalculate zoom from the actual viewport available to the artwork.
  const handleFitToHeight = useCallback(() => {
    if (!containerRef.current || !artworkCanvas) return;
    
    const containerWidth = containerRef.current.clientWidth;
    const containerHeight = containerRef.current.clientHeight;
    
    const visibleWidth = Math.max(1, containerWidth - 80);
    const visibleHeight = Math.max(1, containerHeight - topPadding - bottomPadding);
    
    const zoomX = visibleWidth / artworkCanvas.width;
    const zoomY = visibleHeight / artworkCanvas.height;
    
    const fitZoom = Math.min(1.0, zoomX, zoomY);
    // Large-format artwork can require a zoom below 10%. Keep enough precision
    // that it still fits instead of rounding back up and overflowing the app.
    const finalZoom = Math.max(0.01, Math.floor(fitZoom * 1000) / 1000);
    
    onZoomChange(finalZoom);
  }, [artworkCanvas, bottomPadding, onZoomChange, topPadding]);

  const lastFileRef = useRef(null);
  const lastBoxInfoRef = useRef(null);

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
        const frameId = requestAnimationFrame(() => {
          requestAnimationFrame(handleFitToHeight);
        });
        lastFileRef.current = artworkFile;
        if (pdfBoxInfo) {
          lastBoxInfoRef.current = pdfBoxInfo;
        }
        return () => cancelAnimationFrame(frameId);
      }
    }
  }, [artworkCanvas, artworkFile, pdfBoxInfo, handleFitToHeight]);

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

  // Handle Mouse/Touch Move with Zoom Factor correction
  useEffect(() => {
    const handleMove = (e) => {
      if (!isDragging && !isResizing) return;
      const clientX = e.clientX || (e.touches && e.touches[0].clientX);
      const clientY = e.clientY || (e.touches && e.touches[0].clientY);
      const deltaX = (clientX - dragStart.x) / zoom;
      const deltaY = (clientY - dragStart.y) / zoom;
      
      if (isDragging) {
        let newLeft = bugStartPos.left + deltaX;
        let newTop = bugStartPos.top + deltaY;
        newLeft = snapValueToGrid(newLeft);
        newTop = snapValueToGrid(newTop);
        newLeft = Math.max(0, Math.min(newLeft, canvasWidth - size.width));
        newTop = Math.max(0, Math.min(newTop, canvasHeight - size.height));
        onPositionChange({ left: newLeft, top: newTop });
      }
      
      if (isResizing) {
        let newWidth = bugStartSize.width + deltaX;
        newWidth = Math.max(minWidthPx, Math.min(maxWidthPx, newWidth));
        const newHeight = newWidth / aspectRatio;
        if (position.left + newWidth <= canvasWidth && position.top + newHeight <= canvasHeight) {
          onSizeChange({ width: newWidth, height: newHeight });
        }
      }
    };

    const handleEnd = () => {
      if (isDragging) { setIsDragging(false); if (onDragEnd) onDragEnd(); }
      if (isResizing) { setIsResizing(false); if (onDragEnd) onDragEnd(); }
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
  }, [isDragging, isResizing, dragStart, bugStartPos, bugStartSize, aspectRatio, canvasWidth, canvasHeight, size, position, zoom, minWidthPx, maxWidthPx, snapValueToGrid, onPositionChange, onSizeChange, onDragEnd]);

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
            <div ref={canvasMountRef} className="artwork-canvas" style={{ pointerEvents: 'none' }} />

             {showGrid && (
                <div
                  className="placement-grid-overlay"
                  style={{
                    backgroundSize: `${gridSizePx}px ${gridSizePx}px`
                  }}
                />
             )}

             {/* 1. Trim Line / Cut Line Overlay (Anchored to Canvas) */}
             {showSafeLine && (
                <div 
                  style={{
                    position: 'absolute',
                    top: `${trimGuide.top}px`,
                    left: `${trimGuide.left}px`,
                    width: `${trimGuide.width}px`,
                    height: `${trimGuide.height}px`,
                    border: `2px solid ${pdfBoxInfo ? '#0055ff' : '#ff007f'}`,
                    pointerEvents: 'none',
                    zIndex: 2,
                    boxSizing: 'border-box'
                  }}
                />
             )}

             {/* 2. Safe Area Dot Line (Anchored to Canvas) */}
             {showSafeLine && (
                <div 
                  style={{
                    position: 'absolute',
                    top: `${safeGuide.top}px`,
                    left: `${safeGuide.left}px`,
                    width: `${safeGuide.width}px`,
                    height: `${safeGuide.height}px`,
                    border: '2px dashed #00c7e8',
                    pointerEvents: 'none',
                    zIndex: 2,
                    boxSizing: 'border-box'
                  }}
                />
             )}

             {/* 3. Interactive Crop Mode Overlay */}
             {isCropMode && (
                <div 
                  style={{
                    position: 'absolute',
                    top: `${manualCropGuides.top}px`,
                    left: `${manualCropGuides.left}px`,
                    width: `${canvasWidth - manualCropGuides.left - manualCropGuides.right}px`,
                    height: `${canvasHeight - manualCropGuides.top - manualCropGuides.bottom}px`,
                    border: '2px solid #f59e0b', // Orange crop box
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)', // Dim outside area
                    pointerEvents: 'none',
                    zIndex: 3,
                    boxSizing: 'border-box'
                  }}
                />
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
        <button className="zoom-btn" onClick={() => onZoomChange(Math.max(0.01, zoom - 0.1))} title="Zoom Out"><ZoomOut size={16} /></button>
        <span style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', minWidth: '45px', textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button className="zoom-btn" onClick={() => onZoomChange(Math.min(3.0, zoom + 0.1))} title="Zoom In"><ZoomIn size={16} /></button>
        <div style={{ width: '1px', height: '16px', background: 'var(--border-color)' }} />
        <button className="zoom-btn" onClick={handleFitToHeight} title="Fit to Screen"><Maximize2 size={15} /></button>
      </div>
    </div>
  );
}
