import { useState, useEffect, useCallback, useRef } from 'react';
import { FileText, Image as ImageIcon, Sparkles, ClipboardCheck, Sun, Moon, Monitor, UploadCloud, Info, ChevronDown } from 'lucide-react';
import UploadZone from './components/UploadZone';
import EditorCanvas from './components/EditorCanvas';
import ControlPanel from './components/ControlPanel';
import PageSelector from './components/PageSelector';
import PreflightPanel from './components/PreflightPanel';

import {
  loadPDF,
  getPDFBoxInfo,
  processUnionBug,
  stitchBugToPDF,
  stitchBugToImage,
  drawMirrorBleed
} from './utils/pdfProcessor';

import {
  runPreflightChecks,
  fixOverprint,
  fixHiddenLayers,
  fixBlankPage,
  fixRasterizePages
} from './utils/preflightChecker';

// Text detector logic removed

import {
  analyzeBackgroundLuminance,
  extractDominantColors
} from './utils/colorAnalyzer';

import './App.css';

// Helper to load an image file into an HTML Image element
const loadImageElement = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = reject;
      img.src = event.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
};

const downloadFile = (data, filename) => {
  const link = document.createElement('a');
  link.href = data instanceof Blob ? URL.createObjectURL(data) : data;
  link.download = filename;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  if (data instanceof Blob) {
    window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }
};

const LARGE_PDF_BROWSER_LIMIT_BYTES = 250 * 1024 * 1024;

export default function App() {
  // File states
  const [artworkFile, setArtworkFile] = useState(null);
  const [originalFile, setOriginalFile] = useState(null); // Keep a backup of the original upload
  const [bugFile, setBugFile] = useState(null);
  const [artworkType, setArtworkType] = useState('pdf'); // 'pdf' | 'image'
  
  // PDF manipulation proxies
  const [pdfDoc, setPdfDoc] = useState(null);
  const [pdfBoxInfo, setPdfBoxInfo] = useState(null); // Metadata dimensions (CropBox, TrimBox) of active PDF page
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const canvasScale = 1.5; // Default 1.5 for crisp canvas rendering
  
  // Rendered canvases
  const [artworkCanvas, setArtworkCanvas] = useState(null);
  const [bugCanvas, setBugCanvas] = useState(null);
  const [bugImageSrc, setBugImageSrc] = useState('');
  
  // Bug positioning & dimension states (in Canvas Pixels)
  const [bugPosition, setBugPosition] = useState({ left: 100, top: 100 });
  const [bugSize, setBugSize] = useState({ width: 48, height: 48 });
  
  // Page-specific bug configuration states to allow independent page positioning
  const [pagePositions, setPagePositions] = useState({}); // { [pageNum]: { left, top } }
  const [pageSizes, setPageSizes] = useState({});         // { [pageNum]: { width, height } }
  const [pageAlignments, setPageAlignments] = useState({}); // { [pageNum]: alignmentMode }
  
  const [bugBaseSize, setBugBaseSize] = useState({ width: 32, height: 32 }); // Base point size
  const [bugScale, setBugScale] = useState(100); // Percentage 10% - 300%

  // Track previous bugBaseSize to adjust bugScale during render if it changes
  const [prevBugBaseSize, setPrevBugBaseSize] = useState(bugBaseSize);

  // Calculate dynamic scale limits based on Union Bug base width (to enforce 0.2" to 2.0" limits)
  // 0.2" = 14.4pt, 2.0" = 144pt. minScale = 1440/width, maxScale = 14400/width.
  const minScale = bugBaseSize && bugBaseSize.width ? Math.round(1440 / bugBaseSize.width) : 10;
  const maxScale = bugBaseSize && bugBaseSize.width ? Math.round(14400 / bugBaseSize.width) : 300;

  // Clamp bugScale during render if bugBaseSize changes and scale goes out of bounds
  if (bugBaseSize.width !== prevBugBaseSize.width || bugBaseSize.height !== prevBugBaseSize.height) {
    setPrevBugBaseSize(bugBaseSize);
    if (bugScale < minScale) {
      setBugScale(minScale);
    } else if (bugScale > maxScale) {
      setBugScale(maxScale);
    }
  }

  const [showSafeLine, setShowSafeLine] = useState(true);
  const [showGrid, setShowGrid] = useState(false);
  const [snapToGrid, setSnapToGrid] = useState(false);
  const [gridSize, setGridSize] = useState(0.125); // Inches

  // Bleed settings
  const [bleedEnabled, setBleedEnabled] = useState(false);
  const [bleedAmount, setBleedAmount] = useState(9.0); // Default 0.125" in PDF points
  const [trimCropEnabled, setTrimCropEnabled] = useState(false); // New non-destructive crop toggle
  const [manualCropAmount, setManualCropAmount] = useState(0); // Manual inset in points (72pt = 1 inch)
  const [isCropMode] = useState(false); // Interactive visual crop mode disabled
  const [manualCropGuides] = useState({ top: 0, right: 0, bottom: 0, left: 0 });

  const [sourceHasBleed, setSourceHasBleed] = useState(true); // Default true for PDFs (0.125" / 9pt bleed included)
  const [originalImage, setOriginalImage] = useState(null); // Keeps the original Image element for reactive image bleed redraws

  // Bug overlay enable toggle (allows bleed-only processing)
  const [bugEnabled, setBugEnabled] = useState(false);

  // Quick alignment state ('left' | 'center' | 'right' | 'custom')
  const [currentAlignment, setCurrentAlignment] = useState('right');

  // Canvas zoom state
  const [zoom, setZoom] = useState(0.7);

  // Color states
  const [colorMode, setColorMode] = useState('auto'); // 'auto' | 'preset' | 'custom'
  const [selectedColor, setSelectedColor] = useState('#000000');
  const [recommendedColor, setRecommendedColor] = useState('#000000'); // Contrast-calculated auto color
  const [extractedColors, setExtractedColors] = useState(['#000000', '#ffffff', '#a855f7', '#14b8a6', '#ef4444']);

  // Loading States
  const [isLoading, setIsLoading] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Preflight states
  const [activeSidebarTab, setActiveSidebarTab] = useState('preflight'); // 'preflight' is default active tab
  const [preflightResults, setPreflightResults] = useState(null);
  
  // Theme state
  const [theme, setTheme] = useState(() => localStorage.getItem('theme') || 'system');
  
  // Global drag-and-drop state
  const [isGlobalDragActive, setIsGlobalDragActive] = useState(false);
  const dragCounter = useRef(0);
  const artworkLoadRequestIdRef = useRef(0);
  const renderRequestIdRef = useRef(0);
  const pdfPageCanvasCacheRef = useRef(new Map());
  
  // Multi-page options
  const [multiPageOptions, setMultiPageOptions] = useState({
    applyTo: 'current', // 'current' | 'all' | 'last' | 'first'
  });

  // Track if we completed the initial alignment placement for a newly loaded artwork
  const [hasDoneInitialAlignment, setHasDoneInitialAlignment] = useState(false);

  // Collapsible page thumbnails strip state
  const [isThumbnailsExpanded, setIsThumbnailsExpanded] = useState(false);
  const [isGeometryExpanded, setIsGeometryExpanded] = useState(false);

  // Safe zone is ALWAYS 9pt (0.125") inside the trim/cut line — hardcoded, not adjustable
  const pdfHasIncludedBleed = artworkType === 'pdf' && Boolean(pdfBoxInfo?.hasDistinctBleedBox);
  const effectiveBleedAmount = bleedEnabled ? bleedAmount : 0;

  // Utility to format PDF points (pt) into physical dimensions (inches & millimeters)
  const formatPtToPhysical = (width, height) => {
    if (!width || !height) return 'N/A';
    const wInch = (width / 72).toFixed(2);
    const hInch = (height / 72).toFixed(2);
    const wMm = (width * 0.352778).toFixed(1);
    const hMm = (height * 0.352778).toFixed(1);
    return `${wInch}" x ${hInch}" (${wMm} x ${hMm} mm)`;
  };

  const geometryDetails = pdfBoxInfo ? (() => {
    // Professional PDF page boxes describe the intended physical product
    // independently of render/crop controls. Prefer explicit boxes only when
    // they are genuinely distinct; crop guides are a fallback.
    const hasMetadataTrim = pdfBoxInfo.hasDistinctTrimBox;
    const hasMetadataBleed = hasMetadataTrim && pdfBoxInfo.hasDistinctBleedBox;
    const baseBox = hasMetadataTrim ? pdfBoxInfo.trimBox : pdfBoxInfo.cropBox;
    const manualInset = manualCropAmount || 0;

    let finalTrimW = baseBox.width - (manualInset * 2);
    let finalTrimH = baseBox.height - (manualInset * 2);

    if (!hasMetadataTrim && isCropMode && manualCropGuides) {
      const guideLeftPt = manualCropGuides.left / canvasScale;
      const guideRightPt = manualCropGuides.right / canvasScale;
      const guideTopPt = manualCropGuides.top / canvasScale;
      const guideBottomPt = manualCropGuides.bottom / canvasScale;
      finalTrimW -= (guideLeftPt + guideRightPt);
      finalTrimH -= (guideTopPt + guideBottomPt);
    }

    finalTrimW = Math.max(1, finalTrimW);
    finalTrimH = Math.max(1, finalTrimH);

    const outputBaseBox = bleedEnabled && !trimCropEnabled
      ? pdfBoxInfo.cropBox
      : baseBox;
    let finalCanvasW = Math.max(1, outputBaseBox.width - (manualInset * 2));
    let finalCanvasH = Math.max(1, outputBaseBox.height - (manualInset * 2));
    let bleedLabel = 'None';

    if (bleedEnabled) {
      finalCanvasW += bleedAmount * 2;
      finalCanvasH += bleedAmount * 2;
      bleedLabel = `${(bleedAmount / 72).toFixed(3)}" Output`;
    } else if (hasMetadataBleed) {
      const horizontalBleed = pdfBoxInfo.bleedInsets.left + pdfBoxInfo.bleedInsets.right;
      const verticalBleed = pdfBoxInfo.bleedInsets.top + pdfBoxInfo.bleedInsets.bottom;
      finalCanvasW += horizontalBleed;
      finalCanvasH += verticalBleed;

      const bleedValues = Object.values(pdfBoxInfo.bleedInsets);
      const uniformBleed = bleedValues.every(
        (value) => Math.abs(value - bleedValues[0]) < 0.01
      );
      bleedLabel = uniformBleed
        ? `${(bleedValues[0] / 72).toFixed(3)}" Included`
        : 'Variable Included';
    }

    return {
      canvas: formatPtToPhysical(finalCanvasW, finalCanvasH),
      trim: formatPtToPhysical(finalTrimW, finalTrimH),
      bleed: bleedLabel,
      page: `${currentPage} / ${totalPages}`
    };
  })() : null;



  // Auto-load default Union Bug from public directory on mount
  useEffect(() => {
    const loadDefaultBug = async () => {
      try {
        const response = await fetch(`${import.meta.env.BASE_URL}union-bug-black.pdf`);
        if (!response.ok) throw new Error('Default union bug not found');
        const blob = await response.blob();
        const file = new File([blob], 'union-bug-black.pdf', { type: 'application/pdf' });
        
        // Parse original size
        const bugDoc = await loadPDF(file);
        const bugPage = await bugDoc.getPage(1);
        const viewport = bugPage.getViewport({ scale: 1.0 });
        
        setBugFile(file);
        setBugBaseSize({
          width: viewport.width,
          height: viewport.height
        });
      } catch (error) {
        console.error('Error pre-loading default Union Bug:', error);
      }
    };
    
    loadDefaultBug();
  }, []);

  const resetUnionBugSettings = useCallback(() => {
    setBugEnabled(false);
    setBugPosition({ left: 100, top: 100 });
    setBugScale(100);
    setColorMode('auto');
    setSelectedColor('#000000');
    setRecommendedColor('#000000');
    setShowGrid(false);
    setSnapToGrid(false);
    setGridSize(0.125);
    setCurrentAlignment('right');
    setPagePositions({});
    setPageSizes({});
    setPageAlignments({});
    setMultiPageOptions({ applyTo: 'current' });
    setHasDoneInitialAlignment(false);
  }, []);

  // 1. Handle Artwork File Upload
  const handleArtworkSelect = useCallback(async (file) => {
    const requestId = artworkLoadRequestIdRef.current + 1;
    artworkLoadRequestIdRef.current = requestId;
    renderRequestIdRef.current += 1;

    setIsLoading(true);
    resetUnionBugSettings();
    setArtworkFile(file);
    setOriginalFile(file); // Store initial upload as backup
    setArtworkCanvas(null);
    setPdfDoc(null);
    setOriginalImage(null);
    setPdfBoxInfo(null);
    setPreflightResults(null);
    setTotalPages(1);
    setCurrentPage(1);
    pdfPageCanvasCacheRef.current.clear();
    
    try {
      const extension = file.name.split('.').pop().toLowerCase();
      
      if (extension === 'pdf') {
        setArtworkType('pdf');
        setSourceHasBleed(true); // PDFs are typically print-ready with 0.125" bleed
        const doc = await loadPDF(file);
        if (requestId !== artworkLoadRequestIdRef.current) return;
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setCurrentPage(1);
      } else {
        setArtworkType('image');
        setSourceHasBleed(false); // Images typically don't have bleed included
        setPdfDoc(null);
        setTotalPages(1);
        setCurrentPage(1);
        const img = await loadImageElement(file);
        if (requestId !== artworkLoadRequestIdRef.current) return;
        setOriginalImage(img);
      }
    } catch (error) {
      if (requestId !== artworkLoadRequestIdRef.current) return;
      console.error('Error loading artwork file:', error);
      alert('Error loading artwork file.');
      setArtworkFile(null);
    } finally {
      if (requestId === artworkLoadRequestIdRef.current) {
        setIsLoading(false);
      }
    }
  }, [resetUnionBugSettings]);

  // Handle Theme Switching (Light / Dark / System)
  useEffect(() => {
    const applyTheme = (themeValue) => {
      let resolvedTheme = themeValue;
      if (themeValue === 'system') {
        const isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        resolvedTheme = isDark ? 'dark' : 'light';
      }
      document.documentElement.setAttribute('data-theme', resolvedTheme);
    };

    applyTheme(theme);
    localStorage.setItem('theme', theme);

    if (theme === 'system') {
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
      const handleChange = () => applyTheme('system');
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
  }, [theme]);

  // Handle Global Drag-and-Drop
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
      setIsGlobalDragActive(true);
    }
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      setIsGlobalDragActive(false);
    }
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    setIsGlobalDragActive(false);
    dragCounter.current = 0;
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const file = e.dataTransfer.files[0];
      handleArtworkSelect(file);
      e.dataTransfer.clearData();
    }
  }, [handleArtworkSelect]);

  useEffect(() => {
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('dragenter', handleDragEnter);
      window.removeEventListener('dragleave', handleDragLeave);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('drop', handleDrop);
    };
  }, [handleDragEnter, handleDragLeave, handleDragOver, handleDrop]);

  // Clears the artwork state
  const handleClearArtwork = () => {
    artworkLoadRequestIdRef.current += 1;
    renderRequestIdRef.current += 1;
    setArtworkFile(null);
    setOriginalFile(null);
    setArtworkCanvas(null);
    setPdfDoc(null);
    setPdfBoxInfo(null);
    setOriginalImage(null);
    setBugPosition({ left: 100, top: 100 });
    setPagePositions({});
    setPageSizes({});
    setPageAlignments({});
    setHasDoneInitialAlignment(false);
    pdfPageCanvasCacheRef.current.clear();
  };

  // Resets the current artwork back to the original uploaded file (undo all preflight fixes/crops)
  const handleResetArtwork = async () => {
    if (!originalFile) return;
    
    setIsLoading(true);
    try {
      setArtworkFile(originalFile);
      
      const extension = originalFile.name.split('.').pop().toLowerCase();
      
      if (extension === 'pdf') {
        setArtworkType('pdf');
        const doc = await loadPDF(originalFile);
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setCurrentPage(1);
        pdfPageCanvasCacheRef.current.clear();
      } else {
        setArtworkType('image');
        setPdfDoc(null);
        setTotalPages(1);
        setCurrentPage(1);
        const img = await loadImageElement(originalFile);
        setOriginalImage(img);
      }
      
      // Reset common states
      setBleedEnabled(false);
      setTrimCropEnabled(false);
      setManualCropAmount(0);
      setSourceHasBleed(extension === 'pdf');
    } catch (error) {
      console.error('Error resetting artwork:', error);
      alert('Error resetting artwork.');
    } finally {
      setIsLoading(false);
    }
  };

  // Clears the union bug state
  const handleClearBug = () => {
    setBugFile(null);
    setBugCanvas(null);
    setBugImageSrc('');
    setBugPosition({ left: 100, top: 100 });
    setPagePositions({});
    setPageSizes({});
    setPageAlignments({});
    setHasDoneInitialAlignment(false);
  };



  const getCachedPDFPageCanvas = async (doc, pageNum) => {
    const cacheKey = `${pageNum}:${canvasScale}`;
    const cached = pdfPageCanvasCacheRef.current.get(cacheKey);
    if (cached) return cached;

    const page = await doc.getPage(pageNum);
    const viewport = page.getViewport({ scale: canvasScale });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    pdfPageCanvasCacheRef.current.set(cacheKey, canvas);
    return canvas;
  };

  const buildProcessedCanvas = (source, bleed, selectedBleedAmount = 0, crop = null) => {
    const cropLeft = Math.max(0, Math.round(crop?.left || 0));
    const cropTop = Math.max(0, Math.round(crop?.top || 0));
    const cropRight = Math.max(0, Math.round(crop?.right || 0));
    const cropBottom = Math.max(0, Math.round(crop?.bottom || 0));
    const sourceW = source.width || source.naturalWidth;
    const sourceH = source.height || source.naturalHeight;
    const finalW = Math.max(1, sourceW - cropLeft - cropRight);
    const finalH = Math.max(1, sourceH - cropTop - cropBottom);
    const bleedPx = Math.round((bleed ? selectedBleedAmount : 0) * canvasScale);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(finalW + (bleedPx * 2));
    canvas.height = Math.round(finalH + (bleedPx * 2));
    const ctx = canvas.getContext('2d');

    if (bleedPx > 0) {
      const croppedTemp = document.createElement('canvas');
      croppedTemp.width = Math.round(finalW);
      croppedTemp.height = Math.round(finalH);
      const tempCtx = croppedTemp.getContext('2d');
      tempCtx.drawImage(source, cropLeft, cropTop, finalW, finalH, 0, 0, finalW, finalH);
      drawMirrorBleed(ctx, croppedTemp, finalW, finalH, bleedPx);
    } else {
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(source, cropLeft, cropTop, finalW, finalH, 0, 0, finalW, finalH);
    }

    return canvas;
  };

  const getPDFCropInsets = (boxInfo, trimCrop, manualCrop) => {
    const manualCropPx = Math.max(0, manualCrop * canvasScale);
    const crop = {
      left: manualCropPx,
      top: manualCropPx,
      right: manualCropPx,
      bottom: manualCropPx
    };

    if (trimCrop && boxInfo?.trimBox && boxInfo?.cropBox) {
      const { trimBox, cropBox } = boxInfo;
      crop.left += (trimBox.x - cropBox.x) * canvasScale;
      crop.right += ((cropBox.x + cropBox.width) - (trimBox.x + trimBox.width)) * canvasScale;
      crop.bottom += (trimBox.y - cropBox.y) * canvasScale;
      crop.top += (cropBox.height - (trimBox.y - cropBox.y + trimBox.height)) * canvasScale;
    }

    return crop;
  };

  // Render a specific PDF page to canvas (called reactively)
  const renderPage = async (doc, pageNum, bleedAmount = 0, trimCrop = false, boxInfo = null, manualCrop = 0, requestId = renderRequestIdRef.current) => {
    try {
      const baseCanvas = await getCachedPDFPageCanvas(doc, pageNum);
      if (requestId !== renderRequestIdRef.current) return;

      let activeBoxInfo = boxInfo;
      if (artworkFile && (!activeBoxInfo || activeBoxInfo.pageNum !== pageNum)) {
        activeBoxInfo = await getPDFBoxInfo(artworkFile, pageNum);
        if (requestId !== renderRequestIdRef.current) return;
        setPdfBoxInfo(activeBoxInfo ? { ...activeBoxInfo, pageNum } : null);
      }

      const crop = getPDFCropInsets(activeBoxInfo, trimCrop, manualCrop);
      const canvas = buildProcessedCanvas(baseCanvas, bleedAmount > 0, bleedAmount, crop);
      setArtworkCanvas(canvas);

      const colors = extractDominantColors(canvas, true);
      setExtractedColors(colors);
    } catch (error) {
      console.error(`Error rendering PDF page ${pageNum}:`, error);
    }
  };

  // Helper to render an image artwork to canvas with or without mirror bleed (called reactively)
  const renderImageCanvas = (img, bleed, selectedBleedAmount = 9.0, manualCrop = 0) => {
    const manualCropPx = Math.max(0, manualCrop * canvasScale);
    const canvas = buildProcessedCanvas(img, bleed, selectedBleedAmount, {
      left: manualCropPx,
      top: manualCropPx,
      right: manualCropPx,
      bottom: manualCropPx
    });
    
    setArtworkCanvas(canvas);
    
    // Extract dominant colors
    const colors = extractDominantColors(canvas, true);
    setExtractedColors(colors);
  };

  // Reactive Effect: Re-renders the artwork canvas when page, doc, bleed, image, trimCrop, or manualCrop changes
  useEffect(() => {
    if (!artworkFile) return;
    
    const updateArtworkRender = async () => {
      const requestId = renderRequestIdRef.current + 1;
      renderRequestIdRef.current = requestId;
      setIsLoading(true);
      try {
        if (artworkType === 'pdf' && pdfDoc) {
          await renderPage(pdfDoc, currentPage, effectiveBleedAmount, trimCropEnabled, pdfBoxInfo, manualCropAmount, requestId);
        } else if (artworkType === 'image' && originalImage) {
          renderImageCanvas(originalImage, bleedEnabled, bleedAmount, manualCropAmount);
        }
      } catch (error) {
        console.error('Error updating artwork render:', error);
      } finally {
        if (requestId === renderRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    };
    
    updateArtworkRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBleedAmount, bleedEnabled, bleedAmount, trimCropEnabled, manualCropAmount, currentPage, originalImage, pdfDoc, pdfBoxInfo]);

  // 2. Handle Union Bug File Upload
  const handleBugSelect = async (file) => {
    setIsLoading(true);
    setBugFile(file);
    try {
      // Load PDF bug to find its original scale / aspect ratio
      const bugDoc = await loadPDF(file);
      const bugPage = await bugDoc.getPage(1);
      const viewport = bugPage.getViewport({ scale: 1.0 });
      
      setBugBaseSize({
        width: viewport.width,
        height: viewport.height
      });
    } catch (error) {
      console.error('Error parsing Union Bug PDF:', error);
      alert('Error loading Union Bug PDF.');
      setBugFile(null);
    } finally {
      setIsLoading(false);
    }
  };

  // 3. Keep Bug Sizing updated as scale or artwork updates
  useEffect(() => {
    if (!artworkCanvas) return;
    
    // Scale points to pixels in editor canvas
    const wPx = bugBaseSize.width * (bugScale / 100) * canvasScale;
    const hPx = bugBaseSize.height * (bugScale / 100) * canvasScale;
    
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBugSize({ width: wPx, height: hPx });
  }, [bugScale, bugBaseSize, canvasScale, artworkCanvas]);

  // 4. Reprocess Union Bug Canvas when bugFile, color, scale change
  useEffect(() => {
    if (!bugFile) return;

    const activeColor = colorMode === 'auto' ? recommendedColor : selectedColor;

    const renderAndColorBug = async () => {
      try {
        // Preview rendering resolution increased to 8.0 DPI (approx. 600 DPI equivalent) to maintain crisp vector sharpness even when zoomed in.
        const { canvas } = await processUnionBug(bugFile, activeColor, 8.0);
        setBugCanvas(canvas);
        setBugImageSrc(canvas.toDataURL('image/png'));
      } catch (error) {
        console.error('Error color-tinting Union Bug:', error);
      }
    };

    renderAndColorBug();
  }, [bugFile, colorMode, selectedColor, recommendedColor]);

  // 5. Contrast Sampler: calculate background luminance at current position
  const runContrastAnalysis = () => {
    if (!artworkCanvas || !bugSize || !bugEnabled) return;

    // Check luminance at current bug coordinates
    const analysis = analyzeBackgroundLuminance(
      artworkCanvas,
      bugPosition.left,
      bugPosition.top,
      bugSize.width,
      bugSize.height
    );

    // If background is dark, recommend white bug. If light, recommend black.
    const autoColor = analysis.isDark ? '#ffffff' : '#000000';
    setRecommendedColor(autoColor);
  };

  // Execute contrast analysis whenever the position or page changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    runContrastAnalysis();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bugPosition, bugSize, artworkCanvas, bugEnabled]);

  useEffect(() => {
    if (!artworkFile || artworkType !== 'pdf' || !pdfDoc) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreflightResults(null);
    }
  }, [artworkFile, pdfDoc, artworkType]);

  const handleRunFullPreflight = useCallback(async () => {
    if (!artworkFile || artworkType !== 'pdf' || !pdfDoc) return;

    setIsScanning(true);
    try {
      const results = await runPreflightChecks(artworkFile, pdfDoc);
      setPreflightResults(results);
    } catch (err) {
      console.error('Error running preflight checks:', err);
    } finally {
      setIsScanning(false);
    }
  }, [artworkFile, pdfDoc, artworkType]);

  // Handler for Preflight Auto-Fixes
  const handlePreflightFix = async (checkKey) => {
    if (!artworkFile) return;
    setIsLoading(true);
    try {
      const arrayBuffer = await artworkFile.arrayBuffer();
      let updatedBytes = null;

      if (checkKey === 'bleed') {
        // Fix Bleed: Enable mirror bleed in settings
        setBleedEnabled(true);
        setSourceHasBleed(false);
        setIsLoading(false);
        return;
      } else if (checkKey === 'overprint') {
        updatedBytes = await fixOverprint(arrayBuffer);
      } else if (checkKey === 'hiddenLayers') {
        updatedBytes = await fixHiddenLayers(arrayBuffer);
      } else if (checkKey === 'blankPages') {
        const blankPages = preflightResults?.checks?.blankPages?.value || [];
        if (blankPages.length === 0) return;
        const pageToRemove = blankPages[0];
        updatedBytes = await fixBlankPage(arrayBuffer, pageToRemove);
        if (currentPage >= pageToRemove && currentPage > 1) {
          setCurrentPage(prev => prev - 1);
        }
      } else if (checkKey === 'fontEmbedding' || checkKey === 'spotColors') {
        // Rasterize pages to flatten spot colors and outline fonts
        const pagesToFix = Array.from({ length: totalPages }, (_, i) => i + 1);
        updatedBytes = await fixRasterizePages(arrayBuffer, pdfDoc, pagesToFix);
      }

      if (updatedBytes) {
        const correctedBlob = new Blob([updatedBytes], { type: 'application/pdf' });
        const correctedFile = new File([correctedBlob], artworkFile.name, { type: 'application/pdf' });
        
        // Re-load corrected PDF
        setArtworkFile(correctedFile);
        const doc = await loadPDF(correctedFile);
        setPdfDoc(doc);
        setTotalPages(doc.numPages);

        // Re-run preflight scan to update the UI status
        setIsScanning(true);
        try {
          const results = await runPreflightChecks(correctedFile, doc);
          setPreflightResults(results);
        } catch (scanErr) {
          console.error('Error re-scanning after fix:', scanErr);
        } finally {
          setIsScanning(false);
        }
      }
    } catch (error) {
      console.error(`Error fixing preflight check ${checkKey}:`, error);
      alert(`Error fixing issue: ${error.message || 'Unknown error'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 6. Quick Alignment Logic
  const handleQuickAlign = useCallback((alignment) => {
    if (!artworkCanvas || !bugSize) return;

    const virtualBleedPx = effectiveBleedAmount * canvasScale;
    const metadataInsets = pdfBoxInfo?.hasDistinctTrimBox && !trimCropEnabled
      ? {
          left: Math.max(0, (pdfBoxInfo.trimInsets.left - manualCropAmount) * canvasScale),
          right: Math.max(0, (pdfBoxInfo.trimInsets.right - manualCropAmount) * canvasScale),
          top: Math.max(0, (pdfBoxInfo.trimInsets.top - manualCropAmount) * canvasScale),
          bottom: Math.max(0, (pdfBoxInfo.trimInsets.bottom - manualCropAmount) * canvasScale)
        }
      : { left: 0, right: 0, top: 0, bottom: 0 };
    const cropInsets = isCropMode ? manualCropGuides : metadataInsets;
    const safeInsetPx = 9.0 * canvasScale;
    const safeLeftPx = virtualBleedPx + cropInsets.left + safeInsetPx;
    const safeTopPx = virtualBleedPx + cropInsets.top + safeInsetPx;
    const safeWidthPx = Math.max(
      0,
      artworkCanvas.width - (virtualBleedPx * 2) - cropInsets.left - cropInsets.right - (safeInsetPx * 2)
    );
    const safeHeightPx = Math.max(
      0,
      artworkCanvas.height - (virtualBleedPx * 2) - cropInsets.top - cropInsets.bottom - (safeInsetPx * 2)
    );

    let left = 100;
    if (alignment === 'left') {
      left = safeLeftPx;
    } else if (alignment === 'center') {
      left = safeLeftPx + (safeWidthPx / 2) - (bugSize.width / 2);
    } else if (alignment === 'right') {
      left = safeLeftPx + safeWidthPx - bugSize.width;
    }

    setBugPosition((prev) => {
      const defaultTop = safeTopPx + safeHeightPx - bugSize.height;
      const useDefault = !hasDoneInitialAlignment || !prev || (prev.left === 100 && prev.top === 100);
      const top = useDefault ? defaultTop : prev.top;
      const nextPos = { left, top };
      setPagePositions(p => ({ ...p, [currentPage]: nextPos }));
      return nextPos;
    });
    setPageSizes(s => ({ ...s, [currentPage]: bugSize }));
    if (alignment !== 'custom') {
      setPageAlignments(a => ({ ...a, [currentPage]: alignment }));
    }

    if (alignment !== 'custom') {
      setCurrentAlignment(alignment);
    }
  }, [artworkCanvas, bugSize, effectiveBleedAmount, canvasScale, hasDoneInitialAlignment, pdfBoxInfo, currentPage, trimCropEnabled, manualCropAmount, isCropMode, manualCropGuides]);

  // Automatically align bug if alignment mode is active (not custom)
  useEffect(() => {
    if (artworkCanvas && bugSize) {
      if (!hasDoneInitialAlignment) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        handleQuickAlign('right');
        setHasDoneInitialAlignment(true);
      } else if (currentAlignment !== 'custom') {
        handleQuickAlign(currentAlignment);
      }
    }
  }, [currentAlignment, bleedEnabled, bleedAmount, sourceHasBleed, bugSize, artworkCanvas, hasDoneInitialAlignment, handleQuickAlign]);

  // Drag End handler to set custom alignment status
  const handleDragEnd = () => {
    setCurrentAlignment('custom');
    runContrastAnalysis();
  };

  // Page Switcher for PDFs
  const handlePageChange = async (newPage) => {
    if (newPage < 1 || newPage > totalPages) return;

    // Cache current page state to coordinates maps before shifting
    setPagePositions(prev => ({ ...prev, [currentPage]: bugPosition }));
    setPageSizes(prev => ({ ...prev, [currentPage]: bugSize }));
    setPageAlignments(prev => ({ ...prev, [currentPage]: currentAlignment }));

    setIsLoading(true);
    setCurrentPage(newPage);
    try {
      // PDF re-rendering will be automatically fired by reactive useEffect!
      const savedPos = pagePositions[newPage];
      const savedSize = pageSizes[newPage];
      const savedAlign = pageAlignments[newPage];

      if (savedPos && savedSize) {
        // Restore this page's configured coordinate specifications
        setBugPosition(savedPos);
        setBugSize(savedSize);
        setCurrentAlignment(savedAlign || 'custom');
        
        // Also restore scale slider state
        const baseWidthPx = bugBaseSize.width * canvasScale;
        if (baseWidthPx > 0) {
          const calculatedScale = Math.round((savedSize.width / baseWidthPx) * 100);
          const clampedScale = Math.max(minScale, Math.min(maxScale, calculatedScale));
          setBugScale(clampedScale);
        }
      } else {
        // Bootstrap target page with current specifications so it does not reset,
        // but remains independent for individual page adjustments.
        setPagePositions(prev => ({ ...prev, [newPage]: bugPosition }));
        setPageSizes(prev => ({ ...prev, [newPage]: bugSize }));
        setPageAlignments(prev => ({ ...prev, [newPage]: currentAlignment }));
      }
    } catch (error) {
      console.error('Page switch error:', error);
    } finally {
      setIsLoading(false);
    }
  };

  // Universal Export Handler (Handles both Stamper and Preflight-only exports)
  const handleUniversalExport = async () => {
    if (!artworkFile || !artworkCanvas) return;
    
    setIsExporting(true);
    
    try {
      const safeFilename = artworkFile.name.replace(/\.[^/.]+$/, "") + (bugEnabled ? '_Proof' : '_Fixed');

      if (bugEnabled && !bugFile) {
        throw new Error('Union Bug PDF is not loaded. Upload a Union Bug PDF or reload the app before saving.');
      }
      
      if (artworkType === 'pdf') {
        const activeBleedAmount = bleedEnabled ? bleedAmount : 0;

        if (artworkFile.size > LARGE_PDF_BROWSER_LIMIT_BYTES) {
          const sizeMb = Math.round(artworkFile.size / (1024 * 1024));
          throw new Error(
            `This PDF is ${sizeMb} MB, which is too large for browser-based PDF export. Use the local large-PDF workflow instead.`
          );
        }

        // Resolve target pages to stamp
        let pagesToStitch = [];
        if (!bugEnabled) {
          // If bug is disabled, we don't stitch anything, but we might still apply mirror bleed
          pagesToStitch = [];
        } else if (multiPageOptions.applyTo === 'current') {
          pagesToStitch = [currentPage];
        } else if (multiPageOptions.applyTo === 'all') {
          pagesToStitch = Array.from({ length: totalPages }, (_, i) => i + 1);
        } else if (multiPageOptions.applyTo === 'last') {
          pagesToStitch = [totalPages];
        } else if (multiPageOptions.applyTo === 'first') {
          pagesToStitch = [1];
        }
        
        const activeColor = colorMode === 'auto' ? recommendedColor : selectedColor;
        const finalPositions = { ...pagePositions, [currentPage]: bugPosition };
        const finalSizes = { ...pageSizes, [currentPage]: bugSize };

        const outputBytes = await stitchBugToPDF(
          artworkFile,
          bugFile,
          activeColor,
          bugPosition,
          bugSize,
          canvasScale,
          pagesToStitch,
          currentPage,
          activeBleedAmount, // Pass bleed amount (in points)
          bugEnabled,  // Pass toggle state
          finalPositions,
          finalSizes,
          trimCropEnabled, // Pass non-destructive toggle
          manualCropAmount, // Pass manual inset
          isCropMode,
          manualCropGuides
        );
        
        const blob = new Blob([outputBytes], { type: 'application/pdf' });
        downloadFile(blob, `${safeFilename}.pdf`);
      } else {
        // Image export (pass bleed in pixels)
        const activeBleedAmount = bleedEnabled ? bleedAmount : 0;
        const bleedPx = activeBleedAmount * canvasScale;
        const finalImageDataUrl = stitchBugToImage(
          artworkCanvas,
          bugCanvas,
          bugPosition,
          bugSize,
          bleedPx,
          bugEnabled // Pass toggle state
        );
        
        downloadFile(finalImageDataUrl, `${safeFilename}.png`);
      }
    } catch (error) {
      console.error('Export error:', error);
      alert(error?.message || 'Error saving file.');
    } finally {
      setIsExporting(false);
    }
  };

  // Color options switcher
  const handleColorModeChange = (mode) => {
    setColorMode(mode);
    if (mode === 'preset') {
      setSelectedColor(extractedColors[0] || '#000000');
    }
  };

  return (
    <div className="app-container">
      {/* Premium Glassmorphic Header */}
      <header className="app-header">
        <div className="logo-section" onClick={handleClearArtwork} style={{ cursor: 'pointer' }} title="Go to Homepage">
          <img src="/favicon.png" alt="Logo" style={{ height: '28px', width: '28px', borderRadius: '50%' }} className="logo-icon" />
          <h1>Overnight Preflight Tool</h1>
          <span className="logo-badge">v{import.meta.env.VITE_APP_VERSION}</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Theme switcher */}
          <div className="theme-switcher">
            <button 
              className={`theme-btn ${theme === 'light' ? 'active' : ''}`} 
              onClick={() => setTheme('light')}
              title="Light Mode"
              style={{ padding: '6px' }}
            >
              <Sun size={14} />
            </button>
            <button 
              className={`theme-btn ${theme === 'dark' ? 'active' : ''}`} 
              onClick={() => setTheme('dark')}
              title="Dark Mode"
              style={{ padding: '6px' }}
            >
              <Moon size={14} />
            </button>
            <button 
              className={`theme-btn ${theme === 'system' ? 'active' : ''}`} 
              onClick={() => setTheme('system')}
              title="System Default"
            >
              <Monitor size={14} />
              <span>Auto</span>
            </button>
          </div>

        </div>
      </header>

      {/* Main Workspace */}
      <main className="workspace">
        {!artworkFile ? (
          /* Empty / Upload State */
          <div className="upload-screen">
            <div className="upload-panel">
              <h3 style={{ fontSize: '20px', fontWeight: '700', marginBottom: '16px', textAlign: 'center' }}>Upload Your Artwork</h3>
              <UploadZone
                label="Artwork File"
                accept=".pdf,.png,.jpg,.jpeg"
                onFileSelect={handleArtworkSelect}
                selectedFile={artworkFile}
                description="PDF, PNG, JPG, or JPEG"
                icon={ImageIcon}
              />
            </div>
          </div>
        ) : (
          /* Editor State */
          <>
            {/* 1. Canvas Area */}
            <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
              {/* Compact PDF Geometry Summary */}
              {geometryDetails && (
                <div className={`pdf-geometry-info-card ${isGeometryExpanded ? 'expanded' : ''}`}>
                  <button
                    type="button"
                    className="geometry-summary-bar"
                    onClick={() => setIsGeometryExpanded((value) => !value)}
                    aria-expanded={isGeometryExpanded}
                    aria-label="Toggle PDF geometry details"
                  >
                    <Info size={14} />
                    <span><strong>Trim</strong> {geometryDetails.trim}</span>
                    <span><strong>Bleed</strong> {geometryDetails.bleed}</span>
                    <span><strong>Page</strong> {geometryDetails.page}</span>
                    <ChevronDown size={15} className="geometry-chevron" />
                  </button>

                  {isGeometryExpanded && (
                    <div className="geometry-detail-panel">
                      <div className="info-item">
                        <span className="info-label">Final Canvas (Crop)</span>
                        <span className="info-val" title={geometryDetails.canvas}>
                          {geometryDetails.canvas}
                        </span>
                      </div>
                      <div className="info-item trim-info">
                        <span className="info-label">Final Trim (Size)</span>
                        <span className="info-val" title={geometryDetails.trim}>
                          {geometryDetails.trim}
                        </span>
                      </div>
                      <div className="info-item bleed-info">
                        <span className="info-label">Bleed Margin</span>
                        <span className="info-val">
                          {geometryDetails.bleed}
                        </span>
                      </div>
                      <div className="info-item">
                        <span className="info-label">Page</span>
                        <span className="info-val page-info">
                          {geometryDetails.page} Page
                        </span>
                      </div>
                    </div>
                  )}
                </div>
              )}

              <EditorCanvas
                artworkCanvas={artworkCanvas}
                artworkFile={artworkFile}
                bugImageSrc={bugImageSrc}
                position={bugPosition}
                size={bugSize}
                canvasScale={canvasScale}
                pdfBoxInfo={pdfBoxInfo}
                sourceHasBleed={sourceHasBleed}
                showSafeLine={showSafeLine}
                bleedEnabled={bleedEnabled} // Draw actual Magenta Trim Line
                bleedAmount={effectiveBleedAmount}
                trimCropEnabled={trimCropEnabled}
                manualCropAmount={manualCropAmount}
                isCropMode={isCropMode}
                manualCropGuides={manualCropGuides}
                bugEnabled={bugEnabled}
                showGrid={showGrid}
                snapToGrid={snapToGrid}
                gridSize={gridSize}
                zoom={zoom}
                onZoomChange={setZoom}
                onPositionChange={(pos) => {
                  setCurrentAlignment('custom');
                  setBugPosition(pos);
                  setPagePositions(prev => ({ ...prev, [currentPage]: pos }));
                  setPageAlignments(prev => ({ ...prev, [currentPage]: 'custom' }));
                }}
                onSizeChange={(sz) => {
                  setCurrentAlignment('custom');
                  setBugSize(sz);
                  setPageSizes(prev => ({ ...prev, [currentPage]: sz }));
                  setPageAlignments(prev => ({ ...prev, [currentPage]: 'custom' }));
                  
                  // Keep sidebar scale slider state in sync
                  const baseWidthPx = bugBaseSize.width * canvasScale;
                  if (baseWidthPx > 0) {
                    const calculatedScale = Math.round((sz.width / baseWidthPx) * 100);
                    const clampedScale = Math.max(minScale, Math.min(maxScale, calculatedScale));
                    setBugScale(clampedScale);
                  }
                }}
                onDragEnd={handleDragEnd}
                totalPages={totalPages}
                isPageSelectorExpanded={isThumbnailsExpanded}
                onWorkspaceClick={() => {
                  if (isThumbnailsExpanded) {
                    setIsThumbnailsExpanded(false);
                  }
                }}
              />
              
              {/* Bottom Multi-page bar */}
              <PageSelector
                currentPage={currentPage}
                totalPages={totalPages}
                onPageChange={handlePageChange}
                pdfDoc={pdfDoc}
                isExpanded={isThumbnailsExpanded}
                onToggleExpand={() => setIsThumbnailsExpanded(!isThumbnailsExpanded)}
              />
            </div>

            {/* 2. Control Sidebar Panel */}
            <aside className="control-sidebar">
              <div className="sidebar-header">
                <h2>Edit & Adjust</h2>
                
              </div>

              {/* Tab Switcher */}
              <div className="sidebar-tabs">
                <button 
                  className={`tab-btn ${activeSidebarTab === 'preflight' ? 'active' : ''}`}
                  onClick={() => setActiveSidebarTab('preflight')}
                >
                  <ClipboardCheck size={14} />
                  <span>Preflight</span>
                </button>
                <button 
                  className={`tab-btn ${activeSidebarTab === 'stamper' ? 'active' : ''}`}
                  onClick={() => setActiveSidebarTab('stamper')}
                >
                  <Sparkles size={14} />
                  <span>Stamper Settings</span>
                </button>
              </div>

              {/* Mini Upload Zone Cards in Sidebar for replacement */}
              <div style={{ padding: '20px 24px 0', display: 'flex', flexDirection: 'column', gap: '12px' }}>
                <UploadZone
                  label="Artwork File"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onFileSelect={handleArtworkSelect}
                  selectedFile={artworkFile}
                  onClear={handleClearArtwork}
                  icon={ImageIcon}
                />
              </div>

              {activeSidebarTab === 'stamper' ? (
                <ControlPanel
                  colorMode={colorMode}
                  selectedColor={selectedColor}
                  extractedColors={extractedColors}
                  bugScale={bugScale}
                  bugBaseSize={bugBaseSize}
                  minScale={minScale}
                  maxScale={maxScale}
                  showSafeLine={showSafeLine}
                  bleedEnabled={bleedEnabled}
                  sourceHasBleed={pdfHasIncludedBleed}
                  onBleedToggle={() => setBleedEnabled(!bleedEnabled)}
                  bleedAmount={bleedAmount}
                  onBleedAmountChange={setBleedAmount}
                  trimCropEnabled={trimCropEnabled}
                  onTrimCropToggle={() => setTrimCropEnabled(!trimCropEnabled)}
                  manualCropAmount={manualCropAmount}
                  onManualCropChange={setManualCropAmount}
                  showGrid={showGrid}
                  onShowGridToggle={() => setShowGrid(!showGrid)}
                  snapToGrid={snapToGrid}
                  onSnapToGridToggle={() => setSnapToGrid(!snapToGrid)}
                  gridSize={gridSize}
                  onGridSizeChange={setGridSize}
                  bugEnabled={bugEnabled}
                  onBugEnabledToggle={() => setBugEnabled(!bugEnabled)}
                  onQuickAlign={handleQuickAlign}
                  multiPageOptions={multiPageOptions}
                  isMultiPage={artworkType === 'pdf' && totalPages > 1}
                  onColorModeChange={handleColorModeChange}
                  onColorSelect={setSelectedColor}
                  onScaleChange={setBugScale}
                  onShowSafeLineToggle={() => setShowSafeLine(!showSafeLine)}
                  onMultiPageOptionsChange={setMultiPageOptions}
                  onResetBug={resetUnionBugSettings}
                  isExporting={isExporting}
                />
              ) : (
                <PreflightPanel
                  results={preflightResults}
                  isScanning={isScanning}
                  onRunFullCheck={handleRunFullPreflight}
                  onFix={handlePreflightFix}
                  onReset={handleResetArtwork}
                  artworkType={artworkType}
                />
              )}

              {/* Universal Persistent Export Button at bottom of sidebar */}
              <div style={{ 
                padding: '0 24px 24px', 
                marginTop: 'auto',
                borderTop: '1px solid var(--border-color)',
                paddingTop: '20px',
                background: 'var(--bg-card)',
                position: 'sticky',
                bottom: 0,
                zIndex: 10
              }}>
                <button
                  className="btn btn-primary btn-action-block"
                  style={{ padding: '14px', fontSize: '15px' }}
                  onClick={handleUniversalExport}
                  disabled={isLoading || isScanning || isExporting}
                >
                  {isExporting ? (
                    <>
                      <UploadCloud size={18} className="spinner" style={{ animation: 'spin 1s linear infinite' }} />
                      Generating file...
                    </>
                  ) : (
                    <>
                      <ClipboardCheck size={18} />
                      Save Final Output
                    </>
                  )}
                </button>
              </div>

              {/* Collapsible Advanced Settings for Stamp File Change */}
              <div className="advanced-settings-wrapper">
                <details className="advanced-settings-details">
                  <summary>
                    Advanced Settings (Change Stamp PDF)
                  </summary>
                  <div style={{ marginTop: '12px' }}>
                    <UploadZone
                      label="Union Bug PDF"
                      accept=".pdf"
                      onFileSelect={handleBugSelect}
                      selectedFile={bugFile}
                      onClear={handleClearBug}
                      icon={FileText}
                    />
                  </div>
                </details>
              </div>
            </aside>
          </>
        )}
      </main>

      {/* Global loading spinner screen */}
      {isLoading && (
        <div className="loading-overlay">
          <div className="spinner" />
          <h4 style={{ fontSize: '15px', fontWeight: '500' }}>Rendering and loading layout...</h4>
        </div>
      )}

      {/* Global Drag and Drop Overlay */}
      {isGlobalDragActive && (
        <div className="global-drag-overlay">
          <div className="global-drag-content">
            <UploadCloud size={48} className="global-drag-icon" />
            <h3>Upload Artwork PDF/Image</h3>
            <p>Drop files here to load and run preflight checks.</p>
          </div>
        </div>
      )}
    </div>
  );
}
