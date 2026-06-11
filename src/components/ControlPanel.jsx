import { ShieldCheck, Check, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';

export default function ControlPanel({
  colorMode,         // 'auto', 'black', 'white', 'custom'
  selectedColor,     // hex string
  extractedColors,   // array of hex strings
  bugScale,          // 10 to 300
  bugBaseSize,       // { width, height } in points
  minScale = 10,
  maxScale = 300,
  showSafeLine,      // boolean
  bleedEnabled,      // boolean
  onBleedToggle,     // function
  bugEnabled,        // boolean
  onBugEnabledToggle,// function
  onQuickAlign,      // function: (alignment: 'left' | 'center' | 'right') => void
  multiPageOptions,  // { applyTo: 'current' | 'all' | 'custom', customPages: string }
  isMultiPage,       // boolean
  onColorModeChange,
  onColorSelect,
  onScaleChange,
  onShowSafeLineToggle,
  onMultiPageOptionsChange,
  trimCropEnabled,
  onTrimCropToggle,
  manualCropAmount,
  onManualCropChange,
  onReset
}) {

  const getBugInchDimensions = () => {
    if (!bugBaseSize || !bugBaseSize.width || !bugBaseSize.height) return '';
    const widthInches = ((bugBaseSize.width * bugScale) / 100 / 72).toFixed(2);
    const heightInches = ((bugBaseSize.height * bugScale) / 100 / 72).toFixed(2);
    return `${widthInches}" x ${heightInches}"`;
  };

  const handleScaleChange = (e) => {
    onScaleChange(parseInt(e.target.value, 10));
  };

  const handleCustomColorChange = (e) => {
    onColorSelect(e.target.value);
  };

  return (
    <div className="sidebar-content">
      {/* 0. Toggle Bug Stamping Activity */}
      <div className="sidebar-section">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <span className="section-title" style={{ marginBottom: 0 }}>스탬프 활성화</span>
          <button 
            className="btn btn-secondary" 
            style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', borderStyle: 'dashed' }}
            onClick={onReset}
            title="모든 프리플라이트 수정 및 크롭을 취소하고 원본 파일로 되돌립니다."
          >
            🔄 아트워크 초기화
          </button>
        </div>
        <div className="toggle-item" style={{ borderLeft: bugEnabled ? '3px solid var(--primary)' : '1px solid var(--border-color)' }}>
          <div className="toggle-info">
            <h5 style={{ color: bugEnabled ? 'var(--text-primary)' : 'var(--text-secondary)' }}>유니언버그 인쇄 적용</h5>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={bugEnabled}
              onChange={onBugEnabledToggle}
            />
            <span className="slider-switch" />
          </label>
        </div>
      </div>

      {/* Conditionally render all Union Bug controls ONLY if Bug is enabled */}
      {bugEnabled && (
        <>
          {/* 1. Quick Alignment Tools */}
          <div className="sidebar-section">
            <span className="section-title">퀵 정렬 도구</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="btn btn-secondary"
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '10px 0', fontSize: '11px' }}
                onClick={() => onQuickAlign('left')}
              >
                <AlignLeft size={16} />
                좌측 정렬
              </button>
              <button
                className="btn btn-secondary"
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '10px 0', fontSize: '11px' }}
                onClick={() => onQuickAlign('center')}
              >
                <AlignCenter size={16} />
                가운데 정렬
              </button>
              <button
                className="btn btn-secondary"
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '10px 0', fontSize: '11px' }}
                onClick={() => onQuickAlign('right')}
              >
                <AlignRight size={16} />
                우측 정렬
              </button>
            </div>
            <p style={{ fontSize: '11px', color: 'var(--text-secondary)', textAlign: 'center', marginTop: '6px' }}>
              * 클릭 시 안전 마진 내 하단 영역에 칼같이 정렬 배치됩니다.
            </p>
          </div>

          {/* 2. Style & Size Controls */}
          <div className="sidebar-section">
            <span className="section-title">버그 크기 조절</span>
            <div className="slider-group">
              <div className="slider-labels">
                <span>크기 비율</span>
                <span className="slider-val">{bugScale}% ({getBugInchDimensions()})</span>
              </div>
              <input
                type="range"
                min={minScale}
                max={maxScale}
                value={bugScale}
                onChange={handleScaleChange}
              />
            </div>
          </div>

          {/* 3. Color Theme Picker */}
          <div className="sidebar-section">
            <span className="section-title">버그 색상 변환</span>
            
            {/* Preset Modes */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <button
                className={`btn btn-secondary ${colorMode === 'auto' ? 'btn-primary' : ''}`}
                style={{ flex: 1, padding: '6px 12px', fontSize: '12px' }}
                onClick={() => onColorModeChange('auto')}
              >
                대비 자동
              </button>
              <button
                className={`btn btn-secondary ${colorMode === 'preset' ? 'btn-primary' : ''}`}
                style={{ flex: 1, padding: '6px 12px', fontSize: '12px' }}
                onClick={() => onColorModeChange('preset')}
              >
                팔레트
              </button>
              <button
                className={`btn btn-secondary ${colorMode === 'custom' ? 'btn-primary' : ''}`}
                style={{ flex: 1, padding: '6px 12px', fontSize: '12px' }}
                onClick={() => onColorModeChange('custom')}
              >
                커스텀
              </button>
            </div>

            {/* Dynamic Display based on Mode */}
            {colorMode === 'auto' && (
              <div style={{
                background: 'var(--bg-card)',
                padding: '12px',
                borderRadius: '12px',
                border: '1px solid var(--border-color)',
                fontSize: '12px',
                color: 'var(--text-secondary)',
                display: 'flex',
                alignItems: 'center',
                gap: '8px'
              }}>
                <ShieldCheck size={18} className="logo-icon" style={{ color: 'var(--accent)' }} />
                <div>
                  <span>현재 배치 영역의 배경색 대조 대비에 따라 <strong>블랙</strong> 또는 <strong>화이트</strong>로 자동 최적화됩니다.</span>
                </div>
              </div>
            )}

            {colorMode === 'preset' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>추천 색상 팔레트</span>
                <div className="color-grid">
                  {extractedColors.map((color, index) => (
                    <div
                      key={index}
                      className={`color-option ${selectedColor.toLowerCase() === color.toLowerCase() ? 'active' : ''}`}
                      style={{ backgroundColor: color }}
                      onClick={() => onColorSelect(color)}
                    >
                      {selectedColor.toLowerCase() === color.toLowerCase() && (
                        <Check size={16} className="color-option-icon" />
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {colorMode === 'custom' && (
              <div className="color-picker-wrapper">
                <input
                  type="color"
                  className="color-picker-input"
                  value={selectedColor}
                  onChange={handleCustomColorChange}
                />
                <span className="color-picker-text">{selectedColor}</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* 4. Display Toggles */}
      <div className="sidebar-section">
        <span className="section-title">출력 여백 설정</span>

        {/* Mirror Bleed Toggle */}
        <div className="toggle-item" style={{ borderLeft: bleedEnabled ? '3px solid var(--accent)' : '1px solid var(--border-color)' }}>
          <div className="toggle-info">
            <h5 style={{ color: bleedEnabled ? 'var(--text-primary)' : 'var(--text-secondary)' }}>0.125인치 미러 블리드 추가</h5>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={bleedEnabled}
              onChange={onBleedToggle}
            />
            <span className="slider-switch" />
          </label>
        </div>

        {/* Advanced: Crop to TrimBox Toggle */}
        <div className="toggle-item" style={{ borderLeft: trimCropEnabled ? '3px solid #ff4d4d' : '1px solid var(--border-color)' }}>
          <div className="toggle-info">
            <h5 style={{ color: trimCropEnabled ? 'var(--text-primary)' : 'var(--text-secondary)' }}>재단선 기준으로 자르기</h5>
            <p style={{ fontSize: '10px', color: 'var(--text-secondary)', marginTop: '2px' }}>크랍마크 제거 및 정사이즈 크롭</p>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={trimCropEnabled}
              onChange={onTrimCropToggle}
            />
            <span className="slider-switch" />
          </label>
        </div>

        {/* Manual Margin Inset Controls */}
        <div style={{ 
          marginTop: '12px', 
          padding: '12px', 
          background: 'rgba(255,255,255,0.02)', 
          borderRadius: '12px',
          border: '1px solid var(--border-color)'
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>여백 추가 커트 (Manual)</span>
            <span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: '700' }}>
              {(manualCropAmount / 72).toFixed(3)}"
            </span>
          </div>
          
          <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '12px' }}>
            <button 
              className="btn btn-secondary" 
              style={{ padding: '4px 10px' }}
              onClick={() => onManualCropChange(Math.max(0, manualCropAmount - 0.72))} // -0.01"
            >
              -
            </button>
            <input
              type="text"
              style={{ 
                flex: 1, 
                background: 'var(--bg-input)', 
                border: '1px solid var(--border-color)', 
                borderRadius: '6px', 
                padding: '4px', 
                fontSize: '12px', 
                textAlign: 'center',
                color: 'var(--text-primary)'
              }}
              value={(manualCropAmount / 72).toFixed(3)}
              onChange={(e) => {
                const val = parseFloat(e.target.value);
                if (!isNaN(val)) onManualCropChange(val * 72);
              }}
            />
            <button 
              className="btn btn-secondary" 
              style={{ padding: '4px 10px' }}
              onClick={() => onManualCropChange(manualCropAmount + 0.72)} // +0.01"
            >
              +
            </button>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
            {[0, 0.125, 0.25, 0.375, 0.5].map(inch => (
              <button
                key={inch}
                className={`btn btn-secondary ${manualCropAmount === inch * 72 ? 'btn-primary' : ''}`}
                style={{ flex: 1, padding: '4px 0', fontSize: '10px', minWidth: '45px' }}
                onClick={() => onManualCropChange(inch * 72)}
              >
                {inch === 0 ? 'Reset' : `${inch}"`}
              </button>
            ))}
          </div>
        </div>

        {/* Safe Margin Guide Line Toggle */}
        <div className="toggle-item">
          <div className="toggle-info">
            <h5>안전 영역 가이드</h5>
          </div>
          <label className="switch">
            <input
              type="checkbox"
              checked={showSafeLine}
              onChange={onShowSafeLineToggle}
            />
            <span className="slider-switch" />
          </label>
        </div>
      </div>

      {/* 5. PDF Multipage Apply Settings */}
      {isMultiPage && bugEnabled && (
        <div className="sidebar-section">
          <span className="section-title">스탬프 적용 페이지</span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
            <select
              style={{
                background: 'var(--bg-input)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-color)',
                borderRadius: '12px',
                padding: '10px 14px',
                fontSize: '13px',
                outline: 'none',
                cursor: 'pointer'
              }}
              value={multiPageOptions.applyTo}
              onChange={(e) => onMultiPageOptionsChange({ ...multiPageOptions, applyTo: e.target.value })}
            >
              <option value="current">현재 페이지만 적용</option>
              <option value="all">모든 페이지에 적용</option>
              <option value="last">마지막 페이지에만 적용</option>
              <option value="first">첫 번째 페이지에만 적용</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
