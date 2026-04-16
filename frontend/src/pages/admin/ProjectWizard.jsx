import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import {
  ChevronRight, Check, UploadCloud, Tag, MapPin, ShieldAlert,
  Edit2, CheckCircle2, Loader2, X, FileImage, Download,
  Layers, Scan, BarChart2, Cpu, AlertTriangle, RefreshCcw,
} from 'lucide-react';
import api from '../../api/client';
import Navbar from '../../components/Navbar';
import ConfirmModal from '../../components/ConfirmModal';
import GlassCard from '../../components/ui/GlassCard';
import { useAuth } from '../../contexts/AuthContext';

// ── Pipeline stage definitions (keyed to backend status strings) ─────────────
const PIPELINE_STAGES = [
  {
    status: 'processing',
    label: '3D Reconstruction',
    sub: 'NodeODM photogrammetry — SfM / MVS point cloud',
    icon: Cpu,
  },
  {
    status: 'downloading',
    label: 'Downloading Outputs',
    sub: 'Orthophoto, DSM, DTM rasters from NodeODM',
    icon: Download,
  },
  {
    status: 'tiling',
    label: 'Map Tile Generation',
    sub: 'XYZ tile pyramids at zoom 2–22 via GDAL',
    icon: Layers,
  },
  {
    status: 'detecting',
    label: 'AI Tree Detection',
    sub: 'YOLOv9 crown localisation on tiled orthophoto',
    icon: Scan,
  },
  {
    status: 'computing_heights',
    label: 'Heights & Health Analysis',
    sub: 'CHM height extraction · VARI / GCC vegetation indices',
    icon: BarChart2,
  },
];

function getActiveStageIdx(status) {
  if (!status || status === 'queued') return -1;
  if (status === 'completed') return PIPELINE_STAGES.length;
  const i = PIPELINE_STAGES.findIndex(s => s.status === status);
  return i >= 0 ? i : 0;
}

function formatBytes(b) {
  if (!b) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return `${(b / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`;
}


export default function ProjectWizard() {
  const { projectId: id } = useParams();
  const navigate = useNavigate();
  const isEditing = !!id;
  const [searchParams] = useSearchParams();
  const urlClientId = searchParams.get('clientId');
  const { user } = useAuth();
  const isSubAdmin = user?.role === 'SUB_ADMIN';

  const [currentStep, setCurrentStep] = useState(1);
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(isEditing);
  const [clients, setClients] = useState([]);
  const [error, setError] = useState('');

  // Step 1
  const [formData, setFormData] = useState({
    name: '', location: '', client_id: urlClientId || '', description: '',
  });

  // Step 2
  const [selectedFiles, setSelectedFiles] = useState([]);
  const [isDragging, setIsDragging] = useState(false);
  const [uploadPhase, setUploadPhase] = useState('idle'); // idle | uploading | staged
  const [uploadProgress, setUploadProgress] = useState(0);
  const [stagedCount, setStagedCount] = useState(0);
  const fileInputRef = useRef(null);
  const dragCounter = useRef(0);

  // Step 3
  const [procStatus, setProcStatus] = useState(null);
  const [procProgress, setProcProgress] = useState(0);
  const [procMessage, setProcMessage] = useState('');
  const [procError, setProcError] = useState('');
  const pollRef = useRef(null);

  // Step 4
  const [treeCount, setTreeCount] = useState(null);

  const [confirmModal] = useState({
    show: false, title: '', message: '', confirmLabel: '', cancelLabel: '',
    onConfirm: () => {}, onCancel: () => {},
  });

  // ── Init ───────────────────────────────────────────────────────────────────
  useEffect(() => {
    const init = async () => {
      try {
        const clientsRes = await api.get('/users/clients');
        setClients(clientsRes.data);

        if (isEditing) {
          const res = await api.get(`/projects/${id}`);
          setProject(res.data);
          setFormData({
            name: res.data.name,
            location: res.data.location || '',
            client_id: res.data.client_id || '',
            description: res.data.description || '',
          });

          try {
            const droneRes = await api.get(`/projects/${id}/drone-status`);
            const ds = droneRes.data.status;
            if (ds === 'uploading') {
              setStagedCount(droneRes.data.image_count || 0);
              setUploadPhase('staged');
              setCurrentStep(2);
            } else if (['queued','processing','downloading','tiling','detecting','computing_heights'].includes(ds)) {
              setProcStatus(ds);
              setProcProgress(droneRes.data.progress || 0);
              setProcMessage(droneRes.data.message || '');
              setCurrentStep(3);
            } else if (ds === 'completed') {
              setProcStatus('completed');
              setProcProgress(100);
              setTreeCount(res.data.tree_count ?? null);
              setCurrentStep(isSubAdmin ? 3 : 4);
            } else if (ds === 'failed') {
              setProcStatus('failed');
              setProcError(droneRes.data.error || res.data.processing_error || 'Processing failed.');
              setCurrentStep(3);
            } else {
              setCurrentStep(2);
            }
          } catch {
            const st = res.data.status;
            if (st === 'REVIEW_PENDING' || st === 'REVIEW' || st === 'READY') {
              setProcStatus('completed');
              setTreeCount(res.data.tree_count ?? null);
              setCurrentStep(isSubAdmin ? 3 : 4);
            } else if (st === 'ERROR') {
              setProcStatus('failed');
              setProcError(res.data.processing_error || 'Processing failed.');
              setCurrentStep(3);
            } else if (st === 'PROCESSING') {
              setCurrentStep(3);
            } else {
              setCurrentStep(2);
            }
          }
        }
      } catch (err) {
        console.error('Wizard init failed', err);
        setError('Failed to load project details.');
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [id, isEditing]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Polling ────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (currentStep === 3 && !isSubAdmin && procStatus !== 'failed' && procStatus !== 'completed') {
      startPolling();
    }
    return () => { if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; } };
  }, [currentStep]); // eslint-disable-line react-hooks/exhaustive-deps

  const startPolling = () => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const res = await api.get(`/projects/${id}/drone-status`);
        const { status, progress, message, error: err } = res.data;
        setProcStatus(status);
        setProcProgress(progress ?? 0);
        setProcMessage(message || '');
        if (status === 'completed') {
          clearInterval(pollRef.current); pollRef.current = null;
          try { const pRes = await api.get(`/projects/${id}`); setTreeCount(pRes.data.tree_count ?? null); } catch {}
          setTimeout(() => setCurrentStep(4), 1000);
        } else if (status === 'failed') {
          clearInterval(pollRef.current); pollRef.current = null;
          setProcError(err || 'Processing failed. Check server logs.');
        }
      } catch { /* tolerate transient errors */ }
    }, 3000);
  };

  // ── Step 1 ─────────────────────────────────────────────────────────────────
  const handleSaveDetails = async (e) => {
    e.preventDefault(); setError('');
    try {
      if (isEditing) {
        await api.put(`/projects/${id}`, formData);
        setCurrentStep(2);
      } else {
        const res = await api.post('/projects', formData);
        navigate(`/admin/projects/${res.data.id}/wizard`, { replace: true });
      }
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to save project details.');
    }
  };

  // ── Step 2 file handling ───────────────────────────────────────────────────
  const addFiles = (raw) => {
    const jpgs = Array.from(raw).filter(f => /\.(jpe?g)$/i.test(f.name));
    if (jpgs.length < Array.from(raw).length) setError('Only JPEG images (.jpg / .jpeg) are accepted.');
    setSelectedFiles(prev => {
      const existing = new Set(prev.map(f => f.name));
      return [...prev, ...jpgs.filter(f => !existing.has(f.name))];
    });
  };

  const handleDragEnter = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current++; setIsDragging(true); };
  const handleDragLeave = (e) => { e.preventDefault(); e.stopPropagation(); dragCounter.current--; if (dragCounter.current === 0) setIsDragging(false); };
  const handleDragOver  = (e) => { e.preventDefault(); e.stopPropagation(); };
  const handleDrop      = (e) => {
    e.preventDefault(); e.stopPropagation();
    setIsDragging(false); dragCounter.current = 0;
    if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files);
  };

  const handleStageImages = async () => {
    if (!selectedFiles.length) return;
    setError(''); setUploadPhase('uploading'); setUploadProgress(0);
    const fd = new FormData();
    selectedFiles.forEach(f => fd.append('files', f));
    try {
      const res = await api.post(`/projects/${id}/drone-upload`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        onUploadProgress: (e) => setUploadProgress(Math.round((e.loaded * 100) / (e.total || 1))),
      });
      setStagedCount(res.data.total_staged);
      setUploadPhase('staged');
    } catch (err) {
      setUploadPhase('idle');
      setError(err.response?.data?.detail || 'Upload failed. Please try again.');
    }
  };

  const handleStartProcessing = async () => {
    setError('');
    try {
      await api.post(`/projects/${id}/drone-process`);
      setProcStatus('queued'); setProcProgress(0); setProcMessage(''); setProcError('');
      setCurrentStep(3);
    } catch (err) {
      setError(err.response?.data?.detail || 'Failed to start processing.');
    }
  };

  const handleRetry = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    setProcStatus(null); setProcProgress(0); setProcMessage(''); setProcError('');
    setUploadPhase('idle'); setSelectedFiles([]); setStagedCount(0);
    setCurrentStep(2);
  };

  // ── Wizard steps ──────────────────────────────────────────────────────────
  const STEPS = isSubAdmin
    ? [
        { num: 1, label: 'Details',  sub: 'Name & assignment' },
        { num: 2, label: 'Images',   sub: 'Upload drone photos' },
        { num: 3, label: 'Complete', sub: 'Submitted for review' },
      ]
    : [
        { num: 1, label: 'Details',    sub: 'Name & assignment' },
        { num: 2, label: 'Images',     sub: 'Upload drone photos' },
        { num: 3, label: 'Processing', sub: 'Pipeline & AI' },
        { num: 4, label: 'Complete',   sub: 'Review inventory' },
      ];

  const totalBytes = selectedFiles.reduce((s, f) => s + f.size, 0);
  const activeStageIdx = getActiveStageIdx(procStatus);

  if (loading) return (
    <div className="page-bg flex items-center justify-center min-h-screen">
      <div className="spinner" />
    </div>
  );

  return (
    <div className="page-bg min-h-screen flex flex-col">
      <div className="blob-container">
        <div className="blob blob-green" />
        <div className="blob blob-teal" />
      </div>

      <Navbar />

      <main className="relative z-10 max-w-screen-lg mx-auto px-4 sm:px-6 mt-6 mb-12 flex flex-col flex-1 w-full">

        {/* Page header */}
        <div className="mb-6 text-center">
          <h1 className="font-heading font-extrabold text-slate-800 text-2xl sm:text-3xl mb-1">
            {isEditing ? (project?.name || 'Project Pipeline') : 'New Project'}
          </h1>
          <p className="text-slate-500 text-sm">
            {isEditing
              ? 'Drone processing · AI tree detection · Vegetation health analysis'
              : 'Configure a new photogrammetry & tree analytics project'}
          </p>
        </div>

        {/* Step indicator */}
        <div className="relative flex justify-between max-w-2xl mx-auto mb-8 w-full">
          <div className="absolute top-[17px] left-[18px] right-[18px] h-[2px] bg-slate-200 z-0" />
          <div
            className="absolute top-[17px] left-[18px] h-[2px] bg-primary-500 transition-all duration-500 z-0"
            style={{
              width: `calc(${((currentStep - 1) / (STEPS.length - 1)) * 100}% - ${
                ((currentStep - 1) / (STEPS.length - 1)) * 36
              }px)`,
            }}
          />
          {STEPS.map((step) => {
            const done   = currentStep > step.num;
            const active = currentStep === step.num;
            return (
              <div key={step.num} className="flex flex-col items-center z-10">
                <div className={[
                  'wizard-step-circle mb-1.5',
                  done   ? 'bg-primary-500 border-primary-500 text-white shadow-green-glow-sm' :
                  active ? 'bg-white border-primary-500 text-primary-600 shadow-[0_0_0_4px_rgba(22,163,74,0.1)]' :
                           'bg-white border-slate-200 text-slate-400',
                ].join(' ')}>
                  {done ? <Check size={18} strokeWidth={3} /> : step.num}
                </div>
                <p className={`text-xs font-semibold ${active ? 'text-slate-800' : 'text-slate-400'}`}>{step.label}</p>
                <p className="text-[10px] text-slate-400 hidden sm:block">{step.sub}</p>
              </div>
            );
          })}
        </div>

        {/* Global error banner */}
        {error && (
          <div className="animate-fade-in mb-5 p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-3 max-w-2xl mx-auto w-full">
            <ShieldAlert className="text-red-500 shrink-0 mt-0.5" size={16} />
            <p className="text-red-700 text-xs flex-1">{error}</p>
            <button onClick={() => setError('')} className="text-red-400 hover:text-red-600 shrink-0">
              <X size={14} />
            </button>
          </div>
        )}

        {/* ── STEP 1 ──────────────────────────────────────────────────────────── */}
        {currentStep === 1 && (
          <GlassCard className="p-6 max-w-2xl mx-auto w-full text-sm animate-fade-in">
            <div className="flex items-center gap-3 mb-5 pb-4 border-b border-slate-100">
              <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center shrink-0">
                <Tag size={17} />
              </div>
              <div>
                <h2 className="font-heading font-bold text-slate-800 text-base">Project Details</h2>
                <p className="text-xs text-slate-400">Name, location, and client assignment</p>
              </div>
            </div>

            <form onSubmit={handleSaveDetails} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                    Project Name <span className="text-red-400">*</span>
                  </label>
                  <input type="text" className="glass-input" value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    placeholder="e.g. Pine Block A" required />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Location</label>
                  <div className="relative">
                    <MapPin size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input type="text" className="glass-input pl-9" value={formData.location}
                      onChange={e => setFormData({ ...formData, location: e.target.value })}
                      placeholder="Area, GPS coords, or region" />
                  </div>
                </div>
              </div>

              {!urlClientId && (
                <div>
                  <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Assign Client</label>
                  <select className="glass-input cursor-pointer" value={formData.client_id}
                    onChange={e => setFormData({ ...formData, client_id: e.target.value })}>
                    <option value="">— No client assigned yet —</option>
                    {clients.map(c => (
                      <option key={c.id} value={c.id}>{c.full_name || c.username}</option>
                    ))}
                  </select>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Description</label>
                <textarea className="glass-input min-h-[64px] resize-none"
                  value={formData.description}
                  onChange={e => setFormData({ ...formData, description: e.target.value })}
                  placeholder="Optional notes (plantation type, flight date, survey area…)" />
              </div>

              <div className="pt-3 border-t border-slate-100 flex justify-end">
                <button type="submit" className="btn-primary gap-2">
                  {isEditing ? 'Save & Continue' : 'Create Project'} <ChevronRight size={16} />
                </button>
              </div>
            </form>
          </GlassCard>
        )}

        {/* ── STEP 2 ──────────────────────────────────────────────────────────── */}
        {currentStep === 2 && (
          <GlassCard className="p-6 max-w-2xl mx-auto w-full animate-fade-in">
            <div className="flex items-center gap-3 mb-5 pb-4 border-b border-slate-100">
              <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-500 flex items-center justify-center shrink-0">
                <FileImage size={17} />
              </div>
              <div>
                <h2 className="font-heading font-bold text-slate-800 text-base">Upload Drone Images</h2>
                <p className="text-xs text-slate-400">JPEG photos only · ≥70% overlap recommended · Minimum 2 images required</p>
              </div>
            </div>

            <div className="space-y-4">
              {stagedCount > 0 && uploadPhase === 'staged' && (
                <div className="flex items-center gap-3 px-4 py-3 bg-primary-50/70 border border-primary-200 rounded-xl text-xs text-primary-700">
                  <CheckCircle2 size={15} className="text-primary-500 shrink-0" />
                  <span><strong>{stagedCount}</strong> {stagedCount === 1 ? 'image' : 'images'} staged on the server and ready to process.</span>
                </div>
              )}

              {uploadPhase !== 'staged' && (
                <div
                  className={`upload-dropzone ${isDragging ? 'drag-over' : ''}`}
                  onDragEnter={handleDragEnter} onDragLeave={handleDragLeave}
                  onDragOver={handleDragOver} onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input ref={fileInputRef} type="file" accept=".jpg,.jpeg" multiple className="hidden"
                    onChange={e => { if (e.target.files) addFiles(e.target.files); e.target.value = ''; }} />
                  <div className="w-12 h-12 rounded-full bg-slate-50 flex items-center justify-center mx-auto mb-3 text-slate-400">
                    <UploadCloud size={24} />
                  </div>
                  <p className="font-heading font-bold text-slate-700 text-sm mb-1">
                    {isDragging ? 'Drop images here' : 'Drag & drop images, or click to browse'}
                  </p>
                  <p className="text-[11px] text-slate-400">JPG / JPEG only · Nadir (downward-facing) shots with ≥70% overlap</p>
                </div>
              )}

              {selectedFiles.length > 0 && uploadPhase !== 'staged' && (
                <div className="bg-slate-50 rounded-xl border border-slate-100 overflow-hidden">
                  <div className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100">
                    <span className="text-xs font-semibold text-slate-600">
                      {selectedFiles.length} {selectedFiles.length === 1 ? 'image' : 'images'} selected &nbsp;·&nbsp; {formatBytes(totalBytes)}
                    </span>
                    <button onClick={() => { setSelectedFiles([]); setError(''); }}
                      className="text-[11px] text-slate-400 hover:text-red-500 transition-colors">Clear all</button>
                  </div>
                  <div className="max-h-44 overflow-y-auto divide-y divide-slate-100">
                    {selectedFiles.slice(0, 60).map(f => (
                      <div key={f.name} className="flex items-center gap-3 px-4 py-2 text-xs">
                        <FileImage size={13} className="text-slate-400 shrink-0" />
                        <span className="flex-1 truncate text-slate-600">{f.name}</span>
                        <span className="text-slate-400 shrink-0">{formatBytes(f.size)}</span>
                        <button onClick={() => setSelectedFiles(p => p.filter(x => x.name !== f.name))}
                          className="text-slate-300 hover:text-red-400 transition-colors"><X size={12} /></button>
                      </div>
                    ))}
                    {selectedFiles.length > 60 && (
                      <p className="text-center text-xs text-slate-400 py-2">+{selectedFiles.length - 60} more files</p>
                    )}
                  </div>
                </div>
              )}

              {uploadPhase === 'uploading' && (
                <div className="space-y-1.5">
                  <div className="flex justify-between text-xs font-semibold text-slate-600">
                    <span className="flex items-center gap-1.5"><Loader2 size={12} className="animate-spin" /> Uploading to server…</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-primary-500 transition-all duration-200 rounded-full" style={{ width: `${uploadProgress}%` }} />
                  </div>
                </div>
              )}

              <div className="pt-3 border-t border-slate-100 flex items-center justify-between gap-3">
                <button onClick={() => setCurrentStep(1)} className="btn-secondary text-xs"
                  disabled={uploadPhase === 'uploading'}>Back</button>
                <div className="flex gap-2">
                  {uploadPhase !== 'staged' && (
                    <button onClick={handleStageImages}
                      disabled={selectedFiles.length < 2 || uploadPhase === 'uploading'}
                      className="btn-primary gap-2 text-xs">
                      {uploadPhase === 'uploading'
                        ? <><Loader2 size={13} className="animate-spin" /> Uploading…</>
                        : <><UploadCloud size={13} /> Stage {selectedFiles.length > 0 ? selectedFiles.length : ''} Images</>}
                    </button>
                  )}
                  {(uploadPhase === 'staged' || stagedCount >= 2) && !isSubAdmin && (
                    <button onClick={handleStartProcessing} className="btn-primary gap-2 text-xs">
                      <Cpu size={13} /> Start Processing
                    </button>
                  )}
                  {(uploadPhase === 'staged' || stagedCount >= 2) && isSubAdmin && (
                    <button onClick={() => setCurrentStep(3)} className="btn-primary gap-2 text-xs">
                      <Check size={13} /> Finish
                    </button>
                  )}
                </div>
              </div>
            </div>
          </GlassCard>
        )}

        {/* ── STEP 3 (SUB_ADMIN — Submitted or Ready for Review) ──────── */}
        {currentStep === 3 && isSubAdmin && procStatus === 'completed' && (
          <GlassCard className="p-10 max-w-2xl mx-auto w-full text-center animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-primary-50 text-primary-500 flex items-center justify-center mx-auto mb-4 shadow-green-glow-sm">
              <Check size={32} strokeWidth={3} />
            </div>
            <h2 className="font-heading font-extrabold text-slate-800 text-2xl mb-2">Pipeline Complete</h2>
            <p className="text-sm text-slate-500 max-w-md mx-auto mb-3 leading-relaxed">
              Processing is complete. Review the AI-detected tree inventory and
              publish the project when it's ready for the client.
            </p>
            {treeCount !== null && (
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-50 rounded-full text-sm font-semibold text-primary-700 mb-7">
                <CheckCircle2 size={15} />
                {treeCount} {treeCount === 1 ? 'tree' : 'trees'} detected
              </div>
            )}
            {treeCount === null && <div className="mb-7" />}
            <div className="flex flex-col sm:flex-row gap-3 max-w-sm mx-auto justify-center">
              <button onClick={() => navigate(`/admin/projects/${id}/edit`)}
                className="btn-primary flex items-center justify-center gap-2">
                <Edit2 size={15} /> Review Tree Inventory
              </button>
              <button onClick={() => navigate(formData.client_id ? `/admin/clients/${formData.client_id}/projects` : '/admin')}
                className="btn-secondary flex items-center justify-center gap-2">
                Back to Projects
              </button>
            </div>
          </GlassCard>
        )}

        {currentStep === 3 && isSubAdmin && procStatus !== 'completed' && (
          <GlassCard className="p-10 max-w-2xl mx-auto w-full text-center animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-primary-50 text-primary-500 flex items-center justify-center mx-auto mb-4 shadow-green-glow-sm">
              <Check size={32} strokeWidth={3} />
            </div>
            <h2 className="font-heading font-extrabold text-slate-800 text-2xl mb-2">Images Submitted</h2>
            <p className="text-sm text-slate-500 max-w-md mx-auto mb-7 leading-relaxed">
              Your drone images have been uploaded successfully. An administrator will
              process the pipeline and run AI tree detection.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 max-w-sm mx-auto justify-center">
              <button onClick={() => navigate(formData.client_id ? `/admin/clients/${formData.client_id}/projects` : '/admin')}
                className="btn-primary flex items-center justify-center gap-2">
                Back to Projects
              </button>
              <button onClick={() => navigate('/admin')}
                className="btn-secondary flex items-center justify-center gap-2">
                Dashboard
              </button>
            </div>
          </GlassCard>
        )}

        {/* ── STEP 3 (ADMIN — Processing) ──────────────────────────────────── */}
        {currentStep === 3 && !isSubAdmin && (
          <div className="max-w-2xl mx-auto w-full animate-fade-in space-y-4">
            {procStatus === 'failed' ? (
              <GlassCard className="p-8 flex flex-col items-center text-center">
                <div className="w-16 h-16 rounded-2xl bg-red-50 flex items-center justify-center mb-4">
                  <AlertTriangle size={28} className="text-red-500" />
                </div>
                <h2 className="font-heading font-bold text-slate-800 text-xl mb-2">Processing Failed</h2>
                <p className="text-sm text-slate-500 max-w-sm mb-4 leading-relaxed">
                  An error occurred during the pipeline. Review the error below, then retry.
                </p>
                {procError && (
                  <div className="w-full bg-red-50 border border-red-200 rounded-xl p-4 text-left mb-6 max-h-44 overflow-y-auto">
                    <p className="text-xs text-red-700 font-mono leading-relaxed break-words whitespace-pre-wrap">{procError}</p>
                  </div>
                )}
                <div className="flex gap-3">
                  <button onClick={handleRetry} className="btn-primary gap-2">
                    <RefreshCcw size={14} /> Retry Upload
                  </button>
                  <button onClick={() => navigate('/admin')} className="btn-secondary text-xs">Back to Dashboard</button>
                </div>
              </GlassCard>
            ) : (
              <GlassCard className="p-6">
                <div className="flex items-start gap-3 mb-5 pb-4 border-b border-slate-100">
                  <div className="w-9 h-9 rounded-xl bg-amber-50 flex items-center justify-center shrink-0">
                    {procStatus === 'completed'
                      ? <CheckCircle2 size={18} className="text-primary-500" />
                      : <Cpu size={17} className="text-amber-500 animate-pulse" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-heading font-bold text-slate-800 text-base">
                      {procStatus === 'completed' ? 'Pipeline Complete' : 'Processing Pipeline'}
                    </h2>
                    <p className="text-xs text-slate-400 truncate">
                      {procStatus === 'queued'
                        ? 'Waiting for worker to pick up the task…'
                        : procStatus === 'completed'
                        ? 'All stages finished — tree inventory is ready.'
                        : procMessage || 'Running…'}
                    </p>
                  </div>
                  {procStatus !== 'completed' && (
                    <span className="text-sm font-bold text-primary-600 shrink-0">{procProgress}%</span>
                  )}
                </div>

                {procStatus !== 'completed' && (
                  <div className="mb-6">
                    <div className="h-2 w-full bg-slate-100 rounded-full overflow-hidden">
                      <div className="h-full bg-gradient-to-r from-primary-400 to-primary-600 transition-all duration-700 rounded-full"
                        style={{ width: `${procProgress}%` }} />
                    </div>
                  </div>
                )}

                <div>
                  {PIPELINE_STAGES.map((stage, idx) => {
                    const done    = idx < activeStageIdx || procStatus === 'completed';
                    const active  = idx === activeStageIdx && procStatus !== 'completed';
                    const Icon = stage.icon;
                    return (
                      <div key={stage.status} className="flex gap-3 relative">
                        {idx < PIPELINE_STAGES.length - 1 && (
                          <div className={`absolute left-[17px] top-[36px] w-[2px] h-[calc(100%-12px)] transition-colors duration-500 ${done ? 'bg-primary-400' : 'bg-slate-200'}`} />
                        )}
                        <div className={[
                          'w-9 h-9 rounded-full flex items-center justify-center shrink-0 z-10 border-2 transition-all duration-500',
                          done  ? 'bg-primary-500 border-primary-500 text-white shadow-green-glow-sm' :
                          active ? 'bg-white border-primary-400 text-primary-500 shadow-[0_0_0_4px_rgba(22,163,74,0.12)]' :
                                   'bg-white border-slate-200 text-slate-300',
                        ].join(' ')}>
                          {done ? <Check size={15} strokeWidth={3} /> : active ? <Loader2 size={14} className="animate-spin" /> : <Icon size={14} />}
                        </div>
                        <div className="pb-5 flex-1 min-w-0">
                          <p className={`text-sm font-semibold leading-tight ${done ? 'text-primary-600' : active ? 'text-slate-800' : 'text-slate-400'}`}>
                            {stage.label}
                          </p>
                          <p className={`text-[11px] mt-0.5 leading-relaxed ${active ? 'text-slate-500' : 'text-slate-400'}`}>
                            {active && procMessage ? procMessage : stage.sub}
                          </p>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <div className="mt-1 pt-4 border-t border-slate-100 flex items-center justify-between gap-3">
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {procStatus === 'completed'
                      ? 'The tree inventory is ready for review and annotation.'
                      : 'You can safely close this page — processing continues in the background.'}
                  </p>
                  <button onClick={() => navigate('/admin')} className="btn-secondary text-xs shrink-0">Dashboard</button>
                </div>
              </GlassCard>
            )}
          </div>
        )}

        {/* ── STEP 4 ──────────────────────────────────────────────────────────── */}
        {currentStep === 4 && (
          <GlassCard className="p-10 max-w-2xl mx-auto w-full text-center animate-fade-in">
            <div className="w-16 h-16 rounded-full bg-primary-50 text-primary-500 flex items-center justify-center mx-auto mb-4 shadow-green-glow-sm">
              <Check size={32} strokeWidth={3} />
            </div>
            <h2 className="font-heading font-extrabold text-slate-800 text-2xl mb-2">Pipeline Complete</h2>
            <p className="text-sm text-slate-500 max-w-md mx-auto mb-3 leading-relaxed">
              Orthophoto, DSM, DTM, and map tiles are ready. AI tree detection and vegetation
              health classification are complete.
            </p>
            {treeCount !== null && (
              <div className="inline-flex items-center gap-2 px-4 py-2 bg-primary-50 rounded-full text-sm font-semibold text-primary-700 mb-7">
                <CheckCircle2 size={15} />
                {treeCount} {treeCount === 1 ? 'tree' : 'trees'} detected
              </div>
            )}
            {treeCount === null && <div className="mb-7" />}
            <div className="flex flex-col sm:flex-row gap-3 max-w-sm mx-auto justify-center">
              <button onClick={() => navigate(`/admin/projects/${id}/edit`)}
                className="btn-primary flex items-center justify-center gap-2">
                <Edit2 size={15} /> Review Tree Inventory
              </button>
              <button onClick={() => navigate('/admin')}
                className="btn-secondary flex items-center justify-center gap-2">
                Back to Dashboard
              </button>
            </div>
          </GlassCard>
        )}
      </main>

      <ConfirmModal {...confirmModal} />
    </div>
  );
}
