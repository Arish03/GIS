import { Navigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const STAFF_ROLES = ['ADMIN', 'SUB_ADMIN'];

export default function ProtectedRoute({ children, requiredRole }) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="loading-spinner">
        <div className="spinner" />
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const role = user.role?.toUpperCase();

  if (requiredRole) {
    if (requiredRole === 'staff') {
      // Allow ADMIN or SUB_ADMIN
      if (!STAFF_ROLES.includes(role)) {
        return <Navigate to="/" replace />;
      }
    } else if (role !== requiredRole.toUpperCase()) {
      return <Navigate to="/" replace />;
    }
  }

  return children;
}
