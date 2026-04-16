import { BrowserRouter as Router, Routes, Route, Navigate, useParams, useNavigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';

// Pages
import LoginPage from './pages/LoginPage';
import AdminDashboard from './pages/admin/AdminDashboard';
import ProjectWizard from './pages/admin/ProjectWizard';
import AdminClients from './pages/admin/AdminClients';
import AdminSubAdmins from './pages/admin/AdminSubAdmins';
import ProjectEdit from './pages/admin/ProjectEdit';
import ClientProjects from './pages/admin/ClientProjects';
import MapView from './pages/client/MapView';
import AnalyticsView from './pages/client/AnalyticsView';

// Layout shim for Client Portal
import { useState, useEffect } from 'react';
import { FolderOpen, ArrowLeft } from 'lucide-react';
import api from './api/client';
import Navbar from './components/Navbar';

function ClientPortal() {
  const [projects, setProjects] = useState([]);
  const [selectedProjectId, setSelectedProjectId] = useState(null);
  const [activeView, setActiveView] = useState('map');
  const [loading, setLoading] = useState(true);
  
  const { user } = useAuth(); // Needed to check if user is admin

  useEffect(() => {
    async function fetchProjects() {
      try {
        const res = await api.get('/projects');
        setProjects(res.data.projects);
        if (res.data.projects.length > 0) {
          setSelectedProjectId(res.data.projects[0].id);
        }
      } catch (err) {
        console.error('Failed to fetch projects', err);
      } finally {
        setLoading(false);
      }
    }
    fetchProjects();
  }, []);

  // Root redirect for staff (admin + sub-admin)
  const role = user?.role?.toUpperCase();
  if (role === 'ADMIN' || role === 'SUB_ADMIN') {
    return <Navigate to="/admin" replace />;
  }

  if (loading) return (
    <div className="page-bg flex items-center justify-center">
      <div className="spinner" />
    </div>
  );

  if (projects.length === 0) {
    return (
      <div className="page-bg min-h-screen">
        <div className="blob-container">
          <div className="blob blob-green" />
        </div>
        <Navbar />
        <main className="relative z-10 max-w-screen-xl mx-auto px-4 py-16 flex justify-center">
          <div className="bg-white/70 backdrop-blur-xl border border-white/90 rounded-2xl shadow-glass p-12 flex flex-col items-center text-center max-w-lg">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <FolderOpen size={28} className="text-slate-400" />
            </div>
            <h2 className="font-heading font-bold text-slate-800 text-xl mb-2">No Projects Found</h2>
            <p className="text-sm text-slate-500">You don't have any projects assigned yet. Please contact your system administrator to get started.</p>
          </div>
        </main>
      </div>
    );
  }

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  return (
    <div className="page-bg min-h-screen flex flex-col">
      <Navbar
        projects={projects}
        selectedProjectId={selectedProjectId}
        onProjectChange={setSelectedProjectId}
        activeView={activeView}
        onViewChange={setActiveView}
        showViewToggle={!!selectedProjectId}
        showProjectSelector={true}
      />
      <main className="flex-1 w-full flex flex-col relative z-10">
        {activeView === 'map' ? (
          <MapView projectId={selectedProjectId} projectInfo={selectedProject} />
        ) : (
          <AnalyticsView projectId={selectedProjectId} projectInfo={selectedProject} onLocateOnMap={() => setActiveView('map')} />
        )}
      </main>
    </div>
  );
}

function AdminProjectView() {
  const { projectId } = useParams();
  const navigate = useNavigate();
  const [project, setProject] = useState(null);
  const [activeView, setActiveView] = useState('map');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get(`/projects/${projectId}`)
      .then(res => setProject(res.data))
      .catch(err => console.error('Failed to fetch project', err))
      .finally(() => setLoading(false));
  }, [projectId]);

  if (loading) return (
    <div className="page-bg flex items-center justify-center min-h-screen">
      <div className="spinner" />
    </div>
  );

  if (!project) return (
    <div className="page-bg min-h-screen">
      <Navbar />
      <main className="relative z-10 max-w-screen-xl mx-auto px-4 py-16 text-center">
        <p className="text-red-500 font-bold">Project not found</p>
        <button onClick={() => navigate('/admin')} className="btn-secondary mt-4">Back to Admin</button>
      </main>
    </div>
  );

  return (
    <div className="page-bg min-h-screen flex flex-col">
      <Navbar
        projects={[project]}
        selectedProjectId={project.id}
        onProjectChange={() => {}}
        activeView={activeView}
        onViewChange={setActiveView}
        showViewToggle={true}
        showProjectSelector={false}
      />
      {/* Back button — try to navigate back to client's project list */}
      <button
        onClick={() => {
          const clientId = project.client_id;
          navigate(clientId ? `/admin/clients/${clientId}/projects` : '/admin');
        }}
        className="fixed top-20 left-4 z-40 flex items-center gap-1.5 px-3 py-1.5 rounded-xl
                   bg-white/80 backdrop-blur-sm border border-slate-200 shadow-sm
                   text-xs font-semibold text-slate-600 hover:bg-white hover:text-slate-800 transition-all"
      >
        <ArrowLeft size={14} /> Back
      </button>
      <main className="flex-1 w-full flex flex-col relative z-10">
        {activeView === 'map' ? (
          <MapView projectId={project.id} projectInfo={project} />
        ) : (
          <AnalyticsView projectId={project.id} projectInfo={project} onLocateOnMap={() => setActiveView('map')} />
        )}
      </main>
    </div>
  );
}

function App() {
  return (
    <Router>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          
          {/* Staff Routes (ADMIN + SUB_ADMIN) */}
          <Route 
            path="/admin" 
            element={
              <ProtectedRoute requiredRole="staff">
                <AdminDashboard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/projects/new" 
            element={
              <ProtectedRoute requiredRole="staff">
                <ProjectWizard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/projects/:projectId/wizard" 
            element={
              <ProtectedRoute requiredRole="staff">
                <ProjectWizard />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/clients" 
            element={
              <ProtectedRoute requiredRole="staff">
                <AdminClients />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/sub-admins" 
            element={
              <ProtectedRoute requiredRole="ADMIN">
                <AdminSubAdmins />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/clients/:clientId/projects" 
            element={
              <ProtectedRoute requiredRole="staff">
                <ClientProjects />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/projects/:projectId/edit" 
            element={
              <ProtectedRoute requiredRole="staff">
                <ProjectEdit />
              </ProtectedRoute>
            } 
          />
          <Route 
            path="/admin/projects/:projectId/view" 
            element={
              <ProtectedRoute requiredRole="staff">
                <AdminProjectView />
              </ProtectedRoute>
            } 
          />

          {/* Client Routes */}
          <Route 
            path="/" 
            element={
              <ProtectedRoute>
                <ClientPortal />
              </ProtectedRoute>
            } 
          />

          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </Router>
  );
}

export default App;
