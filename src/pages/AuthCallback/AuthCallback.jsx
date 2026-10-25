import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { getAuthenticatedUser } from "../../features/auth/api/authApi";
import { canUsePasswordFlow, clearPasswordFlow } from "../../features/auth/lib/passwordFlowState";
import { getProfileById } from "../../features/profiles/api/profilesApi";

// Supabase admin inviteUserByEmail uses a verified implicit invite callback.
// An arbitrary PKCE `?code=` cannot prove it was issued for an invitation:
// NEVER exchange it here and NEVER mint a password-flow grant from it.
const AuthCallback = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();

  useEffect(() => {
    let active = true;
    const finish = async () => {
      if (new URLSearchParams(window.location.search).has("code")) {
        clearPasswordFlow();
        if (active) navigate("/login", { replace: true });
        return;
      }
      // The Supabase SDK must have verified the implicit invite tokens and
      // emitted the matching SIGNED_IN event (passwordFlowState.js).
      const { data, error } = await getAuthenticatedUser();
      const userId = data?.user?.id;
      if (!active) return;
      if (error || !userId || !canUsePasswordFlow("invite", userId)) {
        clearPasswordFlow();
        navigate("/login", { replace: true });
        return;
      }
      const { data: profile, error: profileError } = await getProfileById(userId);
      if (!active) return;
      if (profileError || profile?.role !== "student") {
        clearPasswordFlow();
        navigate("/login", { replace: true });
      } else {
        navigate("/set-password", { replace: true });
      }
    };
    void finish();
    return () => { active = false; };
  }, [navigate]);

  return <section><p>{t("auth.callback.finishing")}</p></section>;
};

export default AuthCallback;
