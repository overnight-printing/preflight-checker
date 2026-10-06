import { useState, useEffect, useCallback, useRef } from 'react';
import { Image as ImageIcon, Sparkles, ClipboardCheck, UploadCloud, Monitor, Moon, Sun, X } from 'lucide-react';
import UploadZone from './components/UploadZone';
import EditorCanvas from './components/EditorCanvas';
import ControlPanel from './components/ControlPanel';
import PageSelector from './components/PageSelector';
import PreflightPanel from './components/PreflightPanel';

import { drawMirrorBleed, stitchBugToImage } from './utils/canvasProcessor';

// Load PDF engines on demand so the upload screen can paint immediately.
const loadPDF = async (...args) => (await import('./utils/pdfProcessor')).loadPDF(...args);
const getPDFBoxInfo = async (...args) => (await import('./utils/pdfProcessor')).getPDFBoxInfo(...args);
const processUnionBug = async (...args) => (await import('./utils/pdfProcessor')).processUnionBug(...args);
const stitchBugToPDF = async (...args) => (await import('./utils/pdfProcessor')).stitchBugToPDF(...args);
const runPreflightChecks = async (...args) => (await import('./utils/preflightChecker')).runPreflightChecks(...args);
const fixOverprint = async (...args) => (await import('./utils/preflightChecker')).fixOverprint(...args);
const fixBlankPage = async (...args) => (await import('./utils/preflightChecker')).fixBlankPage(...args);
const createCustomerProofPdf = async (...args) => (await import('./utils/customerProof')).createCustomerProofPdf(...args);
const createPngProofSourcePdf = async (...args) => (await import('./utils/customerProof')).createPngProofSourcePdf(...args);
const createCompatibilityArtworkPdf = async (...args) => (await import('./utils/compatibilityPdf')).createCompatibilityArtworkPdf(...args);

import {
  analyzeBackgroundLuminance,
  extractDominantColors
} from './utils/colorAnalyzer';
import { resolveTargetPages } from './utils/pageSelection';
import {
  getAlignedPosition,
  getHorizontallyAlignedPosition,
  getVerticallyAlignedPosition,
  translatePositionForBleed
} from './utils/layoutMath';
import { getOutputGeometry, rotatedSize } from './utils/pdfGeometry';
import { validateArtworkFile, MAX_PDF_BYTES } from './utils/fileValidation';
import { normalizeProofId, proofIdForFilename } from './utils/proofId';
import { DEFAULT_PRINT_REQUIREMENTS } from './utils/printSettings';

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
  const [imageDpi, setImageDpi] = useState(300);
  const canvasScale = artworkType === 'image' ? imageDpi / 72 : 1.5;
  
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
  const minScale = bugBaseSize && bugBaseSize.width ? Math.ceil(1440 / bugBaseSize.width) : 10;
  const maxScale = bugBaseSize && bugBaseSize.width ? Math.floor(14400 / bugBaseSize.width) : 300;

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

  const [originalImage, setOriginalImage] = useState(null); // Keeps the original Image element for reactive image bleed redraws

  // Bug overlay enable toggle (allows bleed-only processing)
  const [bugEnabled, setBugEnabled] = useState(false);

  // Quick alignment state (3×3 positions or 'custom')
  const [currentAlignment, setCurrentAlignment] = useState('bottom-right');

  // Canvas zoom state
  const [zoom, setZoom] = useState(0.7);

  // Color states
  const [colorMode, setColorMode] = useState('auto'); // 'auto' | 'preset' | 'custom'
  const [selectedColor, setSelectedColor] = useState('#000000');
  const [recommendedColor, setRecommendedColor] = useState('#000000'); // Contrast-calculated auto color
  const [extractedColors, setExtractedColors] = useState(['#000000', '#ffffff', '#a855f7', '#14b8a6', '#ef4444']);

  // Loading States
  const [isLoading, setIsLoading] = useState(false);
  const [isBugRendering, setIsBugRendering] = useState(false);
  const [isBugLoading, setIsBugLoading] = useState(false);
  const [notice, setNotice] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [isGeneratingProof, setIsGeneratingProof] = useState(false);
  const [proofId, setProofId] = useState('');

  // Preflight states
  const [activeSidebarTab, setActiveSidebarTab] = useState('preflight'); // 'preflight' is default active tab
  const [preflightResults, setPreflightResults] = useState(null);
  const [printRequirements, setPrintRequirements] = useState(DEFAULT_PRINT_REQUIREMENTS);
  const [pdfOutputMode, setPdfOutputMode] = useState('preserve');
  const [compatibilityDpi, setCompatibilityDpi] = useState(600);
  
  // Theme state
  const [theme, setTheme] = useState(() => {
    let savedTheme;
    try { savedTheme = localStorage.getItem('theme'); } catch { /* Storage can be unavailable in private browsing. */ }
    return ['light', 'system', 'dark'].includes(savedTheme) ? savedTheme : 'system';
  });
  
  // Global drag-and-drop state
  const [isGlobalDragActive, setIsGlobalDragActive] = useState(false);
  const dragCounter = useRef(0);
  const artworkLoadRequestIdRef = useRef(0);
  const renderRequestIdRef = useRef(0);
  const scanRequestIdRef = useRef(0);
  const bugRequestIdRef = useRef(0);
  const pdfPageCanvasCacheRef = useRef(new Map());
  
  // Multi-page options
  const [multiPageOptions, setMultiPageOptions] = useState({
    applyTo: 'current',
    customPages: ''
  });

  // Track if we completed the initial alignment placement for a newly loaded artwork
  const [hasDoneInitialAlignment, setHasDoneInitialAlignment] = useState(false);

  // Collapsible page thumbnails strip state
  const [isThumbnailsExpanded, setIsThumbnailsExpanded] = useState(false);

  // Safe zone is ALWAYS 9pt (0.125") inside the trim/cut line — hardcoded, not adjustable
  const pdfHasIncludedBleed = artworkType === 'pdf' && Boolean(pdfBoxInfo?.hasDistinctBleedBox);
  const effectiveBleedAmount = bleedEnabled ? bleedAmount : 0;

  const translateBugForBleedChange = useCallback((previousBleed, nextBleed) => {
    const deltaPx = (nextBleed - previousBleed) * canvasScale;
    if (Math.abs(deltaPx) < 0.001) return;

    const translatePosition = (position) => translatePositionForBleed(
      position,
      previousBleed,
      nextBleed,
      canvasScale
    );

    setBugPosition((position) => translatePosition(position));
    setPagePositions((positions) => Object.fromEntries(
      Object.entries(positions).map(([page, position]) => [page, translatePosition(position)])
    ));
  }, [canvasScale]);

  const setBleedEnabledPreservingBug = useCallback((enabled) => {
    const previousBleed = bleedEnabled ? bleedAmount : 0;
    const nextBleed = enabled ? bleedAmount : 0;
    translateBugForBleedChange(previousBleed, nextBleed);
    setBleedEnabled(enabled);
  }, [bleedAmount, bleedEnabled, translateBugForBleedChange]);

  const setBleedAmountPreservingBug = useCallback((amount) => {
    const previousBleed = bleedEnabled ? bleedAmount : 0;
    const nextBleed = bleedEnabled ? amount : 0;
    translateBugForBleedChange(previousBleed, nextBleed);
    setBleedAmount(amount);
  }, [bleedAmount, bleedEnabled, translateBugForBleedChange]);

  // Keep the floating size summary concise; detailed PDF box data stays internal.
  const formatPtToInches = (width, height) => {
    if (!width || !height) return 'N/A';
    const wInch = (width / 72).toFixed(2);
    const hInch = (height / 72).toFixed(2);
    return `${wInch}" × ${hInch}"`;
  };

  let geometryDetails = null;
  let geometryError = '';
  if (pdfBoxInfo) {
    try {
      const { trimBox, outputBox } = getOutputGeometry(pdfBoxInfo, {
        trimCropEnabled, manualCropAmount, bleedAmount: effectiveBleedAmount
      });
      const trim = rotatedSize(trimBox, pdfBoxInfo.rotation);
      const output = rotatedSize(outputBox, pdfBoxInfo.rotation);
      const artwork = rotatedSize(pdfBoxInfo.cropBox, pdfBoxInfo.rotation);
      geometryDetails = {
        trimSize: formatPtToInches(trim.width, trim.height),
        bleedSize: formatPtToInches(output.width, output.height),
        artworkSize: formatPtToInches(artwork.width, artwork.height),
        pages: totalPages,
        bleedDescription: bleedEnabled ? `Added ${(bleedAmount / 72).toFixed(3)}" each side`
          : pdfHasIncludedBleed && !trimCropEnabled ? 'Included in file' : 'None'
      };
    } catch (error) { geometryError = error.message; }
  }
  if (artworkType === 'image' && artworkCanvas && originalImage) {
    const bleedPx = Math.round(effectiveBleedAmount * canvasScale);
    geometryDetails = {
      trimSize: formatPtToInches((artworkCanvas.width - 2 * bleedPx) / canvasScale, (artworkCanvas.height - 2 * bleedPx) / canvasScale),
      bleedSize: formatPtToInches(artworkCanvas.width / canvasScale, artworkCanvas.height / canvasScale),
      artworkSize: formatPtToInches(originalImage.width / canvasScale, originalImage.height / canvasScale),
      pages: 1,
      bleedDescription: `${imageDpi} DPI · ${bleedEnabled ? 'Added mirror bleed' : 'No bleed'}`
    };
  }
  const pageSelection = resolveTargetPages(multiPageOptions, totalPages, currentPage);
  const selectionError = bugEnabled ? pageSelection.error || (pageSelection.pages.length === 0 ? 'No pages selected for the Union Bug.' : '') : '';
  const exportError = geometryError || selectionError || (bugEnabled && (!bugFile || !bugCanvas) ? 'Load a Union Bug PDF before exporting.' : '');
  const isBusy = isLoading || isBugLoading || isExporting || isGeneratingProof;
  const canExport = artworkCanvas && !isBusy && !isScanning && !isBugRendering && !exportError;
  const exportSettingsKey = JSON.stringify({
    bleedEnabled, bleedAmount, trimCropEnabled, manualCropAmount, bugEnabled,
    currentPage, bugPosition, bugSize, pagePositions, pageSizes, pageAlignments,
    currentAlignment, colorMode, selectedColor, multiPageOptions, printRequirements,
    pdfOutputMode, compatibilityDpi
  });
  const displayedPreflightResults = preflightResults?.scope === 'production' &&
    (preflightResults.exportSettingsKey !== exportSettingsKey || preflightResults.bugFile !== bugFile)
    ? null : preflightResults;

  const hasArtwork = Boolean(artworkFile);

  // Auto-load default Union Bug from public directory on mount
  useEffect(() => {
    if (!hasArtwork || bugFile || bugRequestIdRef.current !== 0) return;
    let active = true;
    const requestId = bugRequestIdRef.current;
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
        
        await bugDoc.destroy();
        if (!active || requestId !== bugRequestIdRef.current) return;
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
    return () => { active = false; };
  }, [hasArtwork, bugFile]);

  useEffect(() => {
    return () => { pdfDoc?.destroy(); };
  }, [pdfDoc]);

  const resetUnionBugSettings = useCallback(() => {
    setBugEnabled(false);
    setBugPosition({ left: 100, top: 100 });
    setBugScale(Math.max(minScale, Math.min(maxScale, 100)));
    setColorMode('auto');
    setSelectedColor('#000000');
    setRecommendedColor('#000000');
    setShowGrid(false);
    setSnapToGrid(false);
    setGridSize(0.125);
    setCurrentAlignment('bottom-right');
    setPagePositions({});
    setPageSizes({});
    setPageAlignments({});
    setMultiPageOptions({ applyTo: 'current', customPages: '' });
    setHasDoneInitialAlignment(false);
  }, [minScale, maxScale]);

  // 1. Handle Artwork File Upload
  const handleArtworkSelect = useCallback(async (file) => {
    const validationError = validateArtworkFile(file);
    if (validationError) { setNotice({ type: 'error', message: validationError }); return; }
    const requestId = artworkLoadRequestIdRef.current + 1;
    artworkLoadRequestIdRef.current = requestId;
    renderRequestIdRef.current += 1;

    setIsLoading(true);
    setNotice(null);
    scanRequestIdRef.current += 1;
    setIsScanning(false);
    setBleedEnabled(false);
    setBleedAmount(9);
    setImageDpi(300);
    setPdfOutputMode('preserve');
    setCompatibilityDpi(600);
    setTrimCropEnabled(false);
    setManualCropAmount(0);
    setExtractedColors(['#000000', '#ffffff']);
    setIsThumbnailsExpanded(false);
    resetUnionBugSettings();
    setArtworkFile(file);
    setOriginalFile(file); // Store initial upload as backup
    setArtworkCanvas(null);
    setPdfDoc(null);
    setOriginalImage(null);
    setPdfBoxInfo(null);
    setPreflightResults(null);
    setProofId('');
    setTotalPages(1);
    setCurrentPage(1);
    pdfPageCanvasCacheRef.current.clear();
    
    try {
      const extension = file.name.split('.').pop().toLowerCase();
      
      if (extension === 'pdf') {
        setArtworkType('pdf');
        const doc = await loadPDF(file);
        if (requestId !== artworkLoadRequestIdRef.current) { await doc.destroy(); return; }
        setPdfDoc(doc);
        setTotalPages(doc.numPages);
        setCurrentPage(1);
      } else {
        setArtworkType('image');
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
      setNotice({ type: 'error', message: `Unable to load artwork. ${error.message || 'Choose a valid PDF or image and try again.'}` });
      setIsLoading(false);
      setOriginalFile(null);
      setArtworkFile(null);
    }
  }, [resetUnionBugSettings]);

  // Handle Theme Switching (Light / System / Dark)
  useEffect(() => {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const applyTheme = () => {
      const resolvedTheme = theme === 'system'
        ? (mediaQuery.matches ? 'dark' : 'light')
        : theme;
      document.documentElement.setAttribute('data-theme', resolvedTheme);
    };

    applyTheme();
    try { localStorage.setItem('theme', theme); } catch { /* The theme still applies without storage. */ }

    if (theme === 'system') {
      mediaQuery.addEventListener('change', applyTheme);
      return () => mediaQuery.removeEventListener('change', applyTheme);
    }
  }, [theme]);

  // Handle Global Drag-and-Drop
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    dragCounter.current++;
    if (e.dataTransfer.types.includes('Files')) {
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
      if (!isExporting && !isGeneratingProof) handleArtworkSelect(file);
      e.dataTransfer.clearData();
    }
  }, [handleArtworkSelect, isExporting, isGeneratingProof]);

  useEffect(() => {
    const resetDragState = () => { dragCounter.current = 0; setIsGlobalDragActive(false); };
    window.addEventListener('drop', resetDragState, true);
    window.addEventListener('dragend', resetDragState);
    window.addEventListener('blur', resetDragState);
    window.addEventListener('dragenter', handleDragEnter);
    window.addEventListener('dragleave', handleDragLeave);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('drop', handleDrop);
    return () => {
      window.removeEventListener('drop', resetDragState, true);
      window.removeEventListener('dragend', resetDragState);
      window.removeEventListener('blur', resetDragState);
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
    scanRequestIdRef.current += 1;
    setIsLoading(false);
    setIsScanning(false);
    setPreflightResults(null);
    setNotice(null);
    setCurrentPage(1);
    setTotalPages(1);
    setArtworkFile(null);
    setOriginalFile(null);
    setArtworkCanvas(null);
    setPdfDoc(null);
    setPdfBoxInfo(null);
    setOriginalImage(null);
    setProofId('');
    setBugPosition({ left: 100, top: 100 });
    setPagePositions({});
    setPageSizes({});
    setPageAlignments({});
    setHasDoneInitialAlignment(false);
    pdfPageCanvasCacheRef.current.clear();
  };

  // Resets the current artwork back to the original uploaded file (undo all preflight fixes/crops)
  const handleResetArtwork = async () => {
    if (originalFile) await handleArtworkSelect(originalFile);
  };

  // Clears the union bug state
  const handleClearBug = () => {
    bugRequestIdRef.current += 1;
    setIsBugLoading(false);
    setIsBugRendering(false);
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
    const cache = pdfPageCanvasCacheRef.current;
    const cached = cache.get(pageNum);
    if (cached?.doc === doc) return cached.promise;
    const promise = (async () => {
      const page = await doc.getPage(pageNum);
      const viewport = page.getViewport({ scale: canvasScale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      return canvas;
    })();
    cache.set(pageNum, { doc, promise });
    // Keep only a few previews in memory for long documents.
    if (cache.size > 3) cache.delete(cache.keys().next().value);
    try { return await promise; }
    catch (error) { if (cache.get(pageNum)?.promise === promise) cache.delete(pageNum); throw error; }
  };

  const buildProcessedCanvas = (source, bleed, selectedBleedAmount = 0, crop = null) => {
    const cropLeft = Math.max(0, Math.round(crop?.left || 0));
    const cropTop = Math.max(0, Math.round(crop?.top || 0));
    const cropRight = Math.max(0, Math.round(crop?.right || 0));
    const cropBottom = Math.max(0, Math.round(crop?.bottom || 0));
    const sourceW = source.width || source.naturalWidth;
    const sourceH = source.height || source.naturalHeight;
    const finalW = sourceW - cropLeft - cropRight;
    const finalH = sourceH - cropTop - cropBottom;
    if (finalW <= 0 || finalH <= 0) throw new Error('The crop inset removes the entire page. Reduce the manual inset.');
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
      tempCtx.fillStyle = '#ffffff';
      tempCtx.fillRect(0, 0, croppedTemp.width, croppedTemp.height);
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
      for (const edge of ['left', 'right', 'bottom', 'top']) {
        crop[edge] += boxInfo.trimInsets[edge] * canvasScale;
      }
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
      if (requestId === renderRequestIdRef.current) {
        setArtworkCanvas(null);
        setNotice({ type: 'error', message: error.message || 'Unable to render this PDF page.' });
      }
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
    if (!artworkFile || (artworkType === 'pdf' ? !pdfDoc : !originalImage)) return;
    
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
        if (requestId === renderRequestIdRef.current) {
          setArtworkCanvas(null);
          setNotice({ type: 'error', message: error.message || 'Unable to render artwork.' });
        }
      } finally {
        if (requestId === renderRequestIdRef.current) {
          setIsLoading(false);
        }
      }
    };
    
    updateArtworkRender();
    return () => { renderRequestIdRef.current += 1; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effectiveBleedAmount, bleedEnabled, bleedAmount, trimCropEnabled, manualCropAmount, currentPage, originalImage, pdfDoc, pdfBoxInfo, canvasScale]);

  // 2. Handle Union Bug File Upload
  const handleBugSelect = async (file) => {
    const requestId = ++bugRequestIdRef.current;
    setIsBugLoading(true);
    try {
      const bugDoc = await loadPDF(file);
      if (bugDoc.numPages !== 1) { await bugDoc.destroy(); throw new Error('Choose a one-page PDF for the Union Bug.'); }
      const bugPage = await bugDoc.getPage(1);
      const viewport = bugPage.getViewport({ scale: 1 });
      await bugDoc.destroy();
      if (requestId !== bugRequestIdRef.current) return;
      setBugCanvas(null);
      setBugImageSrc('');
      setBugFile(file);
      setBugBaseSize({ width: viewport.width, height: viewport.height });
      setPageSizes({});
    } catch (error) {
      if (requestId === bugRequestIdRef.current) setNotice({ type: 'error', message: `Unable to load Union Bug. ${error.message}` });
    } finally {
      if (requestId === bugRequestIdRef.current) setIsBugLoading(false);
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
    let active = true;

    const renderAndColorBug = async () => {
      setIsBugRendering(true);
      try {
        // Preview rendering resolution increased to 8.0 DPI (approx. 600 DPI equivalent) to maintain crisp vector sharpness even when zoomed in.
        const { canvas } = await processUnionBug(bugFile, activeColor, 8.0);
        if (!active) return;
        setBugCanvas(canvas);
        setBugImageSrc(canvas.toDataURL('image/png'));
      } catch (error) {
        if (active) setNotice({ type: 'error', message: `Unable to render the Union Bug. ${error.message}` });
      } finally {
        if (active) setIsBugRendering(false);
      }
    };

    renderAndColorBug();
    return () => { active = false; };
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

    const requestId = ++scanRequestIdRef.current;
    setIsScanning(true);
    try {
      const results = await runPreflightChecks(artworkFile, pdfDoc, printRequirements);
      if (requestId === scanRequestIdRef.current) setPreflightResults({ ...results, scope: 'source' });
    } catch (err) {
      if (requestId === scanRequestIdRef.current) setNotice({ type: 'error', message: `Preflight failed. ${err.message}` });
    } finally {
      if (requestId === scanRequestIdRef.current) setIsScanning(false);
    }
  }, [artworkFile, pdfDoc, artworkType, printRequirements]);

  // Handler for Preflight Auto-Fixes
  const handlePreflightFix = async (checkKey) => {
    if (!artworkFile || isBusy || isScanning) return;
    const requestId = artworkLoadRequestIdRef.current;
    setIsLoading(true);
    try {
      const arrayBuffer = await artworkFile.arrayBuffer();
      let updatedBytes = null;

      if (checkKey === 'bleed') {
        // Fix Bleed: Enable mirror bleed in settings
        setBleedEnabledPreservingBug(true);
        setIsLoading(false);
        return;
      } else if (checkKey === 'overprint') {
        updatedBytes = await fixOverprint(arrayBuffer);

      } else if (checkKey === 'blankPages') {
        const blankPages = preflightResults?.checks?.blankPages?.value || [];
        if (blankPages.length === 0) return;
        const pageToRemove = blankPages[0];
        updatedBytes = await fixBlankPage(arrayBuffer, pageToRemove);
        setPagePositions({});
        setPageSizes({});
        setPageAlignments({});
        setHasDoneInitialAlignment(false);
        if (currentPage >= pageToRemove && currentPage > 1) {
          setCurrentPage(prev => prev - 1);
        }
      }

      if (updatedBytes) {
        const correctedBlob = new Blob([updatedBytes], { type: 'application/pdf' });
        const correctedFile = new File([correctedBlob], artworkFile.name, { type: 'application/pdf' });
        
        // Re-load corrected PDF
        const doc = await loadPDF(correctedFile);
        if (requestId !== artworkLoadRequestIdRef.current) { await doc.destroy(); return; }
        renderRequestIdRef.current += 1;
        pdfPageCanvasCacheRef.current.clear();
        setPdfBoxInfo(null);
        setArtworkCanvas(null);
        setPreflightResults(null);
        setArtworkFile(correctedFile);
        setPdfDoc(doc);
        setTotalPages(doc.numPages);

        // Re-run preflight scan to update the UI status
        setIsScanning(true);
        try {
          const results = await runPreflightChecks(correctedFile, doc, printRequirements);
          if (requestId === artworkLoadRequestIdRef.current) setPreflightResults({ ...results, scope: 'source' });
        } catch (scanErr) {
          console.error('Error re-scanning after fix:', scanErr);
        } finally {
          if (requestId === artworkLoadRequestIdRef.current) setIsScanning(false);
        }
      }
    } catch (error) {
      console.error(`Error fixing preflight check ${checkKey}:`, error);
      if (requestId === artworkLoadRequestIdRef.current) setNotice({ type: 'error', message: `Unable to apply fix. ${error.message || 'Try again.'}` });
    } finally {
      if (requestId === artworkLoadRequestIdRef.current) setIsLoading(false);
    }
  };

  const getBugPlacementBounds = useCallback(() => {
    if (!artworkCanvas) return null;
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

    return { left: safeLeftPx, top: safeTopPx, width: safeWidthPx, height: safeHeightPx };
  }, [artworkCanvas, effectiveBleedAmount, canvasScale, pdfBoxInfo, trimCropEnabled, manualCropAmount, isCropMode, manualCropGuides]);

  // 6. Quick Alignment Logic
  const handleQuickAlign = useCallback((alignment) => {
    if (!bugSize) return;
    const placementBounds = getBugPlacementBounds();
    if (!placementBounds) return;

    const nextPos = getAlignedPosition(alignment, placementBounds, bugSize);
    nextPos.left = Math.max(0, Math.min(nextPos.left, artworkCanvas.width - bugSize.width));
    nextPos.top = Math.max(0, Math.min(nextPos.top, artworkCanvas.height - bugSize.height));
    setBugPosition(nextPos);
    setPagePositions(p => ({ ...p, [currentPage]: nextPos }));
    setPageSizes(s => ({ ...s, [currentPage]: bugSize }));
    if (alignment !== 'custom') {
      setPageAlignments(a => ({ ...a, [currentPage]: alignment }));
    }

    if (alignment !== 'custom') {
      setCurrentAlignment(alignment);
    }
  }, [artworkCanvas, bugSize, currentPage, getBugPlacementBounds]);

  const handleHorizontalAlign = useCallback((alignment) => {
    if (!bugSize) return;
    const placementBounds = getBugPlacementBounds();
    if (!placementBounds) return;

    const nextPos = getHorizontallyAlignedPosition(
      alignment,
      placementBounds,
      bugSize,
      bugPosition
    );
    nextPos.left = Math.max(0, Math.min(nextPos.left, artworkCanvas.width - bugSize.width));
    nextPos.top = Math.max(0, Math.min(nextPos.top, artworkCanvas.height - bugSize.height));
    setBugPosition(nextPos);
    setCurrentAlignment('custom');
    setPagePositions((positions) => ({ ...positions, [currentPage]: nextPos }));
    setPageSizes((sizes) => ({ ...sizes, [currentPage]: bugSize }));
    setPageAlignments((alignments) => ({ ...alignments, [currentPage]: 'custom' }));
  }, [artworkCanvas, bugPosition, bugSize, currentPage, getBugPlacementBounds]);
  const handleVerticalAlign = useCallback((alignment) => {
    if (!bugSize) return;
    const placementBounds = getBugPlacementBounds();
    if (!placementBounds) return;

    const nextPos = getVerticallyAlignedPosition(
      alignment,
      placementBounds,
      bugSize,
      bugPosition
    );
    nextPos.left = Math.max(0, Math.min(nextPos.left, artworkCanvas.width - bugSize.width));
    nextPos.top = Math.max(0, Math.min(nextPos.top, artworkCanvas.height - bugSize.height));
    setBugPosition(nextPos);
    setCurrentAlignment('custom');
    setPagePositions((positions) => ({ ...positions, [currentPage]: nextPos }));
    setPageSizes((sizes) => ({ ...sizes, [currentPage]: bugSize }));
    setPageAlignments((alignments) => ({ ...alignments, [currentPage]: 'custom' }));
  }, [artworkCanvas, bugPosition, bugSize, currentPage, getBugPlacementBounds]);

  // Automatically align bug if alignment mode is active (not custom)
  useEffect(() => {
    if (artworkCanvas && bugSize) {
      if (!hasDoneInitialAlignment) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        handleQuickAlign('bottom-right');
        setHasDoneInitialAlignment(true);
      } else if (currentAlignment !== 'custom') {
        handleQuickAlign(currentAlignment);
      }
    }
  }, [currentAlignment, bleedEnabled, bleedAmount, bugSize, artworkCanvas, hasDoneInitialAlignment, handleQuickAlign]);

  // Drag End handler to set custom alignment status
  const handleDragEnd = () => {
    setCurrentAlignment('custom');
    runContrastAnalysis();
  };

  // Page Switcher for PDFs
  const handlePageChange = async (newPage) => {
    if (newPage === currentPage || newPage < 1 || newPage > totalPages || isBusy) return;

    // Cache current page state to coordinates maps before shifting
    setPagePositions(prev => ({ ...prev, [currentPage]: bugPosition }));
    setPageSizes(prev => ({ ...prev, [currentPage]: bugSize }));
    setPageAlignments(prev => ({ ...prev, [currentPage]: currentAlignment }));

    setCurrentPage(newPage);
    setArtworkCanvas(null);
    setPdfBoxInfo(null);
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
    }
  };

  const createPreparedPdfBytes = async () => {
    if (bugEnabled && !bugFile) {
      throw new Error('Union Bug PDF is not loaded. Upload a Union Bug PDF or reload the app before saving.');
    }
    if (artworkFile.size > MAX_PDF_BYTES) {
      const sizeMb = Math.round(artworkFile.size / (1024 * 1024));
      throw new Error(
        `This PDF is ${sizeMb} MB, which exceeds the 250 MB browser export limit. Use a desktop PDF editor or choose a smaller PDF.`
      );
    }

    let pagesToStitch = [];
    if (bugEnabled) {
      const pageSelection = resolveTargetPages(multiPageOptions, totalPages, currentPage);
      if (pageSelection.error) throw new Error(pageSelection.error);
      if (pageSelection.pages.length === 0) throw new Error('No pages selected for the Union Bug.');
      pagesToStitch = pageSelection.pages;
    }

    const exportPositions = { ...pagePositions, [currentPage]: bugPosition };
    const exportSizes = { ...pageSizes, [currentPage]: bugSize };
    const exportColors = {};
    for (const pageNum of pagesToStitch) {
      const box = pageNum === currentPage ? pdfBoxInfo : await getPDFBoxInfo(artworkFile, pageNum);
      const baseCanvas = await getCachedPDFPageCanvas(pdfDoc, pageNum);
      const canvas = pageNum === currentPage ? artworkCanvas : buildProcessedCanvas(
        baseCanvas, bleedEnabled, bleedAmount, getPDFCropInsets(box, trimCropEnabled, manualCropAmount)
      );
      const size = exportSizes[pageNum] || bugSize;
      if (size.width > canvas.width || size.height > canvas.height) throw new Error(`The Union Bug is larger than page ${pageNum}. Reduce its size.`);
      const alignment = pageNum === currentPage ? currentAlignment : pageAlignments[pageNum] || currentAlignment;
      if (alignment !== 'custom') {
        const insets = box?.hasDistinctTrimBox && !trimCropEnabled ? Object.fromEntries(
          Object.entries(box.trimInsets).map(([edge, inset]) => [edge, Math.max(0, inset - manualCropAmount) * canvasScale])
        ) : { left: 0, top: 0, right: 0, bottom: 0 };
        const margin = (effectiveBleedAmount + 9) * canvasScale;
        exportPositions[pageNum] = getAlignedPosition(alignment, {
          left: margin + insets.left, top: margin + insets.top,
          width: Math.max(0, canvas.width - 2 * margin - insets.left - insets.right),
          height: Math.max(0, canvas.height - 2 * margin - insets.top - insets.bottom)
        }, size);
      }
      const position = exportPositions[pageNum] || bugPosition;
      exportPositions[pageNum] = {
        left: Math.max(0, Math.min(position.left, canvas.width - size.width)),
        top: Math.max(0, Math.min(position.top, canvas.height - size.height))
      };
      exportSizes[pageNum] = size;
      const analysis = colorMode === 'auto' && analyzeBackgroundLuminance(canvas,
        exportPositions[pageNum].left, exportPositions[pageNum].top, size.width, size.height);
      exportColors[pageNum] = colorMode === 'auto' ? (analysis.isDark ? '#ffffff' : '#000000') : selectedColor;
    }

    const exportArtwork = pdfOutputMode === 'compatibility'
      ? new File([await createCompatibilityArtworkPdf(artworkFile, pdfDoc, compatibilityDpi)], artworkFile.name, { type: 'application/pdf' })
      : artworkFile;
    return stitchBugToPDF(
      exportArtwork,
      bugFile,
      exportColors,
      bugPosition,
      bugSize,
      canvasScale,
      pagesToStitch,
      currentPage,
      bleedEnabled ? bleedAmount : 0,
      bugEnabled,
      exportPositions,
      exportSizes,
      trimCropEnabled,
      manualCropAmount,
      isCropMode,
      manualCropGuides
    );
  };

  // Production export remains separate from the customer review proof.
  const handleCheckProduction = async () => {
    if (!canExport || artworkType !== 'pdf') return;
    const requestId = ++scanRequestIdRef.current;
    setIsScanning(true);
    let document;
    try {
      const bytes = await createPreparedPdfBytes();
      const file = new File([bytes], artworkFile.name, { type: 'application/pdf' });
      document = await loadPDF(file);
      const results = await runPreflightChecks(file, document, printRequirements);
      if ((effectiveBleedAmount > 0 || trimCropEnabled || manualCropAmount > 0 || pdfOutputMode === 'compatibility') &&
          (pdfBoxInfo?.hasSourceAnnotations || pdfBoxInfo?.hasSourceForms)) {
        results.checks.interactiveContent = {
          status: 'warning', value: true,
          details: 'The source PDF contains annotations or form fields. Their appearances are not included in this rebuilt output. Flatten intended printable appearances in the source file before printing.'
        };
      }
      if (requestId === scanRequestIdRef.current) setPreflightResults({
        ...results, scope: 'production', exportSettingsKey, bugFile,
        outputMode: pdfOutputMode,
        compatibilityDpi: pdfOutputMode === 'compatibility' ? compatibilityDpi : null
      });
    } catch (error) {
      if (requestId === scanRequestIdRef.current) setNotice({ type: 'error', message: `Production check failed. ${error.message}` });
    } finally {
      if (document) await document.destroy();
      if (requestId === scanRequestIdRef.current) setIsScanning(false);
    }
  };

  const handleDownloadPreflightReport = () => {
    if (!displayedPreflightResults) return;
    const report = { ...displayedPreflightResults, bugFile: undefined };
    const text = JSON.stringify({
      filename: artworkFile.name, generatedAt: new Date().toISOString(),
      certification: 'Production checks only; full PDF/X conformance and press rendering are not certified.',
      ...report
    }, null, 2);
    downloadFile(new Blob([text], { type: 'application/json' }), `${artworkFile.name.replace(/\.[^/.]+$/, '')}_Preflight.json`);
  };

  const handleUniversalExport = async () => {
    if (!canExport) return;

    setIsExporting(true);

    try {
      const safeFilename = artworkFile.name.replace(/\.[^/.]+$/, "") + (bugEnabled ? '_Proof' : '_Fixed') +
        (artworkType === 'pdf' && pdfOutputMode === 'compatibility' ? `_Compatibility_${compatibilityDpi}dpi` : '');

      if (artworkType === 'pdf') {
        const outputBytes = await createPreparedPdfBytes();
        const blob = new Blob([outputBytes], { type: 'application/pdf' });
        downloadFile(blob, `${safeFilename}.pdf`);
      } else {
        // Image export (pass bleed in pixels)
        const finalImageDataUrl = stitchBugToImage(
          artworkCanvas,
          bugCanvas,
          bugPosition,
          bugSize,
          0,
          bugEnabled // Preview already includes the selected bleed
        );
        
        downloadFile(finalImageDataUrl, `${safeFilename}.png`);
      }
      setNotice({ type: 'success', message: 'Production file downloaded.' });
    } catch (error) {
      console.error('Export error:', error);
      setNotice({ type: 'error', message: error?.message || 'Unable to save file.' });
    } finally {
      setIsExporting(false);
    }
  };

  const handleCustomerProofExport = async () => {
    if (!canExport) return;

    const normalizedId = normalizeProofId(proofId);
    if (!normalizedId) {
      setNotice({ type: 'error', message: 'Enter an estimate or invoice number before creating a customer proof.' });
      document.getElementById('proof-id')?.focus();
      return;
    }

    setIsGeneratingProof(true);

    try {
      let sourcePdfBytes;
      if (artworkType === 'pdf') {
        sourcePdfBytes = await createPreparedPdfBytes();
      } else {
        const activeBleedAmount = bleedEnabled ? bleedAmount : 0;
        const finalImageDataUrl = stitchBugToImage(
          artworkCanvas,
          bugCanvas,
          bugPosition,
          bugSize,
          0,
          bugEnabled
        );
        sourcePdfBytes = await createPngProofSourcePdf({
          pngDataUrl: finalImageDataUrl,
          widthPoints: artworkCanvas.width / canvasScale,
          heightPoints: artworkCanvas.height / canvasScale,
          bleedPoints: activeBleedAmount
        });
      }

      const proofBytes = await createCustomerProofPdf({
        sourcePdfBytes,
        proofId: normalizedId,
        sourceName: artworkFile.name,
        logoPngBytes: await fetch(`${import.meta.env.BASE_URL}logo.png`).then((response) => {
          if (!response.ok) throw new Error('The company logo could not be loaded for the proof.');
          return response.arrayBuffer();
        })
      });
      const baseName = artworkFile.name.replace(/\.[^/.]+$/, '');
      const filenameId = proofIdForFilename(normalizedId);
      downloadFile(
        new Blob([proofBytes], { type: 'application/pdf' }),
        `${baseName}_Customer_Proof_${filenameId}.pdf`
      );
      setNotice({ type: 'success', message: 'Customer proof downloaded.' });
    } catch (error) {
      console.error('Customer proof export error:', error);
      setNotice({ type: 'error', message: error?.message || 'Unable to create customer proof.' });
    } finally {
      setIsGeneratingProof(false);
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
      <header className="app-header">
        <button type="button" className="logo-section" onClick={handleClearArtwork} disabled={isExporting || isGeneratingProof} aria-label="Return to upload screen" title="Go to Homepage">
          <img src={`${import.meta.env.BASE_URL}favicon.png`} alt="Logo" style={{ height: '28px', width: '28px', borderRadius: '50%' }} className="logo-icon" />
          <h1>Overnight Preflight Tool</h1>
        </button>
        <div className="header-actions">
          <span className="release-version">v{import.meta.env.VITE_APP_VERSION}</span>
          <div className="theme-mode-control" role="group" aria-label="Color theme">
            <button
              type="button"
              className={theme === 'light' ? 'active' : ''}
              onClick={() => setTheme('light')}
              aria-label="Use light theme"
              aria-pressed={theme === 'light'}
              title="Light"
            >
              <Sun size={14} />
            </button>
            <button
              type="button"
              className={theme === 'dark' ? 'active' : ''}
              onClick={() => setTheme('dark')}
              aria-label="Use dark theme"
              aria-pressed={theme === 'dark'}
              title="Dark"
            >
              <Moon size={14} />
            </button>
            <button
              type="button"
              className={`system-option ${theme === 'system' ? 'active' : ''}`}
              onClick={() => setTheme('system')}
              aria-label="Follow system theme automatically"
              aria-pressed={theme === 'system'}
              title="Follow system automatically"
            >
              <Monitor size={14} />
              <span>Auto</span>
            </button>
          </div>
        </div>
      </header>

      {notice && (
        <div className={`app-notice ${notice.type}`} role={notice.type === 'error' ? 'alert' : 'status'}>
          <span>{notice.message}</span>
          <button type="button" aria-label="Dismiss message" onClick={() => setNotice(null)}><X size={18} /></button>
        </div>
      )}
      {/* Main Workspace */}
      <main className={`workspace ${!artworkFile ? 'upload-workspace' : ''}`} aria-busy={isBusy}>
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
            <div className="editor-pane" style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: 'hidden', display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
              {/* Compact PDF Geometry Summary */}
              {geometryDetails && (
                <div className="pdf-geometry-info-card" aria-label="Document size summary">
                  <div className="geometry-stat">
                    <span>Trim Size</span>
                    <strong>{geometryDetails.trimSize}</strong>
                  </div>
                  <div className="geometry-stat">
                    <span>Output Size</span>
                    <strong title={geometryDetails.bleedDescription}>{geometryDetails.bleedSize}</strong>
                  </div>
                  <div className="geometry-stat">
                    <span>{artworkType === 'image' ? `Artwork · ${imageDpi} DPI` : 'Artwork Size'}</span>
                    <strong>{geometryDetails.artworkSize}</strong>
                  </div>
                  <div className="geometry-stat">
                    <span>Pages</span>
                    <strong>{geometryDetails.pages}</strong>
                  </div>
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
                showSafeLine={showSafeLine}
                bleedEnabled={bleedEnabled} // Draw actual Magenta Trim Line
                bleedAmount={effectiveBleedAmount}
                trimCropEnabled={trimCropEnabled}
                manualCropAmount={manualCropAmount}
                isCropMode={isCropMode}
                manualCropGuides={manualCropGuides}
                bugEnabled={bugEnabled && pageSelection.pages.includes(currentPage)}
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
              <div className="sidebar-tabs" role="group" aria-label="Editor tools">
                <button 
                  className={`tab-btn ${activeSidebarTab === 'preflight' ? 'active' : ''}`}
                  aria-pressed={activeSidebarTab === 'preflight'}
                  onClick={() => setActiveSidebarTab('preflight')}
                >
                  <ClipboardCheck size={14} />
                  <span>Preflight</span>
                </button>
                <button 
                  className={`tab-btn ${activeSidebarTab === 'stamper' ? 'active' : ''}`}
                  aria-pressed={activeSidebarTab === 'stamper'}
                  onClick={() => setActiveSidebarTab('stamper')}
                >
                  <Sparkles size={14} />
                  <span>Stamper Settings</span>
                </button>
              </div>

              {/* Mini Upload Zone Cards in Sidebar for replacement */}
              <div className="document-utility">
                <span className="document-utility-label">Document</span>
                <UploadZone
                  label="Artwork File"
                  accept=".pdf,.png,.jpg,.jpeg"
                  onFileSelect={handleArtworkSelect}
                  selectedFile={artworkFile}
                  disabled={isExporting || isGeneratingProof}
                  onClear={handleClearArtwork}
                  icon={ImageIcon}
                />
              </div>

              <fieldset className="tool-controls" disabled={isBusy || isScanning}>
              {artworkType === 'pdf' && (
                <div className="pdf-output-settings print-requirements">
                  <label className="select-field" htmlFor="pdf-output-mode">
                    <span>PDF output</span>
                    <select id="pdf-output-mode" value={pdfOutputMode} onChange={event => setPdfOutputMode(event.target.value)}>
                      <option value="preserve">Preserve vectors and source colors</option>
                      <option value="compatibility">Flatten visible artwork (RGB)</option>
                    </select>
                  </label>
                  {pdfOutputMode === 'compatibility' && <>
                    <label className="select-field" htmlFor="compatibility-dpi">
                      <span>Artwork resolution</span>
                      <select id="compatibility-dpi" value={compatibilityDpi} onChange={event => setCompatibilityDpi(Number(event.target.value))}>
                        <option value={600}>600 DPI — fine artwork and text</option>
                        <option value={300}>300 DPI — smaller files</option>
                      </select>
                    </label>
                    <p className="field-help">For objects or gradients that disappear when printed. Bakes the visible artwork into an opaque RGB image on white; the Union Bug stays vector.</p>
                    <p className="field-help">Source text/vectors, CMYK and spot plates become RGB pixels. Source output profiles are removed. Annotations/forms are excluded; overprint is not simulated. Confirm the preview and printer color settings, then test one page. Use a desktop transparency flattener when press colors or vector text must be retained.</p>
                  </>}
                </div>
              )}
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
                  isPdf={artworkType === 'pdf'}
                  imageDpi={imageDpi}
                  onImageDpiChange={setImageDpi}
                  onBleedToggle={() => setBleedEnabledPreservingBug(!bleedEnabled)}
                  bleedAmount={bleedAmount}
                  onBleedAmountChange={setBleedAmountPreservingBug}
                  trimCropEnabled={trimCropEnabled}
                  onTrimCropToggle={() => { setTrimCropEnabled(!trimCropEnabled); setManualCropAmount(0); }}
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
                  onHorizontalAlign={handleHorizontalAlign}
                  onVerticalAlign={handleVerticalAlign}
                  multiPageOptions={multiPageOptions}
                  isMultiPage={artworkType === 'pdf' && totalPages > 1}
                  currentPage={currentPage}
                  totalPages={totalPages}
                  onColorModeChange={handleColorModeChange}
                  onColorSelect={setSelectedColor}
                  onScaleChange={setBugScale}
                  onShowSafeLineToggle={() => setShowSafeLine(!showSafeLine)}
                  onMultiPageOptionsChange={setMultiPageOptions}
                  onResetBug={resetUnionBugSettings}
                  bugFile={bugFile}
                  onBugSelect={handleBugSelect}
                  onClearBug={handleClearBug}
                  isExporting={isExporting}
                />
              ) : (
                <PreflightPanel
                  results={displayedPreflightResults}
                  isScanning={isScanning}
                  bleedAmount={effectiveBleedAmount}
                  onRunFullCheck={handleRunFullPreflight}
                  onCheckProduction={handleCheckProduction}
                  canCheckProduction={Boolean(canExport)}
                  onDownloadReport={handleDownloadPreflightReport}
                  requirements={printRequirements}
                  onRequirementsChange={requirements => { setPrintRequirements(requirements); setPreflightResults(null); }}
                  onFix={handlePreflightFix}
                  onReset={handleResetArtwork}
                  artworkType={artworkType}
                />
              )}

              </fieldset>
              {/* Universal Persistent Export Button at bottom of sidebar */}
              <div className="export-area">
                {exportError && <p className="field-error" role="alert">{exportError}</p>}
                {(pdfBoxInfo?.hasSourceAnnotations || pdfBoxInfo?.hasSourceForms) && (
                  <p className="field-help">Source annotations/forms are present. Bleed, crop, compatibility, and customer-proof exports omit their appearances. Flatten intended printable appearances before those operations.</p>
                )}
                <div className="proof-export-section">
                  <div className="export-heading">
                    <strong>Customer proof</strong>
                    <span>{pdfOutputMode === 'compatibility' && artworkType === 'pdf' ? `Visible artwork flattened at ${compatibilityDpi} DPI in RGB.` : 'Losslessly optimized while preserving original PDF colors.'}</span>
                  </div>
                  <label className="proof-id-field" htmlFor="proof-id">
                    <span>Estimate or invoice number</span>
                    <input
                      id="proof-id"
                      type="text"
                      value={proofId}
                      maxLength={80}
                      placeholder="Example: EST-1042"
                      onChange={(event) => setProofId(event.target.value)}
                    />
                  </label>
                  <button
                    className="btn btn-secondary btn-action-block"
                    onClick={handleCustomerProofExport}
                    disabled={!canExport}
                  >
                    {isGeneratingProof ? (
                      <>
                        <UploadCloud size={18} className="spinner" style={{ animation: 'spin 1s linear infinite' }} />
                        Creating proof...
                      </>
                    ) : (
                      <>
                        <ClipboardCheck size={18} />
                        Create Customer Proof PDF
                      </>
                    )}
                  </button>
                </div>
                <div className="export-heading">
                  <strong>Production file</strong>
                  <span>{pdfOutputMode === 'compatibility' && artworkType === 'pdf' ? `Compatibility PDF · ${compatibilityDpi} DPI RGB artwork.` : 'Save the current output as a production file.'}</span>
                </div>
                <button
                  className={`btn btn-action-block ${
                    activeSidebarTab === 'stamper' || artworkType !== 'pdf' || preflightResults
                      ? 'btn-primary'
                      : 'btn-secondary'
                  }`}
                  onClick={handleUniversalExport}
                  disabled={!canExport}
                >
                  {isExporting ? (
                    <>
                      <UploadCloud size={18} className="spinner" style={{ animation: 'spin 1s linear infinite' }} />
                      Generating file...
                    </>
                  ) : (
                    <>
                      <ClipboardCheck size={18} />
                      Save Production File
                    </>
                  )}
                </button>
              </div>

            </aside>
          </>
        )}
      </main>

      {/* Global loading spinner screen */}
      {isLoading && (
        <div className="loading-overlay" role="status" aria-live="polite">
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
            <p>Drop a PDF, PNG, JPG, or JPEG to open the editor.</p>
          </div>
        </div>
      )}
    </div>
  );
}
