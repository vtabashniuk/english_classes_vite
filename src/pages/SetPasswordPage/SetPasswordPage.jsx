import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";

import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";

import styles from "./SetPasswordPage.module.css";

const SetPasswordPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { session, loading } = useAuth();

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  const handleSubmit = async (event) => {
    event.preventDefault();
    setErrorMessage("");

    if (password.length < 8) {
      setErrorMessage(t("auth.setPassword.errors.tooShort"));
      return;
    }

    if (password !== passwordConfirm) {
      setErrorMessage(t("auth.setPassword.errors.mismatch"));
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.updateUser({ password });

      if (error) {
        throw error;
      }

      navigate("/student-area", { replace: true });
    } catch (error) {
      console.error("Set password error:", error);
      setErrorMessage(t("auth.setPassword.errors.save"));
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main>
        <p>{t("auth.setPassword.checkingInvite")}</p>
      </main>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1>{t("auth.setPassword.title")}</h1>
        <p>{t("auth.setPassword.description")}</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label>
            <span>{t("common.password")}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          <label>
            <span>{t("auth.setPassword.confirmPassword")}</span>
            <input
              type="password"
              value={passwordConfirm}
              onChange={(event) => setPasswordConfirm(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          {errorMessage && <p className={styles.error}>{errorMessage}</p>}

          <button type="submit" disabled={isSubmitting}>
            {isSubmitting
              ? t("common.saving")
              : t("auth.setPassword.submit")}
          </button>
        </form>
      </section>
    </main>
  );
};

export default SetPasswordPage;
