import { createContext, useContext, useState, useCallback } from 'react';
import api from '../api/client';

const AuthContext = createContext(null);

function loadUserFromStorage() {
  try {
    const token = localStorage.getItem('token');
    const storedUser = localStorage.getItem('user');
    if (token && storedUser) return JSON.parse(storedUser);
  } catch {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  }
  return null;
}

export function AuthProvider({ children }) {
  // Initialise synchronously so ProtectedRoute never sees user=null while a
  // valid session exists, eliminating the navigate()-vs-setUser race condition.
  const [user, setUser] = useState(loadUserFromStorage);
  const loading = false; // no async init step needed anymore

  const login = useCallback(async (username, password) => {
    const res = await api.post('/auth/login', { username, password });
    const { access_token } = res.data;
    localStorage.setItem('token', access_token);

    // Fetch user info
    const meRes = await api.get('/auth/me');
    const userData = meRes.data;
    localStorage.setItem('user', JSON.stringify(userData));
    setUser(userData);
    return userData;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    setUser(null);
  }, []);

  const role = user?.role?.toUpperCase();
  const isAdmin = role === 'ADMIN';
  const isStaff = role === 'ADMIN' || role === 'SUB_ADMIN';

  return (
    <AuthContext.Provider value={{ user, login, logout, loading, isAdmin, isStaff }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
