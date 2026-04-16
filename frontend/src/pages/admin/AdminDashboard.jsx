import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Users, FolderOpen, Activity, CheckCircle2, Loader2, ChevronRight } from 'lucide-react';
import api from '../../api/client';
import { useAuth } from '../../contexts/AuthContext';
import Navbar from '../../components/Navbar';
import KpiCard from '../../components/KpiCard';
import SearchInput from '../../components/ui/SearchInput';

export default function AdminDashboard() {
  const [clients, setClients] = useState([]);
  const [projects, setProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const { isAdmin, isStaff } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    async function fetchData() {
      try {
        const [clientsRes, projectsRes] = await Promise.all([
          api.get('/users/clients'),
          api.get('/projects'),
        ]);
        setClients(clientsRes.data);
        setProjects(projectsRes.data.projects);
      } catch (err) {
        console.error('Failed to fetch dashboard data', err);
      } finally {
        setLoading(false);
      }
    }
    fetchData();
    const interval = setInterval(fetchData, 15000);
    return () => clearInterval(interval);
  }, []);

  // Build client cards with project stats
  const clientCards = clients.map(client => {
    const clientProjects = projects.filter(p => p.client_id === client.id);
    const readyCount = clientProjects.filter(p => p.status === 'READY').length;
    const processingCount = clientProjects.filter(p => ['PROCESSING', 'UPLOADING'].includes(p.status)).length;
    return { ...client, projectCount: clientProjects.length, readyCount, processingCount };
  });

  // Unassigned projects
  const unassignedProjects = projects.filter(p => !p.client_id);

  // KPI metrics
  const totalClients = clients.length;
  const totalProjects = projects.length;
  const processingCount = projects.filter(p => p.status === 'PROCESSING').length;
  const readyCount = projects.filter(p => p.status === 'READY').length;

  // Filter clients by search
  const filtered = clientCards.filter(c => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.full_name.toLowerCase().includes(q) || c.username.toLowerCase().includes(q);
  });

  return (
    <div className="page-bg">
      <div className="blob-container">
        <div className="blob blob-green" />
        <div className="blob blob-teal" />
        <div className="blob blob-blue" />
      </div>

      <Navbar />

      <main className="relative z-10 max-w-screen-xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="font-heading font-extrabold text-slate-800 text-2xl sm:text-3xl tracking-tight">
              Dashboard
            </h1>
            <p className="text-slate-500 text-sm mt-1">Manage clients and their plantation projects.</p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {isStaff && (
              <button className="btn-secondary gap-2" onClick={() => navigate('/admin/clients')}>
                <Users size={16} /> Manage Clients
              </button>
            )}
          </div>
        </div>

        {/* KPI Grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <KpiCard label="Total Clients" value={loading ? '—' : totalClients} sub="Active accounts" color="blue" icon={Users} />
          <KpiCard label="Total Projects" value={loading ? '—' : totalProjects} sub="Across all clients" color="purple" icon={FolderOpen} />
          <KpiCard label="Processing" value={loading ? '—' : processingCount} sub="Background tasks" color="amber" icon={Loader2} />
          <KpiCard label="Ready" value={loading ? '—' : readyCount} sub="Available to clients" color="green" icon={CheckCircle2} />
        </div>

        {/* Search bar */}
        <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
          <div className="flex-1 min-w-0">
            <SearchInput value={search} onChange={setSearch} placeholder="Search clients by name…" />
          </div>
        </div>

        {/* Client count */}
        <div className="flex items-center justify-between">
          <p className="text-sm text-slate-500">
            {loading ? 'Loading…' : `${filtered.length} client${filtered.length !== 1 ? 's' : ''}`}
            {unassignedProjects.length > 0 && ` · ${unassignedProjects.length} unassigned project${unassignedProjects.length !== 1 ? 's' : ''}`}
          </p>
        </div>

        {/* Client Grid */}
        {loading ? (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {[1,2,3].map(i => (
              <div key={i} className="glass-card p-5 space-y-3">
                <div className="skeleton h-10 w-10 rounded-full" />
                <div className="skeleton h-6 w-3/4 rounded-lg" />
                <div className="skeleton h-4 w-1/2 rounded-lg" />
                <div className="skeleton h-9 w-full rounded-xl mt-2" />
              </div>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-4">
            {/* Unassigned card */}
            <div
              onClick={() => navigate('/admin/clients/unassigned/projects')}
              className="relative bg-amber-50/60 backdrop-blur-glass border border-amber-200/80 rounded-2xl shadow-glass
                         hover:shadow-glass-hover hover:-translate-y-0.5 hover:border-amber-300
                         transition-all duration-200 overflow-hidden group cursor-pointer"
            >
                <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-amber-400 to-orange-400
                                opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                <div className="p-5">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-10 h-10 rounded-full bg-amber-100 flex items-center justify-center
                                    text-amber-600 text-sm font-bold">
                      ?
                    </div>
                    <div className="flex-1 min-w-0">
                      <h3 className="font-heading font-bold text-slate-800 text-base leading-snug">Unassigned</h3>
                      <p className="text-xs text-slate-500">Projects without a client</p>
                    </div>
                    <ChevronRight size={16} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
                  </div>
                  <div className="flex gap-3">
                    <div className="flex-1 bg-white/60 rounded-xl px-3 py-2 text-center">
                      <p className="text-lg font-bold text-slate-800">{unassignedProjects.length}</p>
                      <p className="text-xs text-slate-500">Projects</p>
                    </div>
                  </div>
                </div>
            </div>

            {/* Client cards */}
            {filtered.map(client => {
              const initials = client.full_name
                ?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '??';
              return (
                <div
                  key={client.id}
                  onClick={() => navigate(`/admin/clients/${client.id}/projects`)}
                  className="relative bg-white/60 backdrop-blur-glass border border-white/80 rounded-2xl shadow-glass
                             hover:shadow-glass-hover hover:-translate-y-0.5 hover:border-primary-200
                             transition-all duration-200 overflow-hidden group cursor-pointer"
                >
                  <div className="absolute top-0 left-0 right-0 h-0.5 bg-gradient-to-r from-primary-400 to-teal-400
                                  opacity-0 group-hover:opacity-100 transition-opacity duration-200" />
                  <div className="p-5">
                    <div className="flex items-center gap-3 mb-4">
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-primary-500 to-teal-500
                                      flex items-center justify-center text-white text-sm font-bold shadow-sm">
                        {initials}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="font-heading font-bold text-slate-800 text-base leading-snug truncate">
                          {client.full_name}
                        </h3>
                        <p className="text-xs text-slate-500 truncate">@{client.username}</p>
                      </div>
                      <ChevronRight size={16} className="text-slate-400 group-hover:text-slate-600 transition-colors" />
                    </div>

                    {/* Stats row */}
                    <div className="flex gap-3">
                      <div className="flex-1 bg-white/60 rounded-xl px-3 py-2 text-center">
                        <p className="text-lg font-bold text-slate-800">{client.projectCount}</p>
                        <p className="text-xs text-slate-500">Projects</p>
                      </div>
                      <div className="flex-1 bg-green-50/60 rounded-xl px-3 py-2 text-center">
                        <p className="text-lg font-bold text-green-700">{client.readyCount}</p>
                        <p className="text-xs text-slate-500">Ready</p>
                      </div>
                      {client.processingCount > 0 && (
                        <div className="flex-1 bg-amber-50/60 rounded-xl px-3 py-2 text-center">
                          <p className="text-lg font-bold text-amber-700">{client.processingCount}</p>
                          <p className="text-xs text-slate-500">Active</p>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}

            {/* Empty state */}
            {filtered.length === 0 && unassignedProjects.length === 0 && (
              <div className="sm:col-span-2 xl:col-span-3 glass-card py-16 flex flex-col items-center justify-center text-center">
                <div className="w-16 h-16 rounded-2xl bg-primary-50 flex items-center justify-center mb-4">
                  <Users size={28} className="text-primary-400" />
                </div>
                <h3 className="font-heading font-bold text-slate-700 text-lg mb-1">No Clients Found</h3>
                <p className="text-slate-400 text-sm max-w-sm">
                  {search ? 'Try adjusting your search.' : 'Create your first client to get started.'}
                </p>
                {isAdmin && !search && (
                  <button className="btn-primary mt-5 gap-2" onClick={() => navigate('/admin/clients')}>
                    <Plus size={16} /> Add Client
                  </button>
                )}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
