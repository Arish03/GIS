import { useState, useEffect, useMemo } from 'react';
import { PieChart, Pie, Cell, Tooltip as RechartsTooltip, Legend, ResponsiveContainer, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { Trees, CheckCircle, Navigation, Ruler } from 'lucide-react';
import api from '../../api/client';
import GlassCard from '../../components/ui/GlassCard';
import KpiCard from '../../components/KpiCard';
import Badge from '../../components/ui/Badge';
import Pagination from '../../components/ui/Pagination';
import FilterChips from '../../components/ui/FilterChips';
import SearchInput from '../../components/ui/SearchInput';

export default function AnalyticsView({ projectId, projectInfo, onLocateOnMap }) {
  const [metrics, setMetrics] = useState(null);
  const [trees, setTrees] = useState([]);
  const [loading, setLoading] = useState(true);

  // Table state
  const [search, setSearch] = useState('');
  const [healthFilter, setHealthFilter] = useState('ALL');
  const [page, setPage] = useState(1);
  const itemsPerPage = 25;

  useEffect(() => {
    const fetchAnalytics = async () => {
      if (!projectId) return;
      setLoading(true);
      try {
        const [metRes, treeRes] = await Promise.all([
          api.get(`/projects/${projectId}/analytics`),
          api.get(`/projects/${projectId}/trees/list`),
        ]);
        setMetrics(metRes.data);
        setTrees(treeRes.data || []);
      } catch (err) {
        console.error('Analytics fetch error:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchAnalytics();
  }, [projectId]);

  // Derived filtered data
  const filteredTrees = useMemo(() => {
    return trees.filter(t => {
      const matchSearch = String(t.tree_index).includes(search);
      const matchHealth = healthFilter === 'ALL' || t.health_status === healthFilter;
      return matchSearch && matchHealth;
    });
  }, [trees, search, healthFilter]);

  const totalPages = Math.ceil(filteredTrees.length / itemsPerPage);
  const paginatedTrees = useMemo(() => {
    const start = (page - 1) * itemsPerPage;
    return filteredTrees.slice(start, start + itemsPerPage);
  }, [filteredTrees, page]);

  // Reset page when filters change
  useEffect(() => { setPage(1); }, [search, healthFilter]);

  if (!projectId) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-12 text-slate-500">
        <Trees size={48} className="text-slate-300 mb-4" />
        <h2 className="text-xl font-heading font-bold text-slate-700">No Project Selected</h2>
        <p className="text-sm">Select a project from the top navigation to view analytics.</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex-1 p-6 lg:p-10 space-y-6">
        <div className="skeleton w-64 h-10" />
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1,2,3,4].map(i => <div key={i} className="skeleton h-28 w-full" />)}
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div className="skeleton h-80 w-full" />
          <div className="skeleton h-80 w-full" />
        </div>
      </div>
    );
  }

  // Normalise API response — backend returns health_breakdown, health_score, average_height
  const raw = metrics || {};
  const hb = raw.health_breakdown || {};
  const m = {
    total_trees: raw.total_trees || 0,
    healthy: hb.healthy || 0,
    moderate: hb.moderate || 0,
    poor: hb.poor || 0,
    health_score: raw.health_score || 0,
    average_height: raw.average_height || 0,
    height_distribution: raw.height_distribution || [],
    area_hectares: raw.area_hectares || 0,
  };

  const healthData = [
    { name: 'Healthy', value: m.healthy, color: '#16a34a' },
    { name: 'Moderate', value: m.moderate, color: '#d97706' },
    { name: 'Poor', value: m.poor, color: '#dc2626' },
  ];

  const heightDistribution = m.height_distribution;

  const filterOptions = [
    { value: 'ALL', label: 'All Trees', count: m.total_trees },
    { value: 'Healthy', label: 'Healthy', count: m.healthy },
    { value: 'Moderate', label: 'Moderate', count: m.moderate },
    { value: 'Poor', label: 'Poor', count: m.poor },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-4 sm:p-6 lg:p-8 space-y-8 bg-transparent">
      
      {/* Header */}
      <div>
        <h1 className="font-heading font-extrabold text-slate-800 text-3xl tracking-tight mb-2">
          Plantation Analytics
        </h1>
        <p className="text-slate-500 text-sm">
          Inventory and health overview for <span className="font-medium text-slate-700">{projectInfo?.name || 'the selected project'}</span>.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 sm:gap-6">
         <KpiCard color="blue" label="Total Trees" value={m.total_trees.toLocaleString()} sub="Individual detections" icon={Trees} />
         <KpiCard color="purple" label="Avg Canopy Height" value={`${Number(m.average_height || 0).toFixed(1)}m`} sub="Mean height across stand" icon={Ruler} />
         <KpiCard color="green" label="Health Score" value={`${Math.round(m.health_score)}%`} sub="Percentage of healthy trees" icon={CheckCircle} />
         <KpiCard color="amber" label="Plantation Area" value={m.area_hectares ? `${Number(m.area_hectares).toFixed(1)} ha` : (projectInfo?.area_ha ? `${projectInfo.area_ha.toFixed(1)} ha` : 'N/A')} sub="Survey boundary area" icon={Navigation} />
      </div>

      {/* Charts Row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
         {/* Donut Chart */}
         <GlassCard className="p-6">
            <h3 className="font-heading font-bold text-slate-800 text-lg mb-6">Health Classification</h3>
            <div className="h-64 sm:h-72 w-full relative">
               <ResponsiveContainer width="100%" height="100%">
                 <PieChart>
                   <Pie
                     data={healthData}
                     innerRadius="60%"
                     outerRadius="80%"
                     paddingAngle={3}
                     dataKey="value"
                     stroke="none"
                   >
                     {healthData.map((entry, index) => (
                       <Cell key={`cell-${index}`} fill={entry.color} />
                     ))}
                   </Pie>
                   <RechartsTooltip formatter={(val) => val.toLocaleString()} contentStyle={{borderRadius:'12px', border:'none', boxShadow:'0 4px 16px rgba(0,0,0,0.1)'}} />
                   <Legend verticalAlign="bottom" height={36} iconType="circle" />
                 </PieChart>
               </ResponsiveContainer>
               {/* Center text */}
               <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none pb-8">
                 <span className="text-3xl font-extrabold text-slate-800 font-heading">{Math.round(m.health_score)}%</span>
                 <span className="text-xs text-slate-400 font-medium">Healthy</span>
               </div>
            </div>
         </GlassCard>

         {/* Bar Chart */}
         <GlassCard className="p-6">
            <h3 className="font-heading font-bold text-slate-800 text-lg mb-6">Height Distribution (m)</h3>
            <div className="h-64 sm:h-72 w-full">
               <ResponsiveContainer width="100%" height="100%">
                 <BarChart data={heightDistribution} margin={{ top: 5, right: 10, left: -20, bottom: 5 }}>
                   <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                   <XAxis dataKey="range" axisLine={false} tickLine={false} tick={{fontSize: 11, fill: '#64748b'}} dy={10} />
                   <YAxis axisLine={false} tickLine={false} tick={{fontSize: 11, fill: '#64748b'}} />
                   <RechartsTooltip cursor={{fill: 'rgba(59,130,246,0.05)'}} contentStyle={{borderRadius:'12px', border:'none', boxShadow:'0 4px 16px rgba(0,0,0,0.1)'}} />
                   <Bar dataKey="count" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={50} />
                 </BarChart>
               </ResponsiveContainer>
            </div>
         </GlassCard>
      </div>

      {/* Master Inventory Table */}
      <GlassCard className="overflow-hidden flex flex-col">
         <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <h3 className="font-heading font-bold text-slate-800 text-lg mb-1">Master Tree Inventory</h3>
              <p className="text-xs text-slate-500">Showing {filteredTrees.length.toLocaleString()} of {trees.length.toLocaleString()} trees</p>
            </div>
            
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
               <div className="w-full sm:w-64">
                 <SearchInput value={search} onChange={setSearch} placeholder="Search Tree ID..." />
               </div>
               <FilterChips options={filterOptions} value={healthFilter} onChange={setHealthFilter} />
            </div>
         </div>

         <div className="overflow-x-auto">
            <table className="glass-table w-full">
              <thead>
                <tr>
                  <th className="pl-6 w-24">Tree ID</th>
                  <th>Height (m)</th>
                  <th>Health Status</th>
                  <th>Coordinates (Lat, Lng)</th>
                  <th className="pr-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {paginatedTrees.map(t => (
                  <tr key={t.id}>
                    <td className="pl-6 py-3 text-slate-800 font-medium">#{t.tree_index}</td>
                    <td className="py-3 font-mono text-xs">{t.height_m != null ? Number(t.height_m).toFixed(2) : '—'}</td>
                    <td className="py-3">
                      <Badge status={t.health_status || 'UNKNOWN'}>
                         {t.health_status}
                      </Badge>
                    </td>
                    <td className="py-3 font-mono text-xs text-slate-500">
                      {t.latitude != null ? `${Number(t.latitude).toFixed(6)}, ${Number(t.longitude).toFixed(6)}` : 'N/A'}
                    </td>
                    <td className="pr-6 py-3 text-right">
                       <button
                         className="text-xs font-semibold text-blue-600 hover:text-blue-800 hover:underline"
                         onClick={() => onLocateOnMap && onLocateOnMap(t)}
                       >
                         Locate on Map
                       </button>
                    </td>
                  </tr>
                ))}
                {paginatedTrees.length === 0 && (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-slate-500 text-sm">
                      No trees found matching filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
         </div>
         
         <div className="px-6 py-2 border-t border-slate-100 bg-slate-50/50">
            <Pagination page={page} totalPages={totalPages} onChange={setPage} />
         </div>
      </GlassCard>
      
    </div>
  );
}
