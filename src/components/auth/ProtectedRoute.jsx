import { useTranslation } from "react-i18next";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../../context/AuthContext";

const ProtectedRoute = ({
  children,
  allowedRoles = [],
}) => {
  const { t } = useTranslation();
  const location = useLocation();
  const { session, profile, loading } = useAuth();

  if (loading) {
    return <p>{t("common.loading")}</p>;
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
    return <p>{t("auth.protectedRoute.profileNotFound")}</p>;
  }

  if (!profile.is_active) {
    return <p>{t("auth.protectedRoute.accountInactive")}</p>;
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
