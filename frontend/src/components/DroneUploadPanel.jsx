import { useState, useRef, useCallback, useEffect } from 'react';
import { Camera, CheckCircle, XCircle, Satellite, FolderOpen, Rocket, Upload, ArrowUp } from 'lucide-react';
import toast from 'react-hot-toast';
import api from '../api/client';

const MAX_CONCURRENT = 5;
const POLL_INTERVAL = 3000;

function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export default function DroneUploadPanel({ projectId, onComplete }) {
  // ── Upload State ─────────────────────────────
  const [files, setFiles] = useState([]); // [{file, status:'pending'|'uploading'|'done'|'error', progress:0}]
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [totalStaged, setTotalStaged] = useState(0);

  // ── Processing State ─────────────────────────
  const [phase, setPhase] = useState('upload'); // 'upload' | 'processing'
  const [processStatus, setProcessStatus] = useState(null);
  const [processProgress, setProcessProgress] = useState(0);
  const [processMessage, setProcessMessage] = useState('');
  const [processError, setProcessError] = useState('');
  const [jobId, setJobId] = useState(null);

  const fileInputRef = useRef(null);
  const pollRef = useRef(null);
  const dragCounterRef = useRef(0);
  const [isDragging, setIsDragging] = useState(false);

  // ── Cleanup polling on unmount ───────────────
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ── Check for existing drone job on mount ────
  useEffect(() => {
    if (!projectId) return;
    async function checkExistingJob() {
      try {
        const res = await api.get(`/projects/${projectId}/drone-status`);
        const { status, progress, message, error, image_count } = res.data;
        if (['processing', 'downloading', 'tiling', 'queued', 'detecting', 'computing_heights'].includes(status)) {
          setPhase('processing');
          setJobId(res.data.job_id);
          setProcessStatus(status);
          setProcessProgress(progress);
          setProcessMessage(message || '');
          startPolling();
        } else if (status === 'completed') {
          setPhase('processing');
          setProcessStatus('completed');
          setProcessProgress(100);
          setProcessMessage('Processing complete!');
        } else if (status === 'failed') {
          setPhase('processing');
          setProcessStatus('failed');
          setProcessError(error || 'Processing failed.');
        } else if (status === 'uploading') {
          // Resume upload phase — images already staged on disk
          setTotalStaged(image_count || 0);
        }
      } catch {
        // No existing job — stay in upload phase
      }
    }
    checkExistingJob();
  }, [projectId]);

  // ── Drag & Drop Handlers ─────────────────────
  const handleDragEnter = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current++;
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounterRef.current--;
    if (dragCounterRef.current === 0) setIsDragging(false);
  }, []);

  const handleDragOver = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  const handleDrop = useCallback((e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounterRef.current = 0;
    const dropped = Array.from(e.dataTransfer.files).filter(
      f => /\.(jpe?g)$/i.test(f.name)
    );
    if (dropped.length > 0) addFiles(dropped);
  }, [files]);

  // ── File Selection ───────────────────────────
  const addFiles = (newFiles) => {
    setUploadError('');
    const existingNames = new Set(files.map(f => f.file.name));
    const unique = newFiles.filter(f => !existingNames.has(f.name));
    const entries = unique.map(f => ({ file: f, status: 'pending', progress: 0 }));
    setFiles(prev => [...prev, ...entries]);
  };

  const handleFileInput = (e) => {
    const selected = Array.from(e.target.files);
    if (selected.length > 0) addFiles(selected);
    e.target.value = '';
  };

  const removeFile = (name) => {
    setFiles(prev => prev.filter(f => f.file.name !== name));
  };

  // ── Upload Logic (concurrent pool) ───────────
  const uploadFiles = async () => {
    const pending = files.filter(f => f.status === 'pending' || f.status === 'error');
    if (pending.length === 0) return;

    setIsUploading(true);
    setUploadError('');

    // Reset errored files to pending
    setFiles(prev => prev.map(f =>
      f.status === 'error' ? { ...f, status: 'pending', progress: 0 } : f
    ));

    // Build work queue
    const queue = [...pending.map(f => f.file.name)];
    let lastStagedCount = totalStaged;

    const uploadOne = async (fileName) => {
      setFiles(prev => prev.map(f =>
        f.file.name === fileName ? { ...f, status: 'uploading', progress: 0 } : f
      ));

      const entry = files.find(f => f.file.name === fileName) || pending.find(f => f.file.name === fileName);
      if (!entry) return;

      const formData = new FormData();
      formData.append('files', entry.file);

      try {
        const res = await api.post(`/projects/${projectId}/drone-upload`, formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          onUploadProgress: (e) => {
            const pct = Math.round((e.loaded * 100) / (e.total || 1));
            setFiles(prev => prev.map(f =>
              f.file.name === fileName ? { ...f, progress: pct } : f
            ));
          },
        });
        setFiles(prev => prev.map(f =>
          f.file.name === fileName ? { ...f, status: 'done', progress: 100 } : f
        ));
        lastStagedCount = res.data.total_staged;
        setTotalStaged(res.data.total_staged);
        if (res.data.job_id) setJobId(res.data.job_id);
      } catch (err) {
        setFiles(prev => prev.map(f =>
          f.file.name === fileName ? { ...f, status: 'error', progress: 0 } : f
        ));
      }
    };

    // Process in concurrent pool of MAX_CONCURRENT
    const pool = [];
    for (const name of queue) {
      const p = uploadOne(name);
      pool.push(p);
      if (pool.length >= MAX_CONCURRENT) {
        await Promise.race(pool);
        // Remove settled promises
        for (let i = pool.length - 1; i >= 0; i--) {
          const status = await Promise.race([pool[i].then(() => 'done'), Promise.resolve('pending')]);
          if (status === 'done') pool.splice(i, 1);
        }
      }
    }
    await Promise.all(pool);

    setIsUploading(false);

    // Check if any files failed
    setFiles(prev => {
      const failed = prev.filter(f => f.status === 'error');
      if (failed.length > 0) {
        setUploadError(`${failed.length} file(s) failed to upload. Click "Retry Failed" to try again.`);
      }
      return prev;
    });
  };

  // ── Start Processing ─────────────────────────
  const startProcessing = async () => {
    setUploadError('');
    try {
      const res = await api.post(`/projects/${projectId}/drone-process`);
      setJobId(res.data.job_id);
      setPhase('processing');
      setProcessStatus('queued');
      setProcessProgress(0);
      setProcessMessage(res.data.message);
      startPolling();
    } catch (err) {
      setUploadError(err.response?.data?.detail || 'Failed to start processing.');
    }
  };

  // ── Poll Processing Status ───────────────────
  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get(`/projects/${projectId}/drone-status`);
        const { status, progress, message, error } = res.data;
        setProcessStatus(status);
        setProcessProgress(progress);
        setProcessMessage(message || '');

        if (status === 'completed') {
          clearInterval(pollRef.current);
          pollRef.current = null;
        } else if (status === 'failed') {
          setProcessError(error || 'Processing failed.');
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      } catch {
        // Tolerate transient polling errors
      }
    }, POLL_INTERVAL);
  };

  // ── Reset to re-upload ───────────────────────
  const resetToUpload = () => {
    setPhase('upload');
    setProcessStatus(null);
    setProcessProgress(0);
    setProcessMessage('');
    setProcessError('');
    setFiles([]);
    setTotalStaged(0);
  };

  // ── Computed Values ──────────────────────────
  const doneCount = files.filter(f => f.status === 'done').length;
  const failedCount = files.filter(f => f.status === 'error').length;
  const allDone = files.length > 0 && doneCount === files.length;
  const canProcess = (allDone && files.length >= 2) || totalStaged >= 2;
  const overallProgress = files.length > 0 ? Math.round((doneCount / files.length) * 100) : 0;

  // ── Processing Phase Render ──────────────────
  if (phase === 'processing') {
    const statusIcon = processStatus === 'completed' ? <CheckCircle size={40} className="icon-success" />
      : processStatus === 'failed' ? <XCircle size={40} className="icon-error" />
      : <Satellite size={40} className="icon-processing" />;

    const statusLabel = {
      queued: 'Queued — Waiting for worker...',
      processing: 'Processing drone images...',
      downloading: 'Downloading results from NodeODM...',
      tiling: 'Generating map tiles...',
      completed: 'Processing Complete!',
      failed: 'Processing Failed',
    }[processStatus] || 'Initializing...';

    return (
      <div className="drone-processing-panel">
        <div className="drone-processing__icon">{statusIcon}</div>
        <h3 className="drone-processing__title">{statusLabel}</h3>

        {processStatus !== 'completed' && processStatus !== 'failed' && (
          <>
            <div className="drone-progress-bar-container">
              <div className="drone-progress-bar">
                <div
                  className="drone-progress-bar__fill drone-progress-bar__fill--active"
                  style={{ width: `${processProgress}%` }}
                />
              </div>
              <span className="drone-progress-bar__pct">{processProgress}%</span>
            </div>
            {processMessage && (
              <p className="drone-processing__msg">{processMessage}</p>
            )}
          </>
        )}

        {processStatus === 'completed' && (
          <p className="drone-processing__msg drone-processing__msg--success">
            Orthophoto, DTM, and DSM tiles have been generated. The map layers are now available.
          </p>
        )}

        {processStatus === 'failed' && (
          <div>
            <p className="drone-processing__msg drone-processing__msg--error">
              {processError}
            </p>
            <button className="btn btn--secondary" onClick={resetToUpload} style={{ marginTop: '1rem' }}>
              Try Again
            </button>
          </div>
        )}

        <div style={{ marginTop: '2rem' }}>
          {processStatus === 'completed' && onComplete && (
            <button className="btn btn--primary" onClick={() => { toast.success('Processing complete — tiles ready'); onComplete(); }}>
              Continue
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Upload Phase Render ──────────────────────
  return (
    <div className="drone-upload-panel">
      {/* Previously uploaded images notice */}
      {totalStaged > 0 && files.length === 0 && (
        <div style={{
          background: 'var(--bg-info, #eff6ff)',
          border: '1px solid var(--border-info, #bfdbfe)',
          borderRadius: '8px',
          padding: '0.75rem 1rem',
          marginBottom: '1rem',
          fontSize: '13px',
          color: 'var(--text-secondary, #1e40af)',
          display: 'flex',
          alignItems: 'center',
          gap: '8px'
        }}>
          <span><FolderOpen size={16} style={{ verticalAlign: 'middle' }} /></span>
          <span><strong>{totalStaged} image{totalStaged !== 1 ? 's' : ''}</strong> already uploaded. You can add more below or start processing.</span>
        </div>
      )}

      {/* Drag-and-Drop Zone */}
      <div
        className={`drone-dropzone ${isDragging ? 'drone-dropzone--active' : ''}`}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="drone-dropzone__icon"><Camera size={40} strokeWidth={1.5} /></div>
        <p className="drone-dropzone__text">
          Drag & drop drone images here, or <span className="drone-dropzone__link">browse files</span>
        </p>
        <p className="drone-dropzone__hint">
          Accepts .jpg / .jpeg only &middot; Minimum 2 images required
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".jpg,.jpeg"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileInput}
        />
      </div>

      {/* File List */}
      {files.length > 0 && (
        <div className="drone-file-list">
          <div className="drone-file-list__header">
            <span>{files.length} image{files.length !== 1 ? 's' : ''} selected</span>
            <span className="drone-file-list__stats">
              {doneCount > 0 && <span className="drone-stat drone-stat--done">{doneCount} uploaded</span>}
              {failedCount > 0 && <span className="drone-stat drone-stat--error">{failedCount} failed</span>}
            </span>
          </div>

          {/* Overall upload progress */}
          {isUploading && (
            <div className="drone-progress-bar-container">
              <div className="drone-progress-bar">
                <div className="drone-progress-bar__fill" style={{ width: `${overallProgress}%` }} />
              </div>
              <span className="drone-progress-bar__pct">{overallProgress}%</span>
            </div>
          )}

          <div className="drone-file-list__items">
            {files.map(({ file, status, progress }) => (
              <div key={file.name} className={`drone-file-item drone-file-item--${status}`}>
                <div className="drone-file-item__info">
                  <span className="drone-file-item__icon">
                    {status === 'done' ? <CheckCircle size={14} color="var(--accent-green)" /> : status === 'error' ? <XCircle size={14} color="var(--accent-red)" /> : status === 'uploading' ? <ArrowUp size={14} color="var(--accent-blue)" /> : <Camera size={14} />}
                  </span>
                  <span className="drone-file-item__name">{file.name}</span>
                  <span className="drone-file-item__size">{formatBytes(file.size)}</span>
                </div>
                <div className="drone-file-item__actions">
                  {status === 'uploading' && (
                    <span className="drone-file-item__pct">{progress}%</span>
                  )}
                  {(status === 'pending' || status === 'error') && !isUploading && (
                    <button
                      className="drone-file-item__remove"
                      onClick={(e) => { e.stopPropagation(); removeFile(file.name); }}
                    >
                      &times;
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {uploadError && <div className="drone-error">{uploadError}</div>}

      {/* Action Buttons */}
      <div className="drone-upload-actions">
        {files.length > 0 && !allDone && (
          <button
            className="btn btn--secondary"
            onClick={uploadFiles}
            disabled={isUploading || files.filter(f => f.status === 'pending' || f.status === 'error').length === 0}
          >
            {isUploading
              ? `Uploading (${doneCount}/${files.length})...`
              : failedCount > 0
                ? `Retry Failed (${failedCount})`
                : `Upload ${files.filter(f => f.status === 'pending').length} Images`}
          </button>
        )}
        {canProcess && (
          <button className="btn btn--primary" onClick={startProcessing}>
            <Rocket size={16} /> Start Photogrammetry ({totalStaged || files.length} images)
          </button>
        )}
      </div>
    </div>
  );
}
