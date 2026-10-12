import { useEffect, useState, useSyncExternalStore } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../context/useAuth";
import {
  exchangeCodeForSession,
  getAuthenticatedUser,
  updateCurrentUser,
} from "../../features/auth/api/authApi";
import { validateNewPassword } from "../../features/auth/lib/passwordFlowAccess";
import {
  canUsePasswordFlow,
  clearPasswordFlow,
  grantPasswordFlow,
  subscribePasswordFlow,
} from "../../features/auth/lib/passwordFlowState";
import PasswordField from "../../features/auth/components/PasswordField";
import useToast from "../../shared/toast/useToast";

import styles from "./ResetPasswordPage.module.css";

const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const toast = useToast();
  const { session, loading, signOut } = useAuth();
  const userId = session?.user?.id;
  const authorized = useSyncExternalStore(
    subscribePasswordFlow,
    () => canUsePasswordFlow("recovery", userId),
    () => false,
  );

  const [isPreparing, setIsPreparing] = useState(true);
  const [recoveryError, setRecoveryError] = useState(false);
  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [validationError, setValidationError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    let active = true;
    const prepareRecovery = async () => {
      const code = new URLSearchParams(window.location.search).get("code");
      if (code) {
        const { error } = await exchangeCodeForSession(code);
        if (!active) return;
        if (error) {
          console.error("Password recovery callback error:", error);
          setRecoveryError(true);
          setIsPreparing(false);
          return;
        }

        const { data, error: identityError } = await getAuthenticatedUser();
        if (!active) return;
        if (identityError || !data?.user?.id) {
          setRecoveryError(true);
        } else {
          grantPasswordFlow("recovery", data.user.id);
          window.history.replaceState({}, document.title, "/reset-password");
        }
        setIsPreparing(false);
        return;
      }

      // Implicit email links are verified by Supabase's PASSWORD_RECOVERY
      // event (tracked independently). Ordinary sessions get no permission.
      if (!loading) setIsPreparing(false);
    };
    prepareRecovery();
    return () => { active = false; };
  }, [loading]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setValidationError("");

    const validationKey = validateNewPassword(password, passwordConfirm);
    if (validationKey) {
      setValidationError(t(`auth.resetPassword.errors.${validationKey}`));
      return;
    }

    setIsSubmitting(true);
    try {
      const { data: identity, error: identityError } = await getAuthenticatedUser();
      if (
        identityError || !identity?.user?.id ||
        identity.user.id !== userId ||
        !canUsePasswordFlow("recovery", userId)
      ) {
        setRecoveryError(true);
        return;
      }

      const { error } = await updateCurrentUser({ password });
      if (error) throw error;

      clearPasswordFlow();
      toast.success(t("auth.resetPassword.saved"));
      await signOut();
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("Password reset error:", error);
      toast.error(t("auth.resetPassword.errors.save"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading || isPreparing) {
    return (
      <main className={styles.page}>
        <section className={styles.card}>
          <p>{t("auth.resetPassword.checking")}</p>
        </section>
      </main>
    );
  }

  if (recoveryError || !session || !authorized) {
    return (
      <main className={styles.page}>
        <section className={styles.card}>
          <h1>{t("auth.resetPassword.invalidTitle")}</h1>
          <p>{t("auth.resetPassword.invalidDescription")}</p>
          <button
            type="button"
            className={styles.primaryButton}
            onClick={() => navigate("/forgot-password")}
          >
            {t("auth.resetPassword.requestAgain")}
          </button>
        </section>
      </main>
    );
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1>{t("auth.resetPassword.title")}</h1>
        <p>{t("auth.resetPassword.description")}</p>
        <form className={styles.form} onSubmit={handleSubmit}>
          <PasswordField
            name="new-password" label={t("auth.resetPassword.newPassword")}
            value={password} onChange={setPassword}
            autoComplete="new-password" disabled={isSubmitting}
          />
          <PasswordField
            name="confirm-password" label={t("auth.resetPassword.confirmPassword")}
            value={passwordConfirm} onChange={setPasswordConfirm}
            autoComplete="new-password" disabled={isSubmitting}
          />
          {validationError && <p className={styles.error} role="alert">{validationError}</p>}
          <button type="submit" className={styles.primaryButton} disabled={isSubmitting}>
            {isSubmitting ? t("common.saving") : t("auth.resetPassword.submit")}
          </button>
        </form>
      </section>
    </main>
  );
};

export default ResetPasswordPage;
