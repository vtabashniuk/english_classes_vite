import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { exchangeCodeForSession, getAuthenticatedUser } from "../../features/auth/api/authApi";
import { grantPasswordFlow } from "../../features/auth/lib/passwordFlowState";
import { getProfileById } from "../../features/profiles/api/profilesApi";

const AuthCallback = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    let active = true;
    const handleCallback = async () => {
      const code = new URLSearchParams(window.location.search).get("code");
      if (!code) {
        navigate("/login", { replace: true });
        return;
      }

      // Supabase must verify the email-link code; an existing session
      // is never sufficient to authorize the invitation password screen.
      const { error } = await exchangeCodeForSession(code);
      if (!active) return;
      if (error) {
        console.error("Auth callback error:", error);
        navigate("/login", { replace: true });
        return;
      }

      const { data: userData, error: userError } = await getAuthenticatedUser();
      const userId = userData?.user?.id;
      if (!active) return;
      if (userError || !userId) {
        navigate("/login", { replace: true });
        return;
      }
      const { data: profile, error: profileError } = await getProfileById(userId);
      if (!active) return;
      if (profileError || profile?.role !== "student") {
        navigate("/login", { replace: true });
        return;
      }

      grantPasswordFlow("invite", userId);
      navigate("/set-password", { replace: true });
    };

    handleCallback();
    return () => { active = false; };
  }, [navigate]);

  return (
    <section>
      <p>{t("auth.callback.finishing")}</p>
    </section>
  );
};

export default AuthCallback;
