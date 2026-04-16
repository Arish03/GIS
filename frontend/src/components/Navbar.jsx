import { useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Map, BarChart3, LogOut, Menu, X, ChevronDown } from 'lucide-react';

export default function Navbar({
  projects = [],
  selectedProjectId,
  onProjectChange,
  activeView,
  onViewChange,
  showViewToggle = false,
  showProjectSelector = false,
}) {
  const { user, logout, isAdmin, isStaff } = useAuth();
  const navigate = useNavigate();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [projectDropOpen, setProjectDropOpen] = useState(false);

  const handleLogout = () => { logout(); navigate('/login'); };
  const handleBrandClick = () => {
    setMobileOpen(false);
    navigate(isStaff ? '/admin' : '/');
  };

  const initials = user?.full_name
    ?.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2) || '??';

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  return (
    <>
      <nav className="glass-nav sticky top-0 z-50">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-4">

          {/* Brand */}
          <div
            onClick={handleBrandClick}
            className="flex items-center gap-2.5 cursor-pointer shrink-0 select-none"
          >
            {/* Logo placeholder — user will add image later */}
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary-500 to-teal-500
                            flex items-center justify-center shadow-green-glow-sm">
              <span className="text-white text-xs font-bold">PV</span>
            </div>
            <span className="font-heading font-bold text-slate-800 text-base hidden sm:block">PlantView</span>
          </div>

          {/* Staff Nav Links (desktop) */}
          {isStaff && (
            <div className="hidden md:flex items-center gap-1">
              <NavLink active={window.location.pathname === '/admin'} onClick={() => navigate('/admin')}>
                Dashboard
              </NavLink>
              {isStaff && (
                <NavLink active={window.location.pathname === '/admin/clients'} onClick={() => navigate('/admin/clients')}>
                  Manage Clients
                </NavLink>
              )}
              {isAdmin && (
                <NavLink active={window.location.pathname === '/admin/sub-admins'} onClick={() => navigate('/admin/sub-admins')}>
                  Manage Sub-Admins
                </NavLink>
              )}
            </div>
          )}
          <div className="hidden md:flex items-center gap-3 flex-1 justify-center">
            {showProjectSelector && projects.length > 0 && (
              <div className="relative">
                <button
                  onClick={() => setProjectDropOpen(!projectDropOpen)}
                  className="flex items-center gap-2 px-3 py-2 rounded-xl border border-slate-200
                             bg-white/70 backdrop-blur-sm text-sm font-medium text-slate-700
                             hover:border-primary-300 transition-all min-w-40 max-w-56"
                >
                  <span className="truncate">{selectedProject?.name || 'Select Project'}</span>
                  <ChevronDown size={14} className={`text-slate-400 shrink-0 transition-transform ${projectDropOpen ? 'rotate-180' : ''}`} />
                </button>
                {projectDropOpen && (
                  <div className="absolute top-full left-0 mt-1 w-64 bg-white/95 backdrop-blur-sm
                                  border border-slate-200 rounded-xl shadow-glass-hover py-1 z-50">
                    {projects.map(p => (
                      <button
                        key={p.id}
                        onClick={() => { onProjectChange(p.id); setProjectDropOpen(false); }}
                        className={`w-full text-left px-4 py-2.5 text-sm transition-colors
                          ${p.id === selectedProjectId
                            ? 'text-primary-700 bg-primary-50 font-medium'
                            : 'text-slate-700 hover:bg-slate-50'}`}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {showViewToggle && (
              <div className="flex bg-slate-100/80 rounded-full p-1 border border-slate-200/60">
                <ViewBtn active={activeView === 'map'} onClick={() => onViewChange('map')} icon={<Map size={13} />}>
                  Map
                </ViewBtn>
                <ViewBtn active={activeView === 'analytics'} onClick={() => onViewChange('analytics')} icon={<BarChart3 size={13} />}>
                  Analytics
                </ViewBtn>
              </div>
            )}
          </div>

          {/* Right — User + Logout (desktop) */}
          <div className="hidden md:flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-teal-500
                              flex items-center justify-center text-white text-xs font-bold shadow-sm">
                {initials}
              </div>
              <div className="flex flex-col leading-none">
                <span className="text-sm font-semibold text-slate-800">{user?.full_name}</span>
                <span className="text-xs text-slate-400 capitalize">{user?.role}</span>
              </div>
            </div>
            <button
              onClick={handleLogout}
              className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-xs font-medium
                         text-slate-500 border border-slate-200 bg-white/70
                         hover:text-red-500 hover:border-red-200 hover:bg-red-50
                         transition-all duration-150"
            >
              <LogOut size={13} /> Sign Out
            </button>
          </div>

          {/* Hamburger (mobile) */}
          <button
            className="md:hidden p-2 rounded-xl text-slate-600 hover:bg-slate-100 transition-colors"
            onClick={() => setMobileOpen(!mobileOpen)}
          >
            {mobileOpen ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>

        {/* Mobile Menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-white/60 bg-white/90 backdrop-blur-xl animate-slide-down">
            <div className="px-4 py-4 space-y-3">
              {/* Staff nav links mobile */}
              {isStaff && (
                <div className="flex gap-2">
                  <button onClick={() => { navigate('/admin'); setMobileOpen(false); }}
                    className="flex-1 py-2 rounded-xl text-sm font-medium text-center
                               bg-white border border-slate-200 text-slate-700 hover:border-primary-300 transition">
                    Dashboard
                  </button>
                  {isStaff && (
                    <button onClick={() => { navigate('/admin/clients'); setMobileOpen(false); }}
                      className="flex-1 py-2 rounded-xl text-sm font-medium text-center
                                 bg-white border border-slate-200 text-slate-700 hover:border-primary-300 transition">
                      Manage Clients
                    </button>
                  )}
                  {isAdmin && (
                    <button onClick={() => { navigate('/admin/sub-admins'); setMobileOpen(false); }}
                      className="flex-1 py-2 rounded-xl text-sm font-medium text-center
                                 bg-white border border-slate-200 text-slate-700 hover:border-primary-300 transition">
                      Sub-Admins
                    </button>
                  )}
                </div>
              )}

              {/* Project selector mobile */}
              {showProjectSelector && projects.length > 0 && (
                <select
                  value={selectedProjectId || ''}
                  onChange={e => { onProjectChange(e.target.value); }}
                  className="glass-input"
                >
                  {projects.map(p => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              )}

              {/* View toggle mobile */}
              {showViewToggle && (
                <div className="flex bg-slate-100 rounded-full p-1 border border-slate-200">
                  <ViewBtn active={activeView === 'map'} onClick={() => { onViewChange('map'); setMobileOpen(false); }} icon={<Map size={13} />}>
                    Map View
                  </ViewBtn>
                  <ViewBtn active={activeView === 'analytics'} onClick={() => { onViewChange('analytics'); setMobileOpen(false); }} icon={<BarChart3 size={13} />}>
                    Analytics
                  </ViewBtn>
                </div>
              )}

              {/* User + logout mobile */}
              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-full bg-gradient-to-br from-primary-500 to-teal-500
                                  flex items-center justify-center text-white text-xs font-bold">
                    {initials}
                  </div>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">{user?.full_name}</p>
                    <p className="text-xs text-slate-400 capitalize">{user?.role}</p>
                  </div>
                </div>
                <button onClick={handleLogout}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium
                             text-red-500 border border-red-200 bg-red-50 transition-all">
                  <LogOut size={13} /> Sign Out
                </button>
              </div>
            </div>
          </div>
        )}
      </nav>

      {/* Click outside to close dropdowns */}
      {(projectDropOpen || mobileOpen) && (
        <div className="fixed inset-0 z-40" onClick={() => { setProjectDropOpen(false); }} />
      )}
    </>
  );
}

function NavLink({ children, active, onClick }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2 rounded-xl text-sm font-medium transition-all duration-150
        ${active
          ? 'text-primary-700 bg-primary-50 font-semibold'
          : 'text-slate-600 hover:text-slate-800 hover:bg-slate-50'}`}
    >
      {children}
    </button>
  );
}

function ViewBtn({ children, active, onClick, icon }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-4 py-1.5 rounded-full text-xs font-semibold
                  transition-all duration-150
        ${active
          ? 'bg-primary-600 text-white shadow-green-glow-sm'
          : 'text-slate-500 hover:text-slate-700'}`}
    >
      {icon}{children}
    </button>
  );
}
