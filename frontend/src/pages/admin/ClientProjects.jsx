import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Plus, ArrowLeft, FolderOpen, ArrowRightLeft, X, Edit3, Save } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import Navbar from '../../components/Navbar';
import ProjectCard from '../../components/ProjectCard';
import ConfirmModal from '../../components/ConfirmModal';
import SearchInput from '../../components/ui/SearchInput';

export default function ClientProjects() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { user, isAdmin } = useAuth();

  const isUnassigned = clientId === 'unassigned';

  const [client, setClient] = useState(null);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [confirmModal, setConfirmModal] = useState({
    show: false, title: '', message: '', confirmLabel: 'OK',
    cancelLabel: '', type: 'info', onConfirm: () => {},
    onCancel: () => setConfirmModal(p => ({ ...p, show: false })),
  });

  // Reassign modal state
  const [reassignModal, setReassignModal] = useState({ show: false, projectId: null, projectName: '' });
  const [reassignClientId, setReassignClientId] = useState('');
  const [allClients, setAllClients] = useState([]);
  const [reassigning, setReassigning] = useState(false);
  const [editInfoModal, setEditInfoModal] = useState({
    show: false,
    projectId: null,
    name: '',
    location: '',
    description: '',
  });
  const [savingInfo, setSavingInfo] = useState(false);

  const fetchData = async () => {
    try {
      const projectsRes = await api.get('/projects');
      const allProjects = projectsRes.data.projects;

      if (isUnassigned) {
        setClient({ full_name: 'Unassigned', username: 'unassigned' });
        setProjects(allProjects.filter(p => !p.client_id));
        // Fetch clients for reassign
        const clientsRes = await api.get('/users/clients');
        setAllClients(clientsRes.data);
      } else {
        // Find client info from the clients endpoint
        const clientsRes = await api.get('/users/clients');
        const found = clientsRes.data.find(c => c.id === clientId);
        setClient(found || { full_name: 'Unknown Client', username: '?' });
        setProjects(allProjects.filter(p => p.client_id === clientId));
        // Fetch all clients for reassign
        setAllClients(clientsRes.data);
      }
    } catch (err) {
      console.error('Failed to fetch client projects', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 10000);
    return () => clearInterval(interval);
  }, [clientId]);

  const showConfirm = (title, message, onConfirm, type = 'warning') => {
    setConfirmModal({
      show: true, title, message, confirmLabel: 'Delete', cancelLabel: 'Cancel', type,
      onConfirm: () => { onConfirm(); setConfirmModal(p => ({ ...p, show: false })); },
      onCancel: () => setConfirmModal(p => ({ ...p, show: false })),
    });
  };

  const handleDeleteProject = (projectId) => {
    showConfirm('Delete Project',
      'Are you sure you want to delete this project? This will permanently remove all data and tiles.',
      async () => {
        try { await api.delete(`/projects/${projectId}`); fetchData(); }
        catch (err) { console.error('Failed to delete project', err); }
      }, 'danger');
  };

  const openReassign = (project) => {
    setReassignClientId(project.client_id || '');
    setReassignModal({ show: true, projectId: project.id, projectName: project.name });
  };

  const handleReassign = async () => {
    setReassigning(true);
    try {
      await api.put(`/projects/${reassignModal.projectId}`, {
        client_id: reassignClientId || null,
      });
      setReassignModal({ show: false, projectId: null, projectName: '' });
      fetchData();
    } catch (err) {
      console.error('Failed to reassign project', err);
    } finally {
      setReassigning(false);
    }
  };

  const openEditInfo = (project) => {
    setEditInfoModal({
      show: true,
      projectId: project.id,
      name: project.name || '',
      location: project.location || '',
      description: project.description || '',
    });
  };

  const handleSaveInfo = async () => {
    if (!editInfoModal.projectId) return;
    setSavingInfo(true);
    try {
      await api.put(`/projects/${editInfoModal.projectId}`, {
        name: editInfoModal.name,
        location: editInfoModal.location || null,
        description: editInfoModal.description || null,
      });
      setEditInfoModal({ show: false, projectId: null, name: '', location: '', description: '' });
      fetchData();
    } catch (err) {
      console.error('Failed to update project info', err);
    } finally {
      setSavingInfo(false);
    }
  };

  const userRole = user?.role?.toUpperCase();

  const filteredProjects = projects.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search.toLowerCase())
      || (p.location || '').toLowerCase().includes(search.toLowerCase());
    const matchStatus = !statusFilter || p.status === statusFilter;
    return matchSearch && matchStatus;
  });

  const statusOptions = [
    { value: '', label: 'All Status' },
    { value: 'READY', label: 'Ready' },
    { value: 'PROCESSING', label: 'Processing' },
    { value: 'REVIEW_PENDING', label: 'Review Pending' },
    { value: 'DRAFT', label: 'Draft' },
    { value: 'ERROR', label: 'Error' },
  ];

  const initials = client?.full_name
    ?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '??';

  return (
    <div className="page-bg">
      <div className="blob-container">
        <div className="blob blob-green" />
        <div className="blob blob-teal" />
      </div>

      <Navbar />

      <main className="relative z-10 max-w-screen-xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Breadcrumb + Header */}
        <div>
          <button
            onClick={() => navigate('/admin')}
            className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors mb-3"
          >
            <ArrowLeft size={14} /> Back to Dashboard
          </button>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className={`w-12 h-12 rounded-full flex items-center justify-center text-white text-base font-bold shadow-sm
                ${isUnassigned ? 'bg-amber-500' : 'bg-gradient-to-br from-primary-500 to-teal-500'}`}>
                {isUnassigned ? '?' : initials}
              </div>
              <div>
                <h1 className="font-heading font-extrabold text-slate-800 text-2xl sm:text-3xl tracking-tight">
                  {client?.full_name || 'Loading…'}
                </h1>
                {!isUnassigned && client?.username && (
                  <p className="text-slate-500 text-sm">@{client.username}</p>
                )}
              </div>
            </div>
            {!isUnassigned && (
              <button
                className="btn-primary gap-2 shrink-0"
                onClick={() => navigate(`/admin/projects/new?clientId=${clientId}`)}
              >
                <Plus size={16} /> New Project
              </button>
            )}
          </div>
        </div>

        {/* Search + Filter */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="flex-1 min-w-0">
            <SearchInput value={search} onChange={setSearch} placeholder="Search projects…" />
          </div>
          <select
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
            className="glass-input sm:w-44 shrink-0"
          >
            {statusOptions.map(o => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        </div>

        {/* Project count */}
        <p className="text-sm text-slate-500">
          {loading ? 'Loading…' : `${filteredProjects.length} project${filteredProjects.length !== 1 ? 's' : ''}`}
        </p>

        {/* Projects Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1,2,3].map(i => (
              <div key={i} className="glass-card p-5 space-y-3">
                <div className="skeleton h-5 w-20 rounded-full" />
                <div className="skeleton h-6 w-3/4 rounded-lg" />
                <div className="skeleton h-4 w-1/2 rounded-lg" />
                <div className="skeleton h-9 w-full rounded-xl mt-2" />
              </div>
            ))}
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="glass-card py-16 flex flex-col items-center justify-center text-center">
            <div className="w-16 h-16 rounded-2xl bg-primary-50 flex items-center justify-center mb-4">
              <FolderOpen size={28} className="text-primary-400" />
            </div>
            <h3 className="font-heading font-bold text-slate-700 text-lg mb-1">No Projects Found</h3>
            <p className="text-slate-400 text-sm max-w-sm">
              {search || statusFilter
                ? 'Try adjusting your search or filters.'
                : isUnassigned
                  ? 'No unassigned projects at the moment.'
                  : 'Create the first project for this client.'}
            </p>
            {!isUnassigned && !search && !statusFilter && (
              <button
                className="btn-primary mt-5 gap-2"
                onClick={() => navigate(`/admin/projects/new?clientId=${clientId}`)}
              >
                <Plus size={16} /> New Project
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {filteredProjects.map(project => (
              <ProjectCard
                key={project.id}
                project={project}
                userRole={userRole}
                onContinue={() => navigate(`/admin/projects/${project.id}/wizard`)}
                onOpen={() => navigate(`/admin/projects/${project.id}/view`)}
                onEdit={() => navigate(`/admin/projects/${project.id}/edit`)}
                onEditInfo={() => openEditInfo(project)}
                onDelete={() => handleDeleteProject(project.id)}
                onReassign={isAdmin ? () => openReassign(project) : undefined}
              />
            ))}
          </div>
        )}
      </main>

      <ConfirmModal {...confirmModal} />

      {/* Reassign Modal */}
      {reassignModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
             onClick={() => setReassignModal({ show: false, projectId: null, projectName: '' })}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-blue-50 text-blue-500 flex items-center justify-center">
                  <ArrowRightLeft size={17} />
                </div>
                <h3 className="font-heading font-bold text-slate-800 text-base">Reassign Project</h3>
              </div>
              <button onClick={() => setReassignModal({ show: false, projectId: null, projectName: '' })}
                      className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors">
                <X size={16} />
              </button>
            </div>

            <p className="text-sm text-slate-500">
              Move <span className="font-semibold text-slate-700">{reassignModal.projectName}</span> to a different client or unassign it.
            </p>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Assign to Client</label>
              <select className="glass-input cursor-pointer w-full" value={reassignClientId}
                      onChange={e => setReassignClientId(e.target.value)}>
                <option value="">— Unassigned (no client) —</option>
                {allClients.map(c => (
                  <option key={c.id} value={c.id}>{c.full_name || c.username}</option>
                ))}
              </select>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button onClick={() => setReassignModal({ show: false, projectId: null, projectName: '' })}
                      className="btn-secondary text-sm">Cancel</button>
              <button onClick={handleReassign} disabled={reassigning}
                      className="btn-primary text-sm gap-2">
                {reassigning ? 'Saving…' : 'Reassign'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Edit Project Info Modal */}
      {editInfoModal.show && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4"
             onClick={() => setEditInfoModal({ show: false, projectId: null, name: '', location: '', description: '' })}>
          <div className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 space-y-4"
               onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center">
                  <Edit3 size={17} />
                </div>
                <h3 className="font-heading font-bold text-slate-800 text-base">Edit Project Info</h3>
              </div>
              <button
                onClick={() => setEditInfoModal({ show: false, projectId: null, name: '', location: '', description: '' })}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition-colors"
              >
                <X size={16} />
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Project Name
                </label>
                <input
                  className="glass-input"
                  value={editInfoModal.name}
                  onChange={(e) => setEditInfoModal(prev => ({ ...prev, name: e.target.value }))}
                  placeholder="Project name"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                  Location
                </label>
                <input
                  className="glass-input"
                  value={editInfoModal.location}
                  onChange={(e) => setEditInfoModal(prev => ({ ...prev, location: e.target.value }))}
                  placeholder="Location"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                Description
              </label>
              <textarea
                className="glass-input min-h-[120px]"
                value={editInfoModal.description}
                onChange={(e) => setEditInfoModal(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Project description"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                onClick={() => setEditInfoModal({ show: false, projectId: null, name: '', location: '', description: '' })}
                className="btn-secondary text-sm"
              >
                Cancel
              </button>
              <button
                onClick={handleSaveInfo}
                disabled={savingInfo || !editInfoModal.name.trim()}
                className="btn-primary text-sm gap-2"
              >
                <Save size={14} /> {savingInfo ? 'Saving…' : 'Save Info'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
