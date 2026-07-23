import { useState } from 'react';
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignStartHorizontal,
  AlignStartVertical,
  Check,
  ChevronDown,
  FileText,
  RotateCcw,
  ShieldCheck
} from 'lucide-react';
import UploadZone from './UploadZone';
import { parseCustomPageSelection } from '../utils/pageSelection';

const PAGE_ALIGNMENT_ROWS = [
  [
    ['vertical', 'top', 'Top', AlignStartHorizontal],
    ['horizontal', 'left', 'Left', AlignStartVertical]
  ],
  [
    ['vertical', 'middle', 'Middle', AlignCenterHorizontal],
    ['horizontal', 'center', 'Center', AlignCenterVertical]
  ],
  [
    ['vertical', 'bottom', 'Bottom', AlignEndHorizontal],
    ['horizontal', 'right', 'Right', AlignEndVertical]
  ]
];

function WorkflowSection({ id, title, description, activeSection, onToggle, children }) {
  const isOpen = activeSection === id;

  return (
    <section className={`workflow-section ${isOpen ? 'open' : ''}`}>
      <button
        type="button"
        className="workflow-section-trigger"
        onClick={() => onToggle(id)}
        aria-expanded={isOpen}
      >
        <span>
          <strong>{title}</strong>
          {description && <small>{description}</small>}
        </span>
        <ChevronDown size={16} />
      </button>
      {isOpen && <div className="workflow-section-content">{children}</div>}
    </section>
  );
}

export default function ControlPanel({
  colorMode,
  selectedColor,
  extractedColors,
  bugScale,
  bugBaseSize,
  minScale = 10,
  maxScale = 300,
  showSafeLine,
  bleedEnabled,
  sourceHasBleed = false,
  onBleedToggle,
  bleedAmount,
  onBleedAmountChange,
  bugEnabled,
  onBugEnabledToggle,
  onHorizontalAlign,
  onVerticalAlign,
  multiPageOptions,
  isMultiPage,
  totalPages,
  onColorModeChange,
  onColorSelect,
  onScaleChange,
  onShowSafeLineToggle,
  onMultiPageOptionsChange,
  trimCropEnabled,
  onTrimCropToggle,
  manualCropAmount,
  onManualCropChange,
  showGrid,
  onShowGridToggle,
  snapToGrid,
  onSnapToGridToggle,
  gridSize,
  onGridSizeChange,
  onResetBug,
  bugFile,
  onBugSelect,
  onClearBug
}) {
  const [activeSection, setActiveSection] = useState('bleed');
  const bleedInches = bleedAmount / 72;
  const [bleedInput, setBleedInput] = useState(bleedInches.toFixed(3));

  const toggleSection = (section) => {
    setActiveSection((current) => current === section ? '' : section);
  };

  const getBugInchDimensions = () => {
    if (!bugBaseSize?.width || !bugBaseSize?.height) return '';
    const width = ((bugBaseSize.width * bugScale) / 100 / 72).toFixed(2);
    const height = ((bugBaseSize.height * bugScale) / 100 / 72).toFixed(2);
    return `${width}" × ${height}"`;
  };

  const commitBleedInput = () => {
    const inches = Number(bleedInput);
    if (Number.isFinite(inches) && inches > 0) {
      onBleedAmountChange(inches * 72);
      setBleedInput(inches.toFixed(3));
    } else {
      setBleedInput(bleedInches.toFixed(3));
    }
  };

  return (
    <div className="sidebar-content workflow-sections">
      <WorkflowSection
        id="bleed"
        title="Bleed & Trim"
        description={bleedEnabled ? `${bleedInches.toFixed(3)}" mirror bleed` : 'Guides and output margins'}
        activeSection={activeSection}
        onToggle={toggleSection}
      >
        <div className="setting-row">
          <div className="setting-copy">
            <strong>{sourceHasBleed ? 'Preserve and extend bleed' : 'Add mirror bleed'}</strong>
            <span>{sourceHasBleed ? 'Existing PDF bleed stays intact.' : 'Mirror artwork beyond each edge.'}</span>
          </div>
          <label className="switch">
            <input type="checkbox" checked={bleedEnabled} onChange={onBleedToggle} />
            <span className="slider-switch" />
          </label>
        </div>

        {bleedEnabled && (
          <div className="sub-setting">
            <label className="field-label" htmlFor="bleed-size">Bleed size</label>
            <div className="inline-field">
              <input
                id="bleed-size"
                type="number"
                min="0.001"
                step="0.001"
                value={bleedInput}
                onChange={(event) => {
                  setBleedInput(event.target.value);
                  const inches = Number(event.target.value);
                  if (event.target.value !== '' && Number.isFinite(inches) && inches > 0) {
                    onBleedAmountChange(inches * 72);
                  }
                }}
                onBlur={commitBleedInput}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    commitBleedInput();
                    event.currentTarget.blur();
                  }
                }}
              />
              <span className="field-suffix">in</span>
              <button
                type="button"
                className="quiet-button"
                onClick={() => {
                  onBleedAmountChange(9);
                  setBleedInput('0.125');
                }}
              >
                Use 0.125"
              </button>
            </div>
          </div>
        )}

        <div className="setting-row">
          <div className="setting-copy">
            <strong>Crop to trim box</strong>
            <span>Use the document trim boundary.</span>
          </div>
          <label className="switch">
            <input type="checkbox" checked={trimCropEnabled} onChange={onTrimCropToggle} />
            <span className="slider-switch" />
          </label>
        </div>

        {trimCropEnabled && (
          <div className="sub-setting">
            <div className="field-heading">
              <label className="field-label" htmlFor="manual-crop">Manual inset</label>
              <span>{(manualCropAmount / 72).toFixed(3)}"</span>
            </div>
            <div className="stepper-control">
              <button type="button" onClick={() => onManualCropChange(Math.max(0, manualCropAmount - 0.072))}>−</button>
              <input
                id="manual-crop"
                type="number"
                min="0"
                step="0.001"
                value={(manualCropAmount / 72).toFixed(3)}
                onChange={(event) => {
                  const value = Number(event.target.value);
                  if (Number.isFinite(value)) onManualCropChange(value * 72);
                }}
              />
              <button type="button" onClick={() => onManualCropChange(manualCropAmount + 0.072)}>+</button>
            </div>
          </div>
        )}

        <div className="setting-row">
          <div className="setting-copy">
            <strong>Safe zone guide</strong>
            <span>Show trim and safety boundaries.</span>
          </div>
          <label className="switch">
            <input type="checkbox" checked={showSafeLine} onChange={onShowSafeLineToggle} />
            <span className="slider-switch" />
          </label>
        </div>
      </WorkflowSection>

      <WorkflowSection
        id="bug"
        title="Union Bug"
        description={bugEnabled ? `Enabled · ${getBugInchDimensions()}` : 'Optional artwork stamp'}
        activeSection={activeSection}
        onToggle={toggleSection}
      >
        <div className="setting-row">
          <div className="setting-copy">
            <strong>Apply Union Bug</strong>
            <span>Add the approved vector mark.</span>
          </div>
          <label className="switch">
            <input type="checkbox" checked={bugEnabled} onChange={onBugEnabledToggle} />
            <span className="slider-switch" />
          </label>
        </div>

        {bugEnabled && (
          <>
            <div className="field-heading">
              <span className="field-label">Size</span>
              <span>{bugScale}% · {getBugInchDimensions()}</span>
            </div>
            <input
              type="range"
              min={minScale}
              max={maxScale}
              value={bugScale}
              onChange={(event) => onScaleChange(Number(event.target.value))}
            />

            <div className="field-label">Color</div>
            <div className="segmented-control three-up">
              {[
                ['auto', 'Auto'],
                ['preset', 'Palette'],
                ['custom', 'Custom']
              ].map(([mode, label]) => (
                <button
                  type="button"
                  key={mode}
                  className={colorMode === mode ? 'active' : ''}
                  onClick={() => onColorModeChange(mode)}
                >
                  {label}
                </button>
              ))}
            </div>

            {colorMode === 'auto' && (
              <div className="inline-note">
                <ShieldCheck size={16} />
                Black or white is selected for contrast.
              </div>
            )}

            {colorMode === 'preset' && (
              <div className="color-grid compact">
                {extractedColors.map((color) => (
                  <button
                    type="button"
                    key={color}
                    className={`color-option ${selectedColor.toLowerCase() === color.toLowerCase() ? 'active' : ''}`}
                    style={{ backgroundColor: color }}
                    onClick={() => onColorSelect(color)}
                    aria-label={`Use color ${color}`}
                  >
                    {selectedColor.toLowerCase() === color.toLowerCase() && <Check size={15} />}
                  </button>
                ))}
              </div>
            )}

            {colorMode === 'custom' && (
              <label className="color-picker-wrapper">
                <input
                  type="color"
                  className="color-picker-input"
                  value={selectedColor}
                  onChange={(event) => onColorSelect(event.target.value)}
                />
                <span className="color-picker-text">{selectedColor}</span>
              </label>
            )}

            <div className="subsection-heading">Placement</div>

            <div className="field-label">Align to page</div>
            <div className="page-alignment-grid" aria-label="Align Union Bug to page">
              {PAGE_ALIGNMENT_ROWS.flat().map(([axis, alignment, label, Icon]) => (
                <button
                  type="button"
                  key={`${axis}-${alignment}`}
                  onClick={() => axis === 'vertical'
                    ? onVerticalAlign(alignment)
                    : onHorizontalAlign(alignment)}
                  aria-label={`Align ${label.toLowerCase()}`}
                  title={`Align ${label.toLowerCase()}`}
                >
                  <Icon size={18} strokeWidth={2} aria-hidden="true" />
                  <span>{label}</span>
                </button>
              ))}
            </div>

            <div className="setting-row">
              <div className="setting-copy">
                <strong>Show grid</strong>
                <span>Display placement guides.</span>
              </div>
              <label className="switch">
                <input type="checkbox" checked={showGrid} onChange={onShowGridToggle} />
                <span className="slider-switch" />
              </label>
            </div>

            <div className="setting-row">
              <div className="setting-copy">
                <strong>Snap to grid</strong>
                <span>Snap while dragging the mark.</span>
              </div>
              <label className="switch">
                <input type="checkbox" checked={snapToGrid} onChange={onSnapToGridToggle} />
                <span className="slider-switch" />
              </label>
            </div>

            {(showGrid || snapToGrid) && (
              <>
                <div className="field-label">Grid size</div>
                <div className="segmented-control three-up">
                  {[0.0625, 0.125, 0.25].map((size) => (
                    <button
                      type="button"
                      key={size}
                      className={gridSize === size ? 'active' : ''}
                      onClick={() => onGridSizeChange(size)}
                    >
                      {size}"
                    </button>
                  ))}
                </div>
              </>
            )}

            {isMultiPage && (() => {
              const customSelection = parseCustomPageSelection(multiPageOptions.customPages || '', totalPages);
              return (
              <div className="select-field">
                <span className="field-label">Apply to pages</span>
                <select
                  value={multiPageOptions.applyTo}
                  onChange={(event) => onMultiPageOptionsChange({ ...multiPageOptions, applyTo: event.target.value })}
                >
                  <option value="current">Current page only</option>
                  <option value="all">All pages</option>
                  <option value="last">Last page only</option>
                  <option value="first">First page only</option>
                  <option value="even">Even pages</option>
                  <option value="odd">Odd pages</option>
                  <option value="custom">Custom pages…</option>
                </select>
                {multiPageOptions.applyTo === 'custom' && (
                  <div className="custom-pages-control">
                    <input
                      type="text"
                      value={multiPageOptions.customPages || ''}
                      onChange={(event) => onMultiPageOptionsChange({
                        ...multiPageOptions,
                        customPages: event.target.value
                      })}
                      placeholder="2, 4, 7-10"
                      aria-label="Custom pages"
                      aria-invalid={Boolean(customSelection.error)}
                    />
                    <span className={customSelection.error ? 'field-error' : 'field-help'}>
                      {customSelection.error || `${customSelection.pages.length} page${customSelection.pages.length === 1 ? '' : 's'} selected`}
                    </span>
                  </div>
                )}
              </div>
              );
            })()}

            <button type="button" className="quiet-button reset-action" onClick={onResetBug}>
              <RotateCcw size={14} />
              Reset Union Bug settings
            </button>

            <details className="advanced-settings-details inline-advanced">
              <summary>Change Union Bug source</summary>
              <div className="inline-advanced-content">
                <UploadZone
                  label="Union Bug PDF"
                  accept=".pdf"
                  onFileSelect={onBugSelect}
                  selectedFile={bugFile}
                  onClear={onClearBug}
                  icon={FileText}
                />
              </div>
            </details>
          </>
        )}
      </WorkflowSection>

    </div>
  );
}
