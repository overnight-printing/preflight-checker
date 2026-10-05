import { useEffect, useRef } from 'react';
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';

function PageThumbnail({ pdfDoc, pageNum, isActive, onClick }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    let active = true;
    let renderTask;
    const renderThumb = async () => {
      try {
        const page = await pdfDoc.getPage(pageNum);
        // Render at a very low resolution for fast thumbnail loading
        const viewport = page.getViewport({ scale: 0.15 });
        
        if (!canvasRef.current || !active) return;
        const canvas = canvasRef.current;
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        const context = canvas.getContext('2d');
        
        const renderContext = {
          canvasContext: context,
          viewport: viewport
        };
        renderTask = page.render(renderContext);
        await renderTask.promise;
      } catch (error) {
        if (error.name === 'RenderingCancelledException') return;
        console.error(`Error rendering thumbnail for page ${pageNum}:`, error);
      }
    };

    renderThumb();
    return () => {
      active = false;
      renderTask?.cancel();
    };
  }, [pdfDoc, pageNum]);

  return (
    <button
      type="button"
      aria-current={isActive ? 'page' : undefined}
      className={`page-thumbnail-item ${isActive ? 'active' : ''}`}
      onClick={onClick}
      title={`Go to page ${pageNum}`}
    >
      <canvas ref={canvasRef} />
      <span className="thumb-page-num">Page {pageNum}</span>
    </button>
  );
}

export default function PageSelector({
  currentPage,
  totalPages,
  onPageChange,
  pdfDoc,
  isExpanded,
  onToggleExpand
}) {
  if (totalPages <= 1) return null;

  return (
    <div className="page-selector-container">
      {/* Centered Expand/Collapse toggle tab on the top border */}
      <button
        className={`toggle-previews-btn ${isExpanded ? 'active' : ''}`}
        onClick={onToggleExpand}
        aria-label={isExpanded ? "Hide page previews" : "Show page previews"}
        aria-expanded={isExpanded}
        title={isExpanded ? "Hide Page Previews" : "Show Page Previews"}
      >
        {isExpanded ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </button>

      {/* Collapsible Thumbnail Strip Wrapper */}
      {pdfDoc && isExpanded && (
        <div className={`thumbnail-strip-wrapper ${isExpanded ? 'expanded' : ''}`}>
          <div className="thumbnail-strip">
            {Array.from({ length: totalPages }, (_, i) => i + 1).map((pageNum) => (
              <PageThumbnail
                key={pageNum}
                pdfDoc={pdfDoc}
                pageNum={pageNum}
                isActive={pageNum === currentPage}
                onClick={() => onPageChange(pageNum)}
              />
            ))}
          </div>
        </div>
      )}

      {/* Numeric Page Controls */}
      <div className="page-selector-bar">
        <button
          className="btn btn-secondary btn-icon-only"
          aria-label="Previous page"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 1}
        >
          <ChevronLeft size={16} />
        </button>

        <span className="page-indicator" role="status">
          Page <span>{currentPage}</span> of <span>{totalPages}</span>
        </span>

        <button
          className="btn btn-secondary btn-icon-only"
          aria-label="Next page"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages}
        >
          <ChevronRight size={16} />
        </button>
      </div>
    </div>
  );
}
