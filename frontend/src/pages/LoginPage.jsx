import { useState, useEffect } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Satellite, TreePine, BarChart3 } from 'lucide-react';

const features = [
  { icon: <Satellite size={14} />, text: 'Drone Photogrammetry' },
  { icon: <TreePine size={14} />, text: 'AI Tree Detection' },
  { icon: <BarChart3 size={14} />, text: 'GIS Health Analytics' },
];

export default function LoginPage() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const { login, user } = useAuth();
  const navigate = useNavigate();

  // Navigate only after the user state has been committed to React.
  // Calling navigate() immediately after login() can race with setUser(), so
  // we let the effect fire once user is actually set.
  useEffect(() => {
    if (user) {
      const role = user.role?.toUpperCase();
      navigate(['ADMIN', 'SUB_ADMIN'].includes(role) ? '/admin' : '/', { replace: true });
    }
  }, [user]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(username, password);
      // Navigation is handled by the useEffect above once user state commits.
    } catch (err) {
      setError(err.response?.data?.detail || 'Invalid username or password');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">
      {/* Left Hero Panel (desktop only) */}
      <div className="hidden lg:flex flex-col justify-between w-3/5 relative overflow-hidden bg-cover bg-center p-12"
           style={{ backgroundImage: "url('/hero-bg.png')" }}>
        
        {/* Dark gradient overlay for text readability */}
        <div className="absolute inset-0 bg-gradient-to-br from-black/80 via-black/40 to-transparent z-0" />

        {/* Logo placeholder top-left */}
        <div className="relative z-10 w-full mb-8">
          <div className="flex items-center gap-3">
             <div className="p-2 rounded-xl bg-white/10 backdrop-blur-md border border-white/20 shadow-glass">
               <img src="/logo2.png" alt="Lansub Logo" className="h-10 w-auto object-contain drop-shadow-md" />
             </div>
             <span className="text-white font-heading font-bold text-2xl drop-shadow-md tracking-tight">Lansub</span>
          </div>
        </div>

        {/* Hero content center */}
        <div className="relative z-10 space-y-6">
          <h1 className="text-white font-heading font-black text-4xl xl:text-5xl leading-tight">
            Geographic<br />Information<br />System
          </h1>
          <p className="text-white/70 text-base leading-relaxed max-w-xs">
            AI-powered drone analytics for plantation health monitoring, tree detection, and canopy management.
          </p>
          <div className="flex flex-wrap gap-2">
            {features.map((f, i) => (
              <span key={i}
                className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-medium
                           bg-white/15 backdrop-blur-sm border border-white/25 text-white">
                {f.icon} {f.text}
              </span>
            ))}
          </div>
        </div>
        {/* Bottom credit */}
        <div className="relative z-10">
          <p className="text-white/40 text-xs">Powered by Lansub Technologies</p>
        </div>
      </div>

      {/* Right Form Panel */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 bg-white relative overflow-hidden">
        {/* Background blobs */}
        <div className="blob-container">
          <div className="blob blob-green" />
          <div className="blob blob-teal" />
        </div>

        <div className="relative z-10 w-full max-w-md space-y-8 animate-fade-in">
          {/* Logo (mobile only) */}
          <div className="lg:hidden flex items-center gap-2.5">
            <div className="p-1.5 rounded-lg bg-primary-50/80 backdrop-blur-md border border-primary-100 shadow-sm">
               <img src="/logo1.png" alt="Lansub Logo" className="h-8 w-auto object-contain" />
            </div>
            <span className="font-heading font-bold text-slate-800 text-xl tracking-tight">Lansub</span>
          </div>

          {/* Card */}
          <div className="bg-white/70 backdrop-blur-2xl border border-white/90 rounded-2xl shadow-glass p-8">
            <div className="mb-8">
              <h2 className="font-heading font-bold text-slate-800 text-2xl mb-1">Welcome back</h2>
              <p className="text-slate-500 text-sm">Sign in to your account to continue</p>
            </div>

            {error && (
              <div className="mb-5 flex items-center gap-2.5 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-red-600 text-sm animate-fade-in">
                <span className="w-1.5 h-1.5 rounded-full bg-red-500 shrink-0" />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Username</label>
                <input
                  type="text"
                  className="glass-input"
                  placeholder="Enter your username"
                  value={username}
                  onChange={e => setUsername(e.target.value)}
                  required
                  autoFocus
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                <div className="password-field-container">
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="glass-input pr-12"
                    placeholder="Enter your password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() => setShowPassword(!showPassword)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                className="btn-primary btn-lg w-full justify-center mt-2"
                disabled={loading}
              >
                {loading ? (
                  <span className="flex items-center gap-2">
                    <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    Signing in…
                  </span>
                ) : 'Sign In'}
              </button>
            </form>
          </div>

          <p className="text-center text-xs text-slate-400">
            Powered by <span className="font-medium text-slate-500">Lansub Technologies</span>
          </p>
        </div>
      </div>
    </div>
  );
}
