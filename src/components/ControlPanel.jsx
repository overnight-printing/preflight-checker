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
          <span className="section-title" style={{ marginBottom: 0 }}>Enable Union Bug</span>
          <button 
            className="btn btn-secondary" 
            style={{ fontSize: '11px', padding: '4px 8px', borderRadius: '6px', borderStyle: 'dashed' }}
            onClick={onReset}
            title="Reset to original artwork"
          >
            🔄 Reset Artwork
          </button>
        </div>
        <div className="toggle-item" style={{ borderLeft: bugEnabled ? '3px solid var(--primary)' : '1px solid var(--border-color)' }}>
          <div className="toggle-info">
            <h5 style={{ color: bugEnabled ? 'var(--text-primary)' : 'var(--text-secondary)' }}>Apply Union Bug</h5>
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
            <span className="section-title">Quick Align</span>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button
                className="btn btn-secondary"
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '10px 0', fontSize: '11px' }}
                onClick={() => onQuickAlign('left')}
              >
                <AlignLeft size={16} />
                Align Left
              </button>
              <button
                className="btn btn-secondary"
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '10px 0', fontSize: '11px' }}
                onClick={() => onQuickAlign('center')}
              >
                <AlignCenter size={16} />
                Align Center
              </button>
              <button
                className="btn btn-secondary"
                style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '10px 0', fontSize: '11px' }}
                onClick={() => onQuickAlign('right')}
              >
                <AlignRight size={16} />
                Align Right
              </button>
            </div>
            
          </div>

          {/* 2. Style & Size Controls */}
          <div className="sidebar-section">
            <span className="section-title">Bug Size</span>
            <div className="slider-group">
              <div className="slider-labels">
                <span>Scale</span>
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
            <span className="section-title">Bug Color</span>
            
            {/* Preset Modes */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
              <button
                className={`btn ${colorMode === 'auto' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, padding: '6px 12px', fontSize: '12px' }}
                onClick={() => onColorModeChange('auto')}
              >
                Auto Contrast
              </button>
              <button
                className={`btn ${colorMode === 'preset' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, padding: '6px 12px', fontSize: '12px' }}
                onClick={() => onColorModeChange('preset')}
              >
                Palette
              </button>
              <button
                className={`btn ${colorMode === 'custom' ? 'btn-primary' : 'btn-secondary'}`}
                style={{ flex: 1, padding: '6px 12px', fontSize: '12px' }}
                onClick={() => onColorModeChange('custom')}
              >
                Custom
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
                  <span>Auto-optimized to Black or White based on background.</span>
                </div>
              </div>
            )}

            {colorMode === 'preset' && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                <span style={{ fontSize: '12px', color: 'var(--text-secondary)' }}>Recommended Palette</span>
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
        <span className="section-title">Margin Settings</span>

        {/* Mirror Bleed Toggle */}
        <div className="toggle-item" style={{ borderLeft: bleedEnabled ? '3px solid var(--accent)' : '1px solid var(--border-color)' }}>
          <div className="toggle-info">
            <h5 style={{ color: bleedEnabled ? 'var(--text-primary)' : 'var(--text-secondary)' }}>Add 0.125" Mirror Bleed</h5>
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
            <h5 style={{ color: trimCropEnabled ? 'var(--text-primary)' : 'var(--text-secondary)' }}>Crop to Trim Box</h5>
            
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
            <span style={{ fontSize: '12px', fontWeight: '600', color: 'var(--text-primary)' }}>Manual Crop</span>
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
                className={`btn ${manualCropAmount === inch * 72 ? 'btn-primary' : 'btn-secondary'}`}
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
            <h5>Safe Zone Guide</h5>
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
          <span className="section-title">Apply Pages</span>
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
              <option value="current">Current Page Only</option>
              <option value="all">All Pages</option>
              <option value="last">Last Page Only</option>
              <option value="first">First Page Only</option>
            </select>
          </div>
        </div>
      )}
    </div>
  );
}
