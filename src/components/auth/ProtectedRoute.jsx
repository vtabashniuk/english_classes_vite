import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../../context/AuthContext";

const ProtectedRoute = ({
  children,
  allowedRoles = [],
}) => {
  const location = useLocation();
  const { session, profile, loading } = useAuth();

  if (loading) {
    return <p>Завантаження...</p>;
  }

  if (!session) {
    return (
      <Navigate
        to="/login"
        replace
        state={{ from: location }}
      />
    );
  }

  if (!profile) {
    return <p>Профіль користувача не знайдено.</p>;
  }

  if (!profile.is_active) {
    return <p>Обліковий запис деактивовано.</p>;
  }

  if (
    allowedRoles.length > 0 &&
    !allowedRoles.includes(profile.role)
  ) {
    const dashboardPath =
      profile.role === "teacher"
        ? "/teacher-dashboard"
        : "/student-area";

    return <Navigate to={dashboardPath} replace />;
  }

  return children;
};

export default ProtectedRoute;