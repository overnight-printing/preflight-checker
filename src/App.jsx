import { useState, useEffect, useCallback, useRef } from 'react';
import { HelpCircle, Shield, FileText, Image as ImageIcon, Sparkles, ClipboardCheck, Sun, Moon, Monitor, UploadCloud } from 'lucide-react';
import UploadZone from './components/UploadZone';
import EditorCanvas from './components/EditorCanvas';
import ControlPanel from './components/ControlPanel';
import PageSelector from './components/PageSelector';
import PreflightPanel from './components/PreflightPanel';

import {
  loadPDF,
  getPDFBoxInfo,
  renderPDFPageToCanvas,
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

  // Bleed settings
  const [bleedEnabled, setBleedEnabled] = useState(false);
  const [trimCropEnabled, setTrimCropEnabled] = useState(false); // New non-destructive crop toggle
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
  
  // Multi-page options
  const [multiPageOptions, setMultiPageOptions] = useState({
    applyTo: 'current', // 'current' | 'all' | 'last' | 'first'
  });

  // Track if we completed the initial alignment placement for a newly loaded artwork
  const [hasDoneInitialAlignment, setHasDoneInitialAlignment] = useState(false);

  // Collapsible page thumbnails strip state
  const [isThumbnailsExpanded, setIsThumbnailsExpanded] = useState(false);

  // Safe zone is ALWAYS 9pt (0.125") inside the trim/cut line — hardcoded, not adjustable

  // Utility to format PDF points (pt) into physical dimensions (inches & millimeters)
  const formatPtToPhysical = (width, height) => {
    if (!width || !height) return 'N/A';
    const wInch = (width / 72).toFixed(2);
    const hInch = (height / 72).toFixed(2);
    const wMm = (width * 0.352778).toFixed(1);
    const hMm = (height * 0.352778).toFixed(1);
    return `${wInch}" x ${hInch}" (${wMm} x ${hMm} mm)`;
  };



  // Auto-load default Union Bug from public directory on mount
  useEffect(() => {
    const loadDefaultBug = async () => {
      try {
        const response = await fetch('/union-bug-black.pdf');
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

  // 1. Handle Artwork File Upload
  const handleArtworkSelect = useCallback(async (file) => {
    setIsLoading(true);
    setArtworkFile(file);
    setOriginalFile(file); // Store initial upload as backup
    setCurrentAlignment('right'); // Reset to default right alignment on new artwork
    setHasDoneInitialAlignment(false); // Reset initial alignment flag to trigger bottom placement on canvas load
    setOriginalImage(null);
    
    try {
      const extension = file.name.split('.').pop().toLowerCase();
      
      if (extension === 'pdf') {
        setArtworkType('pdf');
        setSourceHasBleed(true); // PDFs are typically print-ready with 0.125" bleed
        const doc = await loadPDF(file);
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
        setOriginalImage(img);
      }
    } catch (error) {
      console.error('Error loading artwork file:', error);
      alert('아트워크 파일을 읽는 중 오류가 발생했습니다.');
      setArtworkFile(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

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
      setSourceHasBleed(extension === 'pdf');
    } catch (error) {
      console.error('Error resetting artwork:', error);
      alert('초기화 중 오류가 발생했습니다.');
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



  // Render a specific PDF page to canvas (called reactively)
  const renderPage = async (doc, pageNum, bleedAmount = 0, trimCrop = false, boxInfo = null) => {
    try {
      const page = await doc.getPage(pageNum);
      const canvas = document.createElement('canvas');
      
      // Render to canvas with bleed parameters (0.125" = 9.0pt) and optional trim crop
      await renderPDFPageToCanvas(page, canvas, canvasScale, bleedAmount, trimCrop, boxInfo);
      setArtworkCanvas(canvas);

      // Extract geometry metadata if we have the file
      if (artworkFile && !boxInfo) {
        const info = await getPDFBoxInfo(artworkFile, pageNum);
        setPdfBoxInfo(info);
      }
      
      // Extract dominant colors from the page background
      const colors = extractDominantColors(canvas, true);
      setExtractedColors(colors);
    } catch (error) {
      console.error(`Error rendering PDF page ${pageNum}:`, error);
    }
  };

  // Helper to render an image artwork to canvas with or without mirror bleed (called reactively)
  const renderImageCanvas = (img, bleed) => {
    const canvas = document.createElement('canvas');
    const W = img.width;
    const H = img.height;
    
    // 0.125" is exactly 9.0 pt in PDF units. In pixels, B = bleedAmount * canvasScale
    const bleedAmount = bleed ? 9.0 : 0;
    const bleedPx = bleedAmount * canvasScale;
    
    if (bleedPx > 0) {
      canvas.width = Math.round(W + (bleedPx * 2));
      canvas.height = Math.round(H + (bleedPx * 2));
      const ctx = canvas.getContext('2d');
      drawMirrorBleed(ctx, img, W, H, bleedPx);
    } else {
      canvas.width = W;
      canvas.height = H;
      const ctx = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);
    }
    
    setArtworkCanvas(canvas);
    
    // Extract dominant colors
    const colors = extractDominantColors(canvas, true);
    setExtractedColors(colors);
  };

  // Reactive Effect: Re-renders the artwork canvas when page, doc, bleed, image, or trimCrop changes
  useEffect(() => {
    if (!artworkFile) return;
    
    const updateArtworkRender = async () => {
      setIsLoading(true);
      try {
        const bleedAmount = bleedEnabled ? 9.0 : 0; // 0.125" = 9.0pt
        
        if (artworkType === 'pdf' && pdfDoc) {
          await renderPage(pdfDoc, currentPage, bleedAmount, trimCropEnabled, pdfBoxInfo);
        } else if (artworkType === 'image' && originalImage) {
          renderImageCanvas(originalImage, bleedEnabled);
        }
      } catch (error) {
        console.error('Error updating artwork render:', error);
      } finally {
        setIsLoading(false);
      }
    };
    
    updateArtworkRender();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bleedEnabled, trimCropEnabled, currentPage, originalImage, pdfDoc, pdfBoxInfo]);

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
      alert('유니언버그 PDF 파일을 읽는 중 오류가 발생했습니다.');
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
        // 프리뷰 렌더링 해상도를 8.0 DPI (약 600 DPI 상당)로 대폭 상향하여 화면 확대 시에도 칼같은 벡터 선명함 유지
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

  // Run preflight checks when artwork file or pdfDoc changes
  useEffect(() => {
    if (!artworkFile || artworkType !== 'pdf' || !pdfDoc) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setPreflightResults(null);
      return;
    }

    const runScan = async () => {
      setIsScanning(true);
      try {
        const results = await runPreflightChecks(artworkFile, pdfDoc);
        setPreflightResults(results);
      } catch (err) {
        console.error('Error running preflight checks:', err);
      } finally {
        setIsScanning(false);
      }
    };

    runScan();
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
      alert(`오류를 해결하는 중 문제가 발생했습니다: ${error.message || '알 수 없는 오류'}`);
    } finally {
      setIsLoading(false);
    }
  };

  // 6. Quick Alignment Logic
  const handleQuickAlign = useCallback((alignment) => {
    if (!artworkCanvas || !bugSize) return;

    if (pdfBoxInfo && pdfBoxInfo.trimBox && pdfBoxInfo.cropBox) {
      // PDF contains professional crop marks and predefined TrimBox/CropBox geometry.
      // We align specifically based on the actual TrimBox, not the extra border margin.
      const { trimBox, cropBox } = pdfBoxInfo;
      
      // If virtual mirror bleed is enabled, the canvas coordinates are offset by 9pt on all edges.
      const virtualBleedOffset = bleedEnabled ? 9.0 : 0.0;
      
      // Calculate coordinates relative to CropBox (offsetting for virtual bleed if active)
      const trimLeft = (trimBox.x - cropBox.x) + virtualBleedOffset;
      const trimWidth = trimBox.width;
      const trimHeight = trimBox.height;
      const trimTop = (cropBox.height - (trimBox.y - cropBox.y + trimHeight)) + virtualBleedOffset;

      // Safe area = 9pt (0.125") inside the active TrimBox
      const safeLeft = trimLeft + 9.0;
      const safeWidth = trimWidth - 18.0;
      const safeHeight = trimHeight - 18.0;
      const safeTop = trimTop + 9.0;

      // Map PDF points to canvas pixels
      const safeLeftPx = safeLeft * canvasScale;
      const safeWidthPx = safeWidth * canvasScale;
      const safeHeightPx = safeHeight * canvasScale;
      const safeTopPx = safeTop * canvasScale;

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
    } else {
      // Fallback for images or PDFs that do not contain a defined TrimBox.
      // We align relative to the canvas outer edges, accounting for optionally added bleed padding.
      const bleedPadding = (sourceHasBleed ? 9.0 : 0.0) + (bleedEnabled ? 9.0 : 0.0);
      const activeSafeMargin = (bleedPadding + 9.0) * canvasScale;

      let left = 100;
      if (alignment === 'left') {
        left = activeSafeMargin;
      } else if (alignment === 'center') {
        left = (artworkCanvas.width / 2) - (bugSize.width / 2);
      } else if (alignment === 'right') {
        left = artworkCanvas.width - activeSafeMargin - bugSize.width;
      }

      setBugPosition((prev) => {
        const defaultTop = artworkCanvas.height - activeSafeMargin - bugSize.height;
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
    }

    if (alignment !== 'custom') {
      setCurrentAlignment(alignment);
    }
  }, [artworkCanvas, bugSize, bleedEnabled, sourceHasBleed, canvasScale, hasDoneInitialAlignment, pdfBoxInfo, currentPage]);

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
  }, [currentAlignment, bleedEnabled, sourceHasBleed, bugSize, artworkCanvas, hasDoneInitialAlignment, handleQuickAlign]);

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
      const bleedAmount = bleedEnabled ? 9.0 : 0; // 0.125" = 9.0pt
      
      if (artworkType === 'pdf') {
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
          bleedAmount, // Pass bleed amount (in points)
          bugEnabled,  // Pass toggle state
          finalPositions,
          finalSizes,
          trimCropEnabled // Pass non-destructive toggle
        );
        
        // Trigger browser download
        const blob = new Blob([outputBytes], { type: 'application/pdf' });
        const link = document.createElement('a');
        link.href = URL.createObjectURL(blob);
        link.download = `${safeFilename}.pdf`;
        link.click();
      } else {
        // Image export (pass bleed in pixels)
        const bleedPx = bleedAmount * canvasScale;
        const finalImageDataUrl = stitchBugToImage(
          artworkCanvas,
          bugCanvas,
          bugPosition,
          bugSize,
          bleedPx,
          bugEnabled // Pass toggle state
        );
        
        const link = document.createElement('a');
        link.href = finalImageDataUrl;
        link.download = `${safeFilename}.png`;
        link.click();
      }
    } catch (error) {
      console.error('Export error:', error);
      alert('파일을 저장하는 중 오류가 발생했습니다.');
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
        <div className="logo-section" onClick={handleClearArtwork} style={{ cursor: 'pointer' }} title="홈페이지로 이동">
          <Shield size={24} className="logo-icon" />
          <h1>Overnight Preflight Tool</h1>
          <span className="logo-badge">v1.2</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {/* Theme switcher */}
          <div className="theme-switcher">
            <button 
              className={`theme-btn ${theme === 'light' ? 'active' : ''}`} 
              onClick={() => setTheme('light')}
              title="라이트 모드"
              style={{ padding: '6px' }}
            >
              <Sun size={14} />
            </button>
            <button 
              className={`theme-btn ${theme === 'dark' ? 'active' : ''}`} 
              onClick={() => setTheme('dark')}
              title="다크 모드"
              style={{ padding: '6px' }}
            >
              <Moon size={14} />
            </button>
            <button 
              className={`theme-btn ${theme === 'system' ? 'active' : ''}`} 
              onClick={() => setTheme('system')}
              title="시스템 설정 따름"
            >
              <Monitor size={14} />
              <span>자동</span>
            </button>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', color: 'var(--text-secondary)', fontSize: '13px' }}>
            <HelpCircle size={16} />
            <span>100% 브라우저 자체 처리 (보안 안전)</span>
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
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', position: 'relative' }}>
              {/* PDF Geometry Specification Dashboard */}
              {pdfBoxInfo && (
                <div className="pdf-geometry-info-card">
                  <div className="info-grid">
                    <div className="info-item">
                      <span className="info-label">Crop Box</span>
                      <span className="info-val" title={formatPtToPhysical(pdfBoxInfo.cropBox.width, pdfBoxInfo.cropBox.height)}>
                        {formatPtToPhysical(pdfBoxInfo.cropBox.width, pdfBoxInfo.cropBox.height)}
                      </span>
                    </div>
                    <div className="info-item" style={{ borderLeft: '3px solid #0055ff' }}>
                      <span className="info-label" style={{ color: '#0055ff' }}>Trim Box</span>
                      <span className="info-val" style={{ color: '#0055ff', fontWeight: '700' }} title={formatPtToPhysical(pdfBoxInfo.trimBox.width, pdfBoxInfo.trimBox.height)}>
                        {formatPtToPhysical(pdfBoxInfo.trimBox.width, pdfBoxInfo.trimBox.height)}
                      </span>
                    </div>
                    <div className="info-item" style={{ borderLeft: '3px solid #ff007f' }}>
                      <span className="info-label" style={{ color: '#ff007f' }}>Bleed Box</span>
                      <span className="info-val" title={formatPtToPhysical(pdfBoxInfo.bleedBox.width, pdfBoxInfo.bleedBox.height)}>
                        {formatPtToPhysical(pdfBoxInfo.bleedBox.width, pdfBoxInfo.bleedBox.height)}
                      </span>
                    </div>
                    <div className="info-item">
                      <span className="info-label">Page</span>
                      <span className="info-val" style={{ fontWeight: '700', color: 'var(--accent)' }}>
                        {currentPage} / {totalPages} Page
                      </span>
                    </div>
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
                sourceHasBleed={sourceHasBleed}
                showSafeLine={showSafeLine}
                bleedEnabled={bleedEnabled} // Draw actual Magenta Trim Line
                trimCropEnabled={trimCropEnabled} // New prop for non-destructive guide lines
                bugEnabled={bugEnabled}
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
                <h2>편집 및 조절 도구</h2>
                <p>유니언버그 위치와 디자인을 세팅하세요</p>
              </div>

              {/* Tab Switcher */}
              <div className="sidebar-tabs">
                <button 
                  className={`tab-btn ${activeSidebarTab === 'preflight' ? 'active' : ''}`}
                  onClick={() => setActiveSidebarTab('preflight')}
                >
                  <ClipboardCheck size={14} />
                  <span>프리플라이트</span>
                </button>
                <button 
                  className={`tab-btn ${activeSidebarTab === 'stamper' ? 'active' : ''}`}
                  onClick={() => setActiveSidebarTab('stamper')}
                >
                  <Sparkles size={14} />
                  <span>스탬퍼 설정</span>
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
                  onBleedToggle={() => setBleedEnabled(!bleedEnabled)}
                  trimCropEnabled={trimCropEnabled}
                  onTrimCropToggle={() => setTrimCropEnabled(!trimCropEnabled)}
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
                  onReset={handleResetArtwork}
                  isExporting={isExporting}
                />
              ) : (
                <PreflightPanel
                  results={preflightResults}
                  isScanning={isScanning}
                  onFix={handlePreflightFix}
                  onReset={handleResetArtwork}
                  artworkType={artworkType}
                  isExporting={isLoading || isScanning || isExporting}
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
                      파일 생성 중...
                    </>
                  ) : (
                    <>
                      <ClipboardCheck size={18} />
                      최종 결과물 저장하기
                    </>
                  )}
                </button>
                <p style={{ fontSize: '10.5px', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '8px' }}>
                  * {bugEnabled ? '유니언버그와 ' : ''}프리플라이트 수정 사항이 모두 반영됩니다.
                </p>
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
          <h4 style={{ fontSize: '15px', fontWeight: '500' }}>파일을 렌더링하고 레이아웃을 불러오는 중...</h4>
        </div>
      )}

      {/* Global Drag and Drop Overlay */}
      {isGlobalDragActive && (
        <div className="global-drag-overlay">
          <div className="global-drag-content">
            <UploadCloud size={48} className="global-drag-icon" />
            <h3>아트워크 PDF/이미지 업로드</h3>
            <p>여기에 파일을 내려놓으면 자동으로 아트워크로 불러와 프리플라이트 검사를 진행합니다.</p>
          </div>
        </div>
      )}
    </div>
  );
}
