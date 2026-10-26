import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { getAuthenticatedUser, signOut } from "../../features/auth/api/authApi";
import {
  acceptMyGoogleInvitation,
  getMyActiveTeacherLink,
  listMyGoogleInvitations,
} from "../../features/auth/api/googleInvitationsApi";
import { getProfileById } from "../../features/profiles/api/profilesApi";
import { hasGoogleIdentity } from "../../features/auth/lib/googleOAuthPolicy";
import { GOOGLE_OAUTH_UI_ENABLED } from "../../features/auth/lib/googleOAuthConfig";
import styles from "./GoogleInvitationAcceptance.module.css";

const GoogleInvitationAcceptance = () => {
  const navigate = useNavigate();
  const { t, i18n } = useTranslation();
  const [invites, setInvites] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [busy, setBusy] = useState(true);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!GOOGLE_OAUTH_UI_ENABLED) {
      navigate("/login", { replace: true });
      return;
    }
    let active = true;
    const load = async () => {
      try {
        const { data, error: userError } = await getAuthenticatedUser();
        const user = data?.user;
        if (userError || !user || !hasGoogleIdentity(user)) throw new Error("SESSION_INVALID");
        const { data: profile, error: profileError } = await getProfileById(user.id);
        if (profileError || profile?.role !== "student" || !profile.is_active) throw new Error("PROFILE_INVALID");
        const link = await getMyActiveTeacherLink(user.id);
        if (link.error) throw link.error;
        if (link.data) {
          if (active) navigate("/student-area", { replace: true });
          return;
        }
        const result = await listMyGoogleInvitations();
        if (result.error) throw result.error;
        if (active) setInvites(result.data ?? []);
      } catch {
        if (active) setError(t("auth.google.loadError"));
      } finally {
        if (active) setBusy(false);
      }
    };
    void load();
    return () => { active = false; };
  }, [navigate, t]);

  const handleAccept = async () => {
    const chosen = invites.find((item) => item.invitation_id === selectedId);
    if (!chosen || accepting) return;
    if (!window.confirm(t("auth.google.confirmTeacher", { name: chosen.teacher_name || chosen.teacher_id }))) return;
    setAccepting(true);
    setError("");
    try {
      const { data: teacherId, error: rpcError } = await acceptMyGoogleInvitation(selectedId);
      if (rpcError || teacherId !== chosen.teacher_id) throw rpcError || new Error("UNEXPECTED_TEACHER");
      navigate("/student-area", { replace: true });
    } catch {
      setError(t("auth.google.acceptError"));
      setAccepting(false);
    }
  };

  const handleSignOut = async () => {
    try {
      const { error: signOutError } = await signOut();
      if (signOutError) throw signOutError;
      navigate("/login", { replace: true });
    } catch { setError(t("auth.google.signOutError")); }
  };

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1>{t("auth.google.invitationTitle")}</h1>
        <p>{t("auth.google.invitationDescription")}</p>
        {busy ? <p>{t("common.loading")}</p> : (
          <>
            {invites.length === 0 ? <p>{t("auth.google.noInvitations")}</p> : (
              <fieldset className={styles.choices} disabled={accepting}>
                <legend>{t("auth.google.chooseTeacher")}</legend>
                {invites.map((item) => (
                  <label className={styles.choice} key={item.invitation_id}>
                    <input
                      type="radio"
                      name="google-invitation"
                      checked={selectedId === item.invitation_id}
                      onChange={() => setSelectedId(item.invitation_id)}
                    />
                    <span>
                      <strong>{item.teacher_name || t("auth.google.unnamedTeacher")}</strong>
                      <small>{t("auth.google.expiresAt", { date: new Date(item.expires_at).toLocaleString(i18n.language) })}</small>
                    </span>
                  </label>
                ))}
              </fieldset>
            )}
            {error && <p className={styles.error} role="alert">{error}</p>}
            <button type="button" className={styles.primary} disabled={!selectedId || accepting} onClick={handleAccept}>
              {accepting ? t("auth.google.accepting") : t("auth.google.accept")}
            </button>
            <button type="button" className={styles.secondary} disabled={accepting} onClick={handleSignOut}>
              {t("auth.google.signOut")}
            </button>
          </>
        )}
      </section>
    </main>
  );
};

export default GoogleInvitationAcceptance;
