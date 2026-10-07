import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../context/useAuth";
import {
  exchangeCodeForSession,
  updateCurrentUser,
} from "../features/auth/api/authApi";
import useToast from "../shared/toast/useToast";

import styles from "./ResetPasswordPage.module.css";

const ResetPasswordPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const toast = useToast();
  const { session, loading, signOut } = useAuth();

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

        window.history.replaceState({}, document.title, "/reset-password");
        setIsPreparing(false);
        return;
      }

      if (!loading) {
        setRecoveryError(!session);
        setIsPreparing(false);
      }
    };

    prepareRecovery();

    return () => {
      active = false;
    };
  }, [loading, session]);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setValidationError("");

    if (password.length < 8) {
      setValidationError(t("auth.resetPassword.errors.tooShort"));
      return;
    }

    if (password !== passwordConfirm) {
      setValidationError(t("auth.resetPassword.errors.mismatch"));
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await updateCurrentUser({ password });
      if (error) throw error;

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

  if (recoveryError || !session) {
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
          <label className={styles.field}>
            <span>{t("auth.resetPassword.newPassword")}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          <label className={styles.field}>
            <span>{t("auth.resetPassword.confirmPassword")}</span>
            <input
              type="password"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          {validationError && (
            <p className={styles.error} role="alert">
              {validationError}
            </p>
          )}

          <button
            type="submit"
            className={styles.primaryButton}
            disabled={isSubmitting}
          >
            {isSubmitting
              ? t("common.saving")
              : t("auth.resetPassword.submit")}
          </button>
        </form>
      </section>
    </main>
  );
};

export default ResetPasswordPage;
