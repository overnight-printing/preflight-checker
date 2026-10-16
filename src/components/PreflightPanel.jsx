import { useState } from 'react';
import DecimalInput from './DecimalInput';
import {
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Loader2, 
  AlertCircle,
  Info
} from 'lucide-react';


export default function PreflightPanel({
  currentPage,
  results,
  isScanning,
  onRunFullCheck,
  onCheckProduction,
  canCheckProduction,
  onDownloadReport,
  requirements,
  onRequirementsChange,
  onFix,
  onReset,
  artworkType,
  compatibilityDpi,
  onCompatibilityDpiChange,
  bleedAmount = 0
}) {
  const [requirementsOpen, setRequirementsOpen] = useState(false);
  const orderSizes = { card: [252, 144], postcard: [432, 288], letter: [612, 792] };
  const orderPreset = !requirements.orderSize ? 'none' : Object.keys(orderSizes).find(key => orderSizes[key][0] === requirements.orderSize.width && orderSizes[key][1] === requirements.orderSize.height) || 'custom';
  const requirementsPanel = (
    <details className="print-requirements" open={requirementsOpen} onToggle={event => setRequirementsOpen(event.currentTarget.open)}>
      <summary>Job requirements</summary>
      <label className="select-field">Finished order size
        <select aria-label="Finished order size" value={orderPreset} onChange={event => {
          const preset = event.target.value;
          const size = preset === 'custom' ? [72, 72] : orderSizes[preset];
          onRequirementsChange({ ...requirements, orderSize: size ? { width: size[0], height: size[1] } : null });
        }}>
          <option value="none">Not specified — compare pages</option>
          <option value="card">Business card — 3.5 × 2 in</option>
          <option value="postcard">Postcard — 6 × 4 in</option>
          <option value="letter">Letter — 8.5 × 11 in</option>
          <option value="custom">Custom size</option>
        </select>
      </label>
      {requirements.orderSize && ['width', 'height'].map(key => (
        <label className="select-field" key={key}>Order {key} (inches)
          <DecimalInput aria-label={`Order ${key} in inches`} min={0.01} precision={4} value={requirements.orderSize[key] / 72}
            onCommit={inches => onRequirementsChange({ ...requirements, orderSize: { ...requirements.orderSize, [key]: inches * 72 } })} />
        </label>
      ))}
      <label className="select-field">Print workflow
        <select aria-label="Print workflow" value={requirements.workflow} onChange={event => onRequirementsChange({ ...requirements, workflow: event.target.value })}>
          <option value="general">General commercial printing</option>
          <option value="pdfx4">PDF/X-4 job requirements</option>
          <option value="legacy">Legacy PDF/X-1a job requirements</option>
        </select>
      </label>
      <label className="select-field">Minimum image resolution
        <select aria-label="Minimum image resolution" value={requirements.minDpi} onChange={event => onRequirementsChange({ ...requirements, minDpi: Number(event.target.value) })}>
          {[150, 200, 250, 300, 600, 1200].map(dpi => <option key={dpi} value={dpi}>{dpi} DPI</option>)}
        </select>
      </label>
      <label className="select-field">Required bleed on each edge
        <select aria-label="Required bleed on each edge" value={requirements.bleedPoints} onChange={event => onRequirementsChange({ ...requirements, bleedPoints: Number(event.target.value) })}>
          <option value={0}>No bleed required for this job</option>
          <option value={3 * 72 / 25.4}>3 mm</option>
          <option value={9}>0.125 in (3.175 mm)</option>
          <option value={5 * 72 / 25.4}>5 mm</option>
        </select>
      </label>
      <p className="field-help">300 DPI and 0.125-inch bleed are starting targets. Use the job ticket for final size, bleed, ink plates, and press/paper profile. Higher resolution may be needed for bitmap line art. PDF/X choices check requirements and metadata; they do not certify conformance.</p>
    </details>
  );

  if (artworkType !== 'pdf') {
    return (
      <div className="sidebar-content" style={{ padding: '24px' }}>
        <div style={{
          background: 'var(--bg-card)',
          border: '1px solid var(--border-color)',
          borderRadius: '16px',
          padding: '24px 16px',
          textAlign: 'center',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '12px'
        }}>
          <AlertCircle size={36} style={{ color: 'var(--warning)' }} />
          <h4 style={{ fontSize: '15px', fontWeight: '600' }}>PDF Only</h4>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            Preflight is only supported for PDF files. Please upload a PDF.
          </p>
        </div>
      </div>
    );
  }

  if (isScanning) {
    return (
      <div className="sidebar-content" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
        <div role="status" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <Loader2 size={32} className="spinner" style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} />
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>Running full preflight...</span>
        </div>
      </div>
    );
  }

  if (!results) {
    return (
      <div className="sidebar-content" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="section-title" style={{ marginBottom: 0 }}>Preflight Summary</span>
          <button
            className="btn btn-secondary"
            style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', borderStyle: 'dashed' }}
            onClick={onReset}
            title="Reset to original artwork"
          >
            Reset Artwork
          </button>
        </div>

        <div className="sidebar-section" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {requirementsPanel}
          <span className="section-title">Full Preflight</span>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            Find print issues and apply available repairs for bleed, finished boxes and blank pages. Last-resort RGB flattening is available for printer rendering failures. Save Production File downloads the repaired PDF.
          </p>
          <button
            className="btn btn-primary btn-action-block"
            style={{ padding: '12px', fontSize: '14px' }}
            onClick={onRunFullCheck}
          >
            Analyze PDF
          </button>
          <button className="btn btn-secondary btn-action-block" onClick={onCheckProduction} disabled={!canCheckProduction}>Check production output</button>
          <p className="field-help">Analyze PDF checks the source. Check production output checks the final PDF with the current crop, bleed, and Union Bug settings.</p>
        </div>
      </div>
    );
  }

  // Calculate status summary count
  const checkKeys = Object.keys(results.checks);
  let passedCount = 0;
  let warningCount = 0;
  let errorCount = 0;
  let infoCount = 0;

  checkKeys.forEach(key => {
    const status = results.checks[key].status;
    if (status === 'pass') passedCount++;
    else if (status === 'warning') warningCount++;
    else if (status === 'error') errorCount++;
    else if (status === 'info') infoCount++;
  });

  const getStatusIcon = (check) => {
    if (check.status === 'info') return <Info size={16} style={{ color: 'var(--primary-hover)' }} />;
    if (check.status === 'pass') {
      return <CheckCircle2 size={16} style={{ color: 'var(--success)' }} />;
    } else if (check.status === 'warning') {
      return <AlertTriangle size={16} style={{ color: 'var(--warning)' }} />;
    } else {
      return <XCircle size={16} style={{ color: 'var(--danger)' }} />;
    }
  };

  const getFixButtonText = (key) => {
    switch(key) {
      case 'bleed': return 'Add Mirror Bleed';
      case 'orderBoxes': return 'Set Boxes to Order';
      case 'blankPages': return 'Review and Remove Blank Pages';
      default: return 'Apply Repair';
    }
  };

  return (
    <div className="sidebar-content" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* 1. Preflight Title & Reset */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="section-title" style={{ marginBottom: 0 }}>Preflight Summary</span>
        <button 
          className="btn btn-secondary" 
          style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', borderStyle: 'dashed' }}
          onClick={onReset}
          title="Reset to original artwork"
        >
          Reset Artwork
        </button>
      </div>

      {requirementsPanel}
      <div className={`print-readiness ${errorCount ? 'has-errors' : ''}`} role="status">
        <strong>{errorCount ? 'Resolve errors before printing' : warningCount ? 'Review before printing' : 'Checks passed; confirm the job ticket'}</strong>
        <span>{results.scope === 'production' ? 'Checked production output' : results.artworkRepair ? 'Checked repaired artwork' : 'Checked source PDF'} · {requirements.minDpi} DPI target · {(requirements.bleedPoints / 72).toFixed(3)}" bleed</span>
        <p>Review edge artwork, safe margins, separations, and the press profile. Full PDF/X conformance and RIP output are not certified here.</p>
      </div>

      {/* 2. Scanning Summary Stats */}
      <div style={{
        background: 'rgba(255,255,255,0.02)',
        border: '1px solid var(--border-color)',
        borderRadius: '12px',
        padding: '12px 16px',
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center'
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600' }}>Pass</span>
          <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--success)', marginTop: '2px' }}>{passedCount}</span>
        </div>
        <div style={{ width: '1px', background: 'var(--border-color)', height: '24px' }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600' }}>Warning</span>
          <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--warning)', marginTop: '2px' }}>{warningCount}</span>
        </div>
        <div style={{ width: '1px', background: 'var(--border-color)', height: '24px' }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600' }}>Errors</span>
          <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--danger)', marginTop: '2px' }}>{errorCount}</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600' }}>Info</span>
          <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--primary-hover)', marginTop: '2px' }}>{infoCount}</span>
        </div>
      </div>

      <div className="preflight-actions">
        <button className="btn btn-secondary btn-action-block" onClick={onCheckProduction} disabled={!canCheckProduction}>Check production output</button>
        <button className="btn btn-secondary btn-action-block" onClick={onDownloadReport}>Download preflight report</button>
      </div>

      {results.scope !== 'production' && ['transparency', 'gradients', 'imageMasks', 'hiddenLayers'].some(key => results.checks[key] && results.checks[key].status !== 'pass') && (
        <div className="print-requirements">
          <strong>Last resort: repair disappearing artwork</strong>
          <p className="field-help">Repairs only the displayed page ({currentPage}). Navigate to each affected page before applying. If objects, masks or gradients disappear in print, this bakes the saved visible artwork into an opaque image. The preview and preflight checks update after applying the repair.</p>
          <label className="select-field">Repair resolution
            <select aria-label="Repair resolution" value={compatibilityDpi} onChange={event => onCompatibilityDpiChange(Number(event.target.value))}>
              <option value={600}>600 DPI — fine artwork and text</option>
              <option value={300}>300 DPI — smaller files</option>
            </select>
          </label>
          <p className="field-help">Converts source text, vectors, CMYK and spot plates to RGB pixels on white. Removes source press profiles and excludes annotations/forms. Overprint is not simulated; higher DPI cannot restore missing image detail. Review colors and test a printed page. Reset Artwork restores the original.</p>
          <button className="btn btn-secondary btn-action-block" onClick={() => onFix('flattenArtwork')}>Apply flattening repair (RGB)</button>
        </div>
      )}
      <p className="field-help">Use the repair buttons for supported issues, then Check production output and Save Production File. Missing fonts, low-resolution originals and press color conversion require source artwork or a prepress editor.</p>

      {/* 3. Checks Checklist */}
      <div className="sidebar-section" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px' }}>
          <span className="section-title" style={{ marginBottom: 0 }}>Preflight Checks</span>
          <button
            className="btn btn-secondary"
            style={{ padding: '6px 10px', fontSize: '12px', borderRadius: '6px' }}
            onClick={onRunFullCheck}
          >
            Re-analyze
          </button>
        </div>
        
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
          {Object.entries(results.checks).map(([key, check]) => {
            const isFailed = check.status !== 'pass';
            const pendingBleed = results.scope !== 'production' && key === 'bleed' && isFailed && bleedAmount > 0 && bleedAmount >= requirements.bleedPoints - 0.01;
            const isFixable = results.scope !== 'production' && check.fixable && isFailed && !pendingBleed;

            return (
              <div 
                key={key} 
                className="toggle-item" 
                style={{ 
                  flexDirection: 'column', 
                  alignItems: 'stretch', 
                  gap: '8px',
                  background: isFailed ? 'rgba(255,255,255,0.01)' : 'var(--bg-card)',
                  borderColor: check.status === 'error' ? 'rgba(239, 68, 68, 0.2)' : 
                               check.status === 'warning' ? 'rgba(245, 158, 11, 0.2)' : 'var(--border-color)',
                  padding: '12px 14px'
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%' }}>
                  <div style={{ flexShrink: 0 }}>
                    {getStatusIcon(check)}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <h5 style={{ 
                      fontSize: '14px', 
                      fontWeight: '600', 
                      color: isFailed ? 'var(--text-primary)' : 'var(--text-secondary)'
                    }}>
                      {getCheckTitle(key)}
                    </h5>
                    <p style={{ 
                      fontSize: '12px', 
                      color: isFailed ? 'var(--text-secondary)' : 'var(--text-muted)',
                      marginTop: '4px',
                      lineHeight: '1.4'
                    }}>
                      {pendingBleed ? `${(bleedAmount / 72).toFixed(3)}" additional mirror bleed is scheduled for export. The scan describes the source PDF.` : check.details}
                    </p>
                  </div>
                </div>

                {isFixable && (
                  <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '4px' }}>
                    <button
                      className="btn btn-secondary"
                      style={{ 
                        padding: '6px 12px', 
                        fontSize: '12px', 
                        borderRadius: '6px',
                        borderColor: check.status === 'error' ? 'rgba(239, 68, 68, 0.3)' : 'var(--border-color)',
                        background: check.status === 'error' ? 'rgba(239, 68, 68, 0.05)' : 'rgba(255,255,255,0.02)',
                        color: check.status === 'error' ? 'var(--danger)' : 'var(--text-primary)'
                      }}
                      onClick={() => onFix(key)}
                    >
                      {getFixButtonText(key)}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function getCheckTitle(key) {
  switch (key) {
    case 'resolution': return 'Image Resolution';
    case 'bleed': return 'Bleed Margin';
    case 'overprint': return 'Overprint';
    case 'fontEmbedding': return 'Font Embedding';
    case 'colorMode': return 'Color Mode';
    case 'pageSize': return 'Page Size Match';
    case 'transparency': return 'Transparency';
    case 'gradients': return 'Gradients & Shadings';
    case 'imageMasks': return 'Image Masks';
    case 'spotColors': return 'Spot Colors';
    case 'blankPages': return 'Blank Pages';
    case 'hiddenLayers': return 'Hidden Layers';
    case 'pdfVersionCheck': return 'PDF Version';
    case 'pageGeometry': return 'Finished Trim & Page Boxes';
    case 'outputIntent': return 'Press Output Profile';
    case 'pdfxStandard': return 'PDF/X Declaration';
    case 'interactiveContent': return 'Annotations & Forms';
    case 'pageUnits': return 'Physical Page Units';
    case 'orderBoxes': return 'Order Trim & Bleed Boxes';
    case 'contentScan': return 'Content Inspection';
    default: return key;
  }
}
