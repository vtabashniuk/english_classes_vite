import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { getAuthenticatedUser, signOut } from "../../features/auth/api/authApi";
import { getProfileById } from "../../features/profiles/api/profilesApi";
import { getMyActiveTeacherLink } from "../../features/auth/api/googleInvitationsApi";
import { clearGoogleOAuthStart, hasRecentGoogleOAuthStart } from "../../features/auth/lib/googleOAuthFlow";
import { GOOGLE_OAUTH_UI_ENABLED } from "../../features/auth/lib/googleOAuthConfig";
import {
  hasGoogleIdentity,
  getGooglePostLoginRoute,
} from "../../features/auth/lib/googleOAuthPolicy";
import styles from "./GoogleAuthCallback.module.css";

const GoogleAuthCallback = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!GOOGLE_OAUTH_UI_ENABLED) {
      navigate("/login", { replace: true });
      return;
    }
    let active = true;
    const validStart = hasRecentGoogleOAuthStart();
    const params = new URLSearchParams(window.location.search);
    const providerError = params.has("error") || params.has("error_code");

    if (!validStart || providerError) {
      clearGoogleOAuthStart();
      Promise.resolve().then(() => { if (active) setError(true); });
    } else {
      (async () => {
        try {
          // Supabase JS finishes the redirect and persists the verified session.
          // getUser() verifies the identity with Supabase Auth, unlike getSession().
          const { data: identity, error: identityError } = await getAuthenticatedUser();
          const user = identity?.user;
          if (identityError || !user || !hasGoogleIdentity(user)) throw new Error("INVALID_GOOGLE_SESSION");

          const { data: profile, error: profileError } = await getProfileById(user.id);
          if (profileError || !profile?.is_active) throw new Error("INVALID_PROFILE");

          let hasTeacherLink = false;
          if (profile.role === "student") {
            const link = await getMyActiveTeacherLink(user.id);
            if (link.error) throw link.error;
            hasTeacherLink = Boolean(link.data);
          }
          const route = getGooglePostLoginRoute({ profile, hasTeacherLink });
          if (!route) throw new Error("INVALID_ROLE");
          if (active) {
            clearGoogleOAuthStart();
            navigate(route, { replace: true });
          }
        } catch {
          if (active) {
            clearGoogleOAuthStart();
            setError(true);
          }
        }
      })();
    }
    return () => { active = false; };
  }, [navigate]);

  const handleBack = async () => {
    try { await signOut(); } catch { /* returning to login remains available */ }
    navigate("/login", { replace: true });
  };

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1 className={styles.title}>{t("auth.google.callbackTitle")}</h1>
        {error ? (
          <>
            <p className={styles.message} role="alert">{t("auth.google.callbackError")}</p>
            <div className={styles.actions}>
              <button type="button" className={styles.backButton} onClick={handleBack}>
                {t("auth.forgotPassword.backToLogin")}
              </button>
            </div>
          </>
        ) : <p className={styles.message}>{t("auth.callback.finishing")}</p>}
      </section>
    </main>
  );
};

export default GoogleAuthCallback;
