import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, ShieldAlert, ArrowRightLeft, Loader2 } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import Navbar from '../../components/Navbar';
import ConfirmModal from '../../components/ConfirmModal';
import SearchInput from '../../components/ui/SearchInput';
import GlassCard from '../../components/ui/GlassCard';
import Badge from '../../components/ui/Badge';

export default function AdminClients() {
  const { isAdmin } = useAuth();
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  
  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({ username: '', full_name: '', password: '', role: 'CLIENT' });
  const [error, setError] = useState('');
  const [clientProjects, setClientProjects] = useState([]);
  const [allClients, setAllClients] = useState([]);
  const [subAdmins, setSubAdmins] = useState([]);
  const [selectedSubAdminIds, setSelectedSubAdminIds] = useState([]);
  const [reassignTargets, setReassignTargets] = useState({});
  const [reassigningProjectId, setReassigningProjectId] = useState(null);

  const [confirmModal, setConfirmModal] = useState({
    show: false, title: '', message: '', type: 'info', onConfirm: () => {}, onCancel: () => setConfirmModal(p => ({ ...p, show: false }))
  });

  const fetchUsers = async () => {
    try {
      const res = await api.get('/users/clients');
      setUsers(res.data);
    } catch (err) {
      console.error('Failed to fetch users', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const openCreateModal = () => {
    setEditingUser(null);
    setFormData({ username: '', full_name: '', password: '', role: 'CLIENT' });
    setClientProjects([]);
    setAllClients([]);
    setSubAdmins([]);
    setSelectedSubAdminIds([]);
    setReassignTargets({});
    setError('');
    setShowModal(true);
  };

  const loadClientEditData = async (clientId) => {
    const requests = [
      api.get('/projects'),
      api.get('/users/clients'),
    ];
    // Only admins can load sub-admin assignment data
    if (isAdmin) {
      requests.push(api.get('/users/sub-admins'));
      requests.push(api.get(`/users/clients/${clientId}/sub-admins`));
    }

    const results = await Promise.all(requests);
    const projectsRes = results[0];
    const clientsRes = results[1];

    const projects = projectsRes.data.projects.filter(p => p.client_id === clientId);
    setClientProjects(projects);
    setAllClients(clientsRes.data);

    if (isAdmin) {
      setSubAdmins(results[2].data);
      setSelectedSubAdminIds(results[3].data.map(u => u.id));
    } else {
      setSubAdmins([]);
      setSelectedSubAdminIds([]);
    }
    setReassignTargets({});
  };

  const openEditModal = async (user) => {
    setEditingUser(user);
    setFormData({ username: user.username, full_name: user.full_name || '', password: '', role: user.role });
    setError('');
    setShowModal(true);

    if (user.role?.toUpperCase() === 'CLIENT') {
      try {
        await loadClientEditData(user.id);
      } catch (err) {
        console.error('Failed to load client edit data', err);
        setError('Failed to load client projects and sub-admin assignments.');
      }
    } else {
      setClientProjects([]);
      setAllClients([]);
      setSubAdmins([]);
      setSelectedSubAdminIds([]);
      setReassignTargets({});
    }
  };

  const handleReassignProject = async (projectId) => {
    if (!editingUser) return;
    if (!(projectId in reassignTargets)) return;
    if (reassignTargets[projectId] === '__NO_CHANGE__') return;
    const targetClientId = reassignTargets[projectId] || null;
    setReassigningProjectId(projectId);
    try {
      await api.put(`/projects/${projectId}`, { client_id: targetClientId });
      await loadClientEditData(editingUser.id);
    } catch (err) {
      console.error('Failed to reassign project', err);
      setError(err.response?.data?.detail || 'Failed to reassign project.');
    } finally {
      setReassigningProjectId(null);
    }
  };

  const toggleSubAdminSelection = (subAdminId) => {
    setSelectedSubAdminIds(prev => (
      prev.includes(subAdminId)
        ? prev.filter(id => id !== subAdminId)
        : [...prev, subAdminId]
    ));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    
    try {
      if (editingUser) {
        const updateData = { ...formData };
        if (!updateData.password) delete updateData.password;
        delete updateData.role;
        await api.put(`/users/${editingUser.id}`, updateData);

        if (editingUser.role?.toUpperCase() === 'CLIENT' && isAdmin) {
          await api.put(`/users/clients/${editingUser.id}/sub-admins`, {
            sub_admin_ids: selectedSubAdminIds,
          });
        }
      } else {
        await api.post('/users', { ...formData, role: 'CLIENT' });
      }
      setShowModal(false);
      fetchUsers();
    } catch (err) {
      let errorMsg = 'An error occurred';
      if (err.response?.data?.detail) {
        if (typeof err.response.data.detail === 'string') {
          errorMsg = err.response.data.detail;
        } else if (Array.isArray(err.response.data.detail)) {
          errorMsg = err.response.data.detail.map(e => `${e.loc?.join('.')} ${e.msg}`).join(', ');
        }
      }
      setError(errorMsg);
    }
  };

  const handleDelete = (userId) => {
    setConfirmModal({
      show: true,
      title: 'Delete Client',
      message: 'Are you sure you want to delete this user? Action cannot be undone.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      type: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/users/${userId}`);
          fetchUsers();
        } catch (err) {
          console.error('Delete failed', err);
        }
        setConfirmModal(p => ({ ...p, show: false }));
      },
      onCancel: () => setConfirmModal(p => ({ ...p, show: false }))
    });
  };

  const filteredUsers = users.filter(u => 
    !search || 
    u.full_name?.toLowerCase().includes(search.toLowerCase()) || 
    u.username.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page-bg">
       {/* Background blobs */}
      <div className="blob-container">
        <div className="blob blob-green" />
        <div className="blob blob-blue" />
      </div>

      <Navbar />

      <main className="relative z-10 max-w-screen-xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-heading font-extrabold text-slate-800 text-2xl sm:text-3xl tracking-tight">
              Client Management
            </h1>
            <p className="text-slate-500 text-sm mt-1">Manage platform access, roles, and client accounts.</p>
          </div>
          {isAdmin && (
            <button className="btn-primary" onClick={openCreateModal}>
              <Plus size={16} /> New Client
            </button>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex items-center">
           <div className="w-full sm:max-w-md">
             <SearchInput value={search} onChange={setSearch} placeholder="Search clients by name or username..." />
           </div>
        </div>

        {/* Client List */}
        <GlassCard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="glass-table w-full">
              <thead>
                <tr>
                  <th className="pl-6 w-16">User</th>
                  <th>Name</th>
                  <th>Role</th>
                  <th>Projects</th>
                  <th className="text-right pr-6 w-24">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {loading ? (
                  Array(3).fill(0).map((_, i) => (
                    <tr key={i}>
                      <td className="px-6 py-4"><div className="skeleton w-10 h-10 rounded-full" /></td>
                      <td className="px-4 py-4"><div className="skeleton h-4 w-32 mb-2 rounded" /><div className="skeleton h-3 w-24 rounded" /></td>
                      <td className="px-4 py-4"><div className="skeleton h-5 w-16 rounded-full" /></td>
                      <td className="px-4 py-4"><div className="skeleton h-5 w-16 rounded-full" /></td>
                      <td className="px-6 py-4 text-right"><div className="skeleton h-8 w-16 rounded ml-auto" /></td>
                    </tr>
                  ))
                ) : filteredUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-500 font-medium">
                      No clients found matching your search.
                    </td>
                  </tr>
                ) : (
                  filteredUsers.map(user => {
                    const initials = (user.full_name || user.username || '').substring(0, 2).toUpperCase();
                    const isAdminRole = user.role?.toUpperCase() === 'ADMIN';
                    const isSubAdminRole = user.role?.toUpperCase() === 'SUB_ADMIN';
                    return (
                      <tr key={user.id} className="group">
                        <td className="pl-6 py-3">
                        <div className={`w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-sm shadow-sm ${isAdminRole ? 'bg-gradient-to-br from-purple-500 to-indigo-500' : isSubAdminRole ? 'bg-gradient-to-br from-blue-500 to-cyan-500' : 'bg-gradient-to-br from-primary-500 to-teal-500'}`}>
                              {initials}
                           </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-800">{user.full_name || user.username}</div>
                          <div className="text-xs text-slate-500 mt-0.5">@{user.username}</div>
                        </td>
                        <td className="px-4 py-3">
                          {isAdminRole ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-purple-700 bg-purple-50 px-2.5 py-1 rounded-full ring-1 ring-purple-200">
                              <ShieldAlert size={12} /> Admin
                            </span>
                          ) : isSubAdminRole ? (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-blue-700 bg-blue-50 px-2.5 py-1 rounded-full ring-1 ring-blue-200">
                              <ShieldAlert size={12} /> Sub-Admin
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-xs font-semibold text-slate-600 bg-slate-100 px-2.5 py-1 rounded-full ring-1 ring-slate-200">
                              Client
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className="text-sm font-medium text-slate-700">{user.project_count ?? 0}</span>
                        </td>
                        <td className="pr-6 py-3 text-right">
                          {isAdmin && (
                            <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                              <button onClick={() => openEditModal(user)} className="p-1.5 rounded text-blue-600 hover:bg-blue-50 transition" title="Edit User">
                                <Edit2 size={16} />
                              </button>
                              <button onClick={() => handleDelete(user.id)} className="p-1.5 rounded text-red-500 hover:bg-red-50 transition" title="Delete User">
                                <Trash2 size={16} />
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </GlassCard>
      </main>

      <ConfirmModal {...confirmModal} />

      {/* Client Edit/Create Modal (In-page implementation of Glass Modal) */}
      {showModal && (
         <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
            <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative z-10 w-full max-w-5xl max-h-[90vh] overflow-y-auto bg-white/90 backdrop-blur-2xl border border-white/90 rounded-2xl shadow-glass-lg animate-slide-up p-6">
               <h2 className="font-heading font-bold text-slate-800 text-xl mb-6">
                 {editingUser ? 'Edit User' : 'Create New User'}
               </h2>
               
               {error && (
                 <div className="mb-4 p-3 rounded-xl bg-red-50 text-red-600 text-sm border border-red-100 animate-fade-in">
                   {error}
                 </div>
               )}

               <form onSubmit={handleSubmit} className="space-y-4">
                 <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
                   <div className="space-y-4 p-4 rounded-xl border border-slate-100 bg-slate-50/70">
                     <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Username <span className="text-red-400">*</span></label>
                          <input type="text" className="glass-input" value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} required />
                        </div>
                        <div>
                           <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Role <span className="text-red-400">*</span></label>
                            <select className="glass-input" value={formData.role} onChange={e => setFormData({...formData, role: e.target.value})} required disabled>
                             <option value="CLIENT">Client</option>
                           </select>
                        </div>
                     </div>

                     <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Full Name</label>
                        <input type="text" className="glass-input" value={formData.full_name} onChange={e => setFormData({...formData, full_name: e.target.value})} />
                     </div>

                     {editingUser && (
                       <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                         Current Password: <span className="font-semibold">{editingUser.plain_password || 'Not available'}</span>
                       </div>
                     )}

                     <div>
                        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                          {editingUser ? 'Set New Password (optional)' : 'Password'} {(!editingUser) && <span className="text-red-400">*</span>}
                        </label>
                        <input type="text" className="glass-input" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} required={!editingUser} />
                     </div>
                   </div>

                   <div className="space-y-4">
                     {isAdmin && editingUser?.role?.toUpperCase() === 'CLIENT' && (
                       <div className="space-y-4 p-4 rounded-xl border border-slate-100 bg-slate-50/70">
                         <div>
                           <h3 className="text-sm font-semibold text-slate-700">Projects for this client</h3>
                           <p className="text-xs text-slate-500 mt-0.5">Reassign projects to another client or unassign them.</p>
                         </div>
                         {clientProjects.length === 0 ? (
                           <p className="text-xs text-slate-500">No projects assigned to this client.</p>
                         ) : (
                           <div className="space-y-2 max-h-44 overflow-y-auto pr-1">
                             {clientProjects.map(project => (
                               <div key={project.id} className="bg-white border border-slate-200 rounded-xl p-3 space-y-2">
                                 <div className="flex items-center justify-between gap-3">
                                   <p className="text-sm font-medium text-slate-700 truncate">{project.name}</p>
                                   <Badge status={project.status} />
                                 </div>
                                 <div className="flex items-center gap-2">
                                   <select
                                     className="glass-input text-xs"
                                     value={reassignTargets[project.id] ?? '__NO_CHANGE__'}
                                     onChange={e => setReassignTargets(prev => ({ ...prev, [project.id]: e.target.value }))}
                                   >
                                     <option value="__NO_CHANGE__">Select destination...</option>
                                     <option value="">Unassigned</option>
                                     {allClients
                                       .filter(c => c.id !== editingUser.id)
                                       .map(c => (
                                         <option key={c.id} value={c.id}>{c.full_name || c.username}</option>
                                       ))}
                                   </select>
                                   <button
                                     type="button"
                                     className="btn-secondary text-xs gap-1.5 shrink-0"
                                     onClick={() => handleReassignProject(project.id)}
                                     disabled={reassigningProjectId === project.id || reassignTargets[project.id] === undefined || reassignTargets[project.id] === '__NO_CHANGE__'}
                                   >
                                     {reassigningProjectId === project.id ? <Loader2 size={12} className="animate-spin" /> : <ArrowRightLeft size={12} />}
                                     Reassign
                                   </button>
                                 </div>
                               </div>
                             ))}
                           </div>
                         )}
                       </div>
                     )}

                     {isAdmin && editingUser?.role?.toUpperCase() === 'CLIENT' && (
                       <div className="space-y-3 p-4 rounded-xl border border-slate-100 bg-slate-50/70">
                         <div>
                           <h3 className="text-sm font-semibold text-slate-700">Assigned Sub-Admins</h3>
                           <p className="text-xs text-slate-500 mt-0.5">A client can be assigned to multiple sub-admin users.</p>
                         </div>
                         {subAdmins.length === 0 ? (
                           <p className="text-xs text-slate-500">No sub-admin users available.</p>
                         ) : (
                           <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto pr-1">
                             {subAdmins.map(sa => (
                               <label key={sa.id} className="flex items-center gap-2 text-sm text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2 cursor-pointer">
                                 <input
                                   type="checkbox"
                                   checked={selectedSubAdminIds.includes(sa.id)}
                                   onChange={() => toggleSubAdminSelection(sa.id)}
                                   className="rounded border-slate-300 text-primary-600 focus:ring-primary-500"
                                 />
                                 <span className="truncate">{sa.full_name || sa.username}</span>
                               </label>
                             ))}
                           </div>
                         )}
                       </div>
                     )}

                     {!editingUser && (
                       <div className="p-4 rounded-xl border border-slate-100 bg-slate-50/70 text-xs text-slate-500">
                         After creating this client, you can assign sub-admins and reassign projects from the edit window.
                       </div>
                     )}
                   </div>
                 </div>

                 <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 mt-6">
                    <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                    <button type="submit" className="btn-primary">{editingUser ? 'Save Changes' : 'Create User'}</button>
                 </div>
               </form>
            </div>
         </div>
      )}
    </div>
  );
}
