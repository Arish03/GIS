import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, HelpCircle, Check } from 'lucide-react';
import api from '../../api/client';
import Navbar from '../../components/Navbar';
import TreeAnnotationPanel from '../../components/TreeAnnotationPanel'; // Preserved internal logic
import GlassCard from '../../components/ui/GlassCard';
import { useAuth } from '../../contexts/AuthContext';

export default function ProjectEdit() {
  const { projectId: id } = useParams();
  const navigate = useNavigate();
  const { isAdmin, isStaff } = useAuth();
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchProject = async () => {
      try {
        const res = await api.get(`/projects/${id}`);
        setProject(res.data);
      } catch (err) {
        setError('Failed to load project for editing.');
        console.error(err);
      } finally {
        setLoading(false);
      }
    };
    fetchProject();
  }, [id]);

  const handleMarkReady = async () => {
    try {
      await api.put(`/projects/${id}`, { status: 'READY' });
      navigate('/admin');
    } catch (err) {
      console.error('Failed to update status', err);
      alert('Failed to publish project.');
    }
  };

  if (loading) {
    return (
      <div className="page-bg flex items-center justify-center">
        <div className="spinner" />
      </div>
    );
  }

  if (error || !project) {
    return (
      <div className="page-bg pt-20 px-6 text-center">
        <div className="text-red-500 font-bold mb-2">Error</div>
        <div className="text-slate-600">{error}</div>
        <button onClick={() => navigate('/admin')} className="mt-4 btn-secondary">Back to Admin</button>
      </div>
    );
  }

  return (
    <div className="page-bg min-h-screen flex flex-col">
       {/* Background blobs */}
      <div className="blob-container">
        <div className="blob blob-green fixed top-0 right-0 -m-32" />
        <div className="blob blob-blue fixed bottom-0 left-0 -m-32" />
      </div>

      <Navbar />

      <main className="flex-1 w-full max-w-screen-2xl mx-auto p-4 sm:p-6 flex flex-col relative z-10 transition-all">
        {/* Header section */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div className="flex items-center gap-4">
             <button onClick={() => navigate(-1)} className="p-2 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors bg-white/50 backdrop-blur-sm border border-slate-200">
               <ArrowLeft size={18} />
             </button>
             <div>
               <h1 className="font-heading font-extrabold text-slate-800 text-xl tracking-tight">Tree Review: {project.name}</h1>
               <p className="text-slate-500 text-xs mt-0.5">Adjust AI-detected bounding boxes before publishing.</p>
             </div>
          </div>
          <div className="flex items-center gap-3">
             <button className="btn-ghost text-slate-500 gap-1.5" title="Hold Shift + drag to draw new boxes. Select box and press Backspace to delete.">
                <HelpCircle size={15} /> <span className="text-xs">Shortcuts</span>
             </button>
             {isStaff && project.status !== 'READY' && (
               <button onClick={handleMarkReady} className="btn-primary gap-2 text-sm px-4 py-2">
                 <Save size={15} /> Publish as Ready
               </button>
             )}
             {isStaff && project.status === 'READY' && (
               <button onClick={() => navigate(-1)} className="btn-primary gap-2 text-sm px-4 py-2">
                 <Check size={15} /> Done Editing
               </button>
             )}
          </div>
        </div>

        {/* Editor Area */}
        <GlassCard className="flex-1 flex flex-col w-full overflow-hidden p-1 shadow-glass-lg border-white/90">
           <div className="relative flex-1 w-full h-[calc(100vh-170px)] bg-slate-900 rounded-xl overflow-hidden">
             <TreeAnnotationPanel projectId={project.id} />
           </div>
        </GlassCard>
      </main>
    </div>
  );
}
