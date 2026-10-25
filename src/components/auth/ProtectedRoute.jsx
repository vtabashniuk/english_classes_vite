import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useLocation } from "react-router-dom";

import { useAuth } from "../../context/useAuth";
import { getAuthenticatedUser } from "../../features/auth/api/authApi";
import { getMyActiveTeacherLink } from "../../features/auth/api/googleInvitationsApi";
import { needsGoogleInvitationConsent } from "../../features/auth/lib/googleOAuthPolicy";

const ProtectedRoute = ({ children, allowedRoles = [] }) => {
  const { t } = useTranslation();
  const location = useLocation();
  const { session, profile, loading } = useAuth();
  const sessionUserId = session?.user?.id ?? null;
  const mustCheckStudent = Boolean(
    sessionUserId && profile?.id === sessionUserId &&
    profile?.is_active && profile.role === "student" &&
    (allowedRoles.length === 0 || allowedRoles.includes("student")),
  );
  const [studentGate, setStudentGate] = useState(null);

  useEffect(() => {
    if (!mustCheckStudent) return;
    let active = true;
    const userId = sessionUserId;
    (async () => {
      try {
        const { data, error } = await getAuthenticatedUser();
        const user = data?.user;
        if (error || !user || user.id !== userId) throw new Error("AUTH_CHANGED");
        const { data: link, error: linkError } = await getMyActiveTeacherLink(userId);
        if (linkError) throw linkError;
        if (active) setStudentGate({
          userId,
          needsConsent: needsGoogleInvitationConsent({
            user, profile, hasTeacherLink: Boolean(link),
          }),
        });
      } catch {
        if (active) setStudentGate({ userId, error: true });
      }
    })();
    return () => { active = false; };
  }, [mustCheckStudent, sessionUserId, profile]);

  if (loading) return <p>{t("common.loading")}</p>;
  if (!session) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  // A profile still loading or belonging to a previous Auth session is NOT
  // acceptable for any protected route, even if its role would match.
  if (!profile || profile.id !== sessionUserId) {
    return <p>{t("auth.protectedRoute.profileNotFound")}</p>;
  }
  if (!profile.is_active) {
    return <p>{t("auth.protectedRoute.accountInactive")}</p>;
  }
  if (allowedRoles.length > 0 && !allowedRoles.includes(profile.role)) {
    return <Navigate to={profile.role === "teacher"
      ? "/teacher-dashboard" : "/student-area"} replace />;
  }
  if (mustCheckStudent) {
    if (!studentGate || studentGate.userId !== sessionUserId) {
      return <p>{t("common.loading")}</p>;
    }
    if (studentGate.error) {
      return <p role="alert">{t("auth.google.loadError")}</p>;
    }
    if (studentGate.needsConsent) {
      return <Navigate to="/google/accept-invitation" replace />;
    }
  }
  return children;
};

export default ProtectedRoute;
