import { useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";

import { useAuth } from "../../context/useAuth";
import {
  getAuthenticatedUser,
  updateCurrentUser,
} from "../../features/auth/api/authApi";
import PasswordField from "../../features/auth/components/PasswordField";
import { validateNewPassword } from "../../features/auth/lib/passwordFlowAccess";
import {
  canUsePasswordFlow,
  clearPasswordFlow,
  subscribePasswordFlow,
} from "../../features/auth/lib/passwordFlowState";

import styles from "./SetPasswordPage.module.css";

const SetPasswordPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { session, profile, loading } = useAuth();
  const userId = session?.user?.id;
  const authorized = useSyncExternalStore(
    subscribePasswordFlow,
    () => canUsePasswordFlow("invite", userId),
    () => false,
  );

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage("");

    const validationKey = validateNewPassword(password, passwordConfirm);
    if (validationKey) {
      setErrorMessage(t(`auth.setPassword.errors.${validationKey}`));
      return;
    }
    setIsSubmitting(true);
    try {
      const { data: identity, error: identityError } = await getAuthenticatedUser();
      if (
        identityError || !identity?.user?.id ||
        identity.user.id !== userId ||
        profile?.role !== "student" ||
        !canUsePasswordFlow("invite", userId)
      ) {
        setErrorMessage(t("auth.setPassword.invalidDescription"));
        return;
      }
      const { error } = await updateCurrentUser({ password });
      if (error) throw error;

      clearPasswordFlow();
      navigate("/student-area", { replace: true });
    } catch (error) {
      console.error("Set password error:", error);
      setErrorMessage(t("auth.setPassword.errors.save"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return <main><p>{t("auth.setPassword.checkingInvite")}</p></main>;
  }
  if (!session) return <Navigate to="/login" replace />;
  if (!authorized || profile?.role !== "student") {
    return (
      <main className={styles.page}>
        <section className={styles.card}>
          <h1>{t("auth.setPassword.invalidTitle")}</h1>
          <p>{t("auth.setPassword.invalidDescription")}</p>
          <button type="button" onClick={() => navigate("/login", { replace: true })}>
            {t("auth.forgotPassword.backToLogin")}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1>{t("auth.setPassword.title")}</h1>
        <p>{t("auth.setPassword.description")}</p>
        <form className={styles.form} onSubmit={handleSubmit}>
          <PasswordField
            name="new-password" label={t("common.password")}
            value={password} onChange={setPassword}
            autoComplete="new-password" disabled={isSubmitting}
          />
          <PasswordField
            name="confirm-password" label={t("auth.setPassword.confirmPassword")}
            value={passwordConfirm} onChange={setPasswordConfirm}
            autoComplete="new-password" disabled={isSubmitting}
          />
          {errorMessage && <p className={styles.error} role="alert">{errorMessage}</p>}
          <button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t("common.saving") : t("auth.setPassword.submit")}
          </button>
        </form>
      </section>
    </main>
  );
};

export default SetPasswordPage;
