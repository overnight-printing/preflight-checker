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
          <h4 style={{ fontSize: '15px', fontWeight: '600' }}>PDF 전용 기능</h4>
          <p style={{ fontSize: '12px', color: 'var(--text-secondary)', lineHeight: '1.6' }}>
            프리플라이트 검사는 PDF 문서에 최적화되어 있습니다. 이미지 파일은 검사를 진행할 수 없습니다. PDF 아트워크를 업로드해 주세요.
          </p>
        </div>
      </div>
    );
  }

  if (isScanning || !results) {
    return (
      <div className="sidebar-content" style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: '300px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '12px' }}>
          <Loader2 size={32} className="spinner" style={{ animation: 'spin 1s linear infinite', color: 'var(--primary)' }} />
          <span style={{ fontSize: '13px', color: 'var(--text-secondary)' }}>PDF 파일 규격 정밀 분석 중...</span>
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
      case 'bleed': return '미러 도련 추가';
      case 'overprint': return '오버프린트 제거';
      case 'fontEmbedding': return '폰트 아웃라인 변환';
      case 'spotColors': return 'CMYK로 변환';
      case 'blankPages': return '빈 페이지 제거';
      case 'hiddenLayers': return '레이어 병합';
      default: return '자동 수정';
    }
  };

  return (
    <div className="sidebar-content" style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      
      {/* 1. Preflight Title & Reset */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <span className="section-title" style={{ marginBottom: 0 }}>인쇄 적합성 검사 요약</span>
        <button 
          className="btn btn-secondary" 
          style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', borderStyle: 'dashed' }}
          onClick={onReset}
          title="모든 프리플라이트 수정 및 크롭을 취소하고 원본 파일로 되돌립니다."
        >
          🔄 아트워크 초기화
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
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600' }}>패스</span>
          <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--success)', marginTop: '2px' }}>{passedCount}</span>
        </div>
        <div style={{ width: '1px', background: 'var(--border-color)', height: '24px' }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600' }}>경고</span>
          <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--warning)', marginTop: '2px' }}>{warningCount}</span>
        </div>
        <div style={{ width: '1px', background: 'var(--border-color)', height: '24px' }} />
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <span style={{ fontSize: '11px', color: 'var(--text-secondary)', fontWeight: '600' }}>오류 (수정가능)</span>
          <span style={{ fontSize: '18px', fontWeight: '700', color: 'var(--danger)', marginTop: '2px' }}>{errorCount}</span>
        </div>
      </div>

      {/* 3. Checks Checklist */}
      <div className="sidebar-section" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
        <span className="section-title">인쇄 적합성 검사항목 (Preflight Checks)</span>
        
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
    case 'resolution': return '이미지 해상도 (Image Resolution)';
    case 'bleed': return '도련 여백 설정 (Bleed)';
    case 'overprint': return '오버프린트 설정 (Overprint)';
    case 'fontEmbedding': return '폰트 임베딩 (Font Embedding)';
    case 'colorMode': return '색상 모드 (Color Mode)';
    case 'pageSize': return '페이지 규격 및 일치 여부 (Page Size)';
    case 'transparency': return '투명도 효과 (Transparency)';
    case 'spotColors': return '별색 사용 여부 (Spot Colors)';
    case 'blankPages': return '빈 페이지 확인 (Blank Pages)';
    case 'hiddenLayers': return '숨겨진 레이어 (Hidden Layers)';
    case 'pdfVersionCheck': return 'PDF 호환성 버전 (PDF Version)';
    default: return key;
  }
}
