import { useState, useRef } from 'react';
import { Upload, FileCode, AlertCircle, RefreshCw, X } from 'lucide-react';

export default function UploadZone({
  label,
  accept,
  onFileSelect,
  selectedFile,
  description,
  onClear, // Optional callback to clear the file
  disabled = false,
  icon: Icon = Upload
}) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState('');
  const fileInputRef = useRef(null);

  const handleDrag = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setIsDragActive(true);
    } else if (e.type === "dragleave") {
      setIsDragActive(false);
    }
  };

  const validateFile = (file) => {
    setError('');
    if (!file) return false;
    if (file.size === 0) { setError('This file is empty. Choose another file.'); return false; }

    // Check extensions
    const fileExtension = file.name.split('.').pop().toLowerCase();
    const acceptedExtensions = accept.split(',').map(ext => ext.trim().replace('.', '').toLowerCase());

    if (!acceptedExtensions.includes(fileExtension)) {
      setError(`Unsupported file format. (Only ${accept} is allowed)`);
      return false;
    }

    return true;
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    if (disabled) return;

    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      if (validateFile(file)) {
        onFileSelect(file);
      }
    }
  };

  const handleChange = (e) => {
    e.preventDefault();
    if (e.target.files && e.target.files[0]) {
      const file = e.target.files[0];
      if (validateFile(file)) {
        onFileSelect(file);
      }
    }
    e.target.value = null;
  };

  const onButtonClick = () => {
    if (!disabled) fileInputRef.current.click();
  };

  return (
    <div className="sidebar-section">
      <div className="section-title-wrapper">
        <span className="section-title">{label}</span>
      </div>

      {selectedFile ? (
        <div className="artwork-mini-card">
          <div className="artwork-info">
            <FileCode size={20} className="logo-icon" />
            <div style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
              <span className="artwork-filename" title={selectedFile.name}>
                {selectedFile.name}
              </span>
              <span style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>
                {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '6px' }}>
            <button 
              className="btn btn-secondary btn-icon-only" 
              onClick={onButtonClick}
              disabled={disabled}
              aria-label={`Change ${label}`}
              title="Change File"
            >
              <RefreshCw size={14} />
            </button>
            {onClear && (
              <button 
                className="btn btn-danger btn-icon-only" 
                onClick={(e) => {
                  e.stopPropagation();
                  onClear();
                }}
                disabled={disabled}
                aria-label={`Remove ${label}`}
                title="Remove File"
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>
      ) : (
        <button
          type="button"
          disabled={disabled}
          aria-label={`Upload ${label}`}
          className={`dropzone ${isDragActive ? 'active' : ''}`}
          onDragEnter={handleDrag}
          onDragOver={handleDrag}
          onDragLeave={handleDrag}
          onDrop={handleDrop}
          onClick={onButtonClick}
        >
          <Icon className="dropzone-icon" size={32} />
          <h5>Click or drag {label} here</h5>
          {description && <p>{description}</p>}
          

        </button>
      )}
      {error && <p className="field-error upload-error" role="alert"><AlertCircle size={14} />{error}</p>}

      <input
        ref={fileInputRef}
        type="file"
        style={{ display: 'none' }}
        disabled={disabled}
        aria-label={label}
        accept={accept}
        onChange={handleChange}
      />
    </div>
  );
}
