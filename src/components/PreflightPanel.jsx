import { 
  CheckCircle2, 
  AlertTriangle, 
  XCircle, 
  Loader2, 
  AlertCircle
} from 'lucide-react';


export default function PreflightPanel({
  results,
  isScanning,
  onRunFullCheck,
  onFix,
  onReset,
  artworkType
}) {

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
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
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
          <span className="section-title">Full Preflight</span>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.5' }}>
            Run this when you need image DPI, fonts, color spaces, spot colors, overprint, hidden layers, and blank page checks.
          </p>
          <button
            className="btn btn-primary btn-action-block"
            style={{ padding: '12px', fontSize: '14px' }}
            onClick={onRunFullCheck}
          >
            Analyze PDF
          </button>
        </div>
      </div>
    );
  }

  // Calculate status summary count
  const checkKeys = Object.keys(results.checks);
  let passedCount = 0;
  let warningCount = 0;
  let errorCount = 0;

  checkKeys.forEach(key => {
    const status = results.checks[key].status;
    if (status === 'pass') passedCount++;
    else if (status === 'warning') warningCount++;
    else if (status === 'error') errorCount++;
  });

  const getStatusIcon = (check) => {
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
      case 'overprint': return 'Remove Overprint';
      case 'fontEmbedding': return 'Outline Fonts';
      case 'spotColors': return 'Convert to CMYK';
      case 'blankPages': return 'Remove Blank Pages';
      case 'hiddenLayers': return 'Flatten Layers';
      default: return 'Auto Fix';
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
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600' }}>Error (Fixable)</span>
          <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--danger)', marginTop: '2px' }}>{errorCount}</span>
        </div>
      </div>

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
            const isFixable = check.fixable && isFailed;

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
                      {check.details}
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
    case 'spotColors': return 'Spot Colors';
    case 'blankPages': return 'Blank Pages';
    case 'hiddenLayers': return 'Hidden Layers';
    case 'pdfVersionCheck': return 'PDF Version';
    default: return key;
  }
}
