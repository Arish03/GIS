import { useState, useEffect } from 'react';
import { Plus, Edit2, Trash2, ShieldAlert, Loader2 } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import Navbar from '../../components/Navbar';
import ConfirmModal from '../../components/ConfirmModal';
import SearchInput from '../../components/ui/SearchInput';
import GlassCard from '../../components/ui/GlassCard';

export default function AdminSubAdmins() {
  const { isAdmin } = useAuth();
  const [subAdmins, setSubAdmins] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [showModal, setShowModal] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const [formData, setFormData] = useState({ username: '', full_name: '', password: '' });
  const [error, setError] = useState('');

  // Client assignment state
  const [allClients, setAllClients] = useState([]);
  const [selectedClientIds, setSelectedClientIds] = useState([]);
  const [loadingClients, setLoadingClients] = useState(false);

  const [confirmModal, setConfirmModal] = useState({
    show: false, title: '', message: '', type: 'info',
    onConfirm: () => {}, onCancel: () => setConfirmModal(p => ({ ...p, show: false })),
  });

  const loadClientsForSelection = async () => {
    const res = await api.get('/users/clients');
    setAllClients(res.data);
  };

  const fetchSubAdmins = async () => {
    try {
      const res = await api.get('/users/sub-admins');
      const subAdminsWithCounts = await Promise.all(
        res.data.map(async (subAdmin) => {
          try {
            const assignedRes = await api.get(`/users/sub-admins/${subAdmin.id}/clients`);
            return { ...subAdmin, assigned_client_count: assignedRes.data.length };
          } catch {
            return { ...subAdmin, assigned_client_count: 0 };
          }
        })
      );
      setSubAdmins(subAdminsWithCounts);
    } catch (err) {
      console.error('Failed to fetch sub-admins', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchSubAdmins(); }, []);

  const openCreateModal = () => {
    setEditingUser(null);
    setFormData({ username: '', full_name: '', password: '' });
    loadClientsForSelection().catch(err => {
      console.error('Failed to load clients', err);
      setError('Failed to load clients.');
    });
    setSelectedClientIds([]);
    setError('');
    setShowModal(true);
  };

  const loadEditData = async (subAdminId) => {
    setLoadingClients(true);
    try {
      const [clientsRes, assignedRes] = await Promise.all([
        api.get('/users/clients'),
        api.get(`/users/sub-admins/${subAdminId}/clients`),
      ]);
      setAllClients(clientsRes.data);
      setSelectedClientIds(assignedRes.data.map(u => u.id));
    } catch (err) {
      console.error('Failed to load edit data', err);
      setError('Failed to load client assignments.');
    } finally {
      setLoadingClients(false);
    }
  };

  const openEditModal = async (user) => {
    setEditingUser(user);
    setFormData({ username: user.username, full_name: user.full_name || '', password: '' });
    setError('');
    setShowModal(true);
    await loadEditData(user.id);
  };

  const toggleClientSelection = (clientId) => {
    setSelectedClientIds(prev =>
      prev.includes(clientId)
        ? prev.filter(id => id !== clientId)
        : [...prev, clientId]
    );
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');

    try {
      if (editingUser) {
        const updateData = { ...formData };
        if (!updateData.password) delete updateData.password;
        await api.put(`/users/${editingUser.id}`, updateData);
        // Save client assignments
        await api.put(`/users/sub-admins/${editingUser.id}/clients`, {
          client_ids: selectedClientIds,
        });
      } else {
        const created = await api.post('/users', { ...formData, role: 'SUB_ADMIN' });
        await api.put(`/users/sub-admins/${created.data.id}/clients`, {
          client_ids: selectedClientIds,
        });
      }
      setShowModal(false);
      fetchSubAdmins();
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
      title: 'Delete Sub-Admin',
      message: 'Are you sure you want to delete this sub-admin? Their client assignments will be removed.',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      type: 'danger',
      onConfirm: async () => {
        try {
          await api.delete(`/users/${userId}`);
          fetchSubAdmins();
        } catch (err) {
          console.error('Delete failed', err);
        }
        setConfirmModal(p => ({ ...p, show: false }));
      },
      onCancel: () => setConfirmModal(p => ({ ...p, show: false })),
    });
  };

  const filteredSubAdmins = subAdmins.filter(u =>
    !search ||
    u.full_name?.toLowerCase().includes(search.toLowerCase()) ||
    u.username.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="page-bg">
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
              Sub-Admin Management
            </h1>
            <p className="text-slate-500 text-sm mt-1">Create sub-admin accounts and assign them to clients.</p>
          </div>
          {isAdmin && (
            <button className="btn-primary" onClick={openCreateModal}>
              <Plus size={16} /> New Sub-Admin
            </button>
          )}
        </div>

        {/* Toolbar */}
        <div className="flex items-center">
          <div className="w-full sm:max-w-md">
            <SearchInput value={search} onChange={setSearch} placeholder="Search sub-admins by name or username..." />
          </div>
        </div>

        {/* Sub-Admin List */}
        <GlassCard className="overflow-hidden p-0">
          <div className="overflow-x-auto">
            <table className="glass-table w-full">
              <thead>
                <tr>
                  <th className="pl-6 w-16">User</th>
                  <th>Name</th>
                  <th>Assigned Clients</th>
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
                      <td className="px-6 py-4 text-right"><div className="skeleton h-8 w-16 rounded ml-auto" /></td>
                    </tr>
                  ))
                ) : filteredSubAdmins.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="py-12 text-center text-slate-500 font-medium">
                      {search ? 'No sub-admins found matching your search.' : 'No sub-admin accounts yet. Create one to get started.'}
                    </td>
                  </tr>
                ) : (
                  filteredSubAdmins.map(user => {
                    const initials = (user.full_name || user.username || '').substring(0, 2).toUpperCase();
                    return (
                      <tr key={user.id} className="group">
                        <td className="pl-6 py-3">
                          <div className="w-10 h-10 rounded-full flex items-center justify-center font-bold text-white text-sm shadow-sm bg-gradient-to-br from-blue-500 to-cyan-500">
                            {initials}
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="font-semibold text-slate-800">{user.full_name || user.username}</div>
                          <div className="text-xs text-slate-500 mt-0.5">@{user.username}</div>
                        </td>
                        <td className="px-4 py-3">
                          <span className="inline-flex items-center gap-1 text-xs font-semibold text-cyan-700 bg-cyan-50 px-2.5 py-1 rounded-full ring-1 ring-cyan-200">
                            <ShieldAlert size={12} /> {user.assigned_client_count ?? 0}
                          </span>
                        </td>
                        <td className="pr-6 py-3 text-right">
                          <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button onClick={() => openEditModal(user)} className="p-1.5 rounded text-blue-600 hover:bg-blue-50 transition" title="Edit Sub-Admin">
                              <Edit2 size={16} />
                            </button>
                            <button onClick={() => handleDelete(user.id)} className="p-1.5 rounded text-red-500 hover:bg-red-50 transition" title="Delete Sub-Admin">
                              <Trash2 size={16} />
                            </button>
                          </div>
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

      {/* Sub-Admin Edit/Create Modal */}
      {showModal && (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/25 backdrop-blur-sm" onClick={() => setShowModal(false)} />
          <div className="relative z-10 w-full max-w-5xl max-h-[90vh] overflow-y-auto bg-white/90 backdrop-blur-2xl border border-white/90 rounded-2xl shadow-glass-lg animate-slide-up p-6">
            <h2 className="font-heading font-bold text-slate-800 text-xl mb-6">
              {editingUser ? 'Edit Sub-Admin' : 'Create New Sub-Admin'}
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
                      <input type="text" className="glass-input" value={formData.username} onChange={e => setFormData({ ...formData, username: e.target.value })} required />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Role</label>
                      <select className="glass-input" value="SUB_ADMIN" disabled>
                        <option value="SUB_ADMIN">Sub-Admin</option>
                      </select>
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Full Name</label>
                    <input type="text" className="glass-input" value={formData.full_name} onChange={e => setFormData({ ...formData, full_name: e.target.value })} />
                  </div>

                  {editingUser && (
                    <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      Current Password: <span className="font-semibold">{editingUser.plain_password || 'Not available'}</span>
                    </div>
                  )}

                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      {editingUser ? 'Set New Password (optional)' : 'Password'} {!editingUser && <span className="text-red-400">*</span>}
                    </label>
                    <input type="text" className="glass-input" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })} required={!editingUser} />
                  </div>
                </div>

                <div className="space-y-3 p-4 rounded-xl border border-slate-100 bg-slate-50/70">
                  <div>
                    <h3 className="text-sm font-semibold text-slate-700">Assigned Clients</h3>
                    <p className="text-xs text-slate-500 mt-0.5">Select which clients this sub-admin can manage. Clients can be shared across multiple sub-admins.</p>
                  </div>
                  {loadingClients ? (
                    <div className="flex items-center justify-center py-4 text-sm text-slate-400">
                      <Loader2 size={16} className="animate-spin mr-2" /> Loading clients…
                    </div>
                  ) : allClients.length === 0 ? (
                    <p className="text-xs text-slate-500">No client accounts available.</p>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-48 overflow-y-auto pr-1">
                      {allClients.map(client => (
                        <label key={client.id} className="flex items-center gap-2 text-sm text-slate-700 bg-white border border-slate-200 rounded-lg px-3 py-2 cursor-pointer hover:border-blue-200 transition-colors">
                          <input
                            type="checkbox"
                            checked={selectedClientIds.includes(client.id)}
                            onChange={() => toggleClientSelection(client.id)}
                            className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                          />
                          <span className="truncate">{client.full_name || client.username}</span>
                        </label>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-slate-400">
                    {selectedClientIds.length} client{selectedClientIds.length !== 1 ? 's' : ''} selected
                  </p>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4 border-t border-slate-100 mt-6">
                <button type="button" onClick={() => setShowModal(false)} className="btn-secondary">Cancel</button>
                <button type="submit" className="btn-primary">{editingUser ? 'Save Changes' : 'Create Sub-Admin'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
