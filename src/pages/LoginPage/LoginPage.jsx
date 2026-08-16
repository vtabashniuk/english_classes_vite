import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Navigate, useNavigate } from "react-router-dom";

import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";

import styles from "./LoginPage.module.css";

const getDashboardPath = (role) =>
  role === "teacher" ? "/teacher-dashboard" : "/student-area";

const LoginPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { session, profile, loading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (loading) {
    return (
      <main className={styles.page}>
        <p>{t("auth.login.checking")}</p>
      </main>
    );
  }

  if (session && profile) {
    return <Navigate to={getDashboardPath(profile.role)} replace />;
  }

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);
    setErrorMessage("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setErrorMessage(t("auth.login.errors.invalidCredentials"));
      setIsSubmitting(false);
      return;
    }

    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("role, is_active")
      .eq("id", data.user.id)
      .single();

    if (profileError) {
      await supabase.auth.signOut();
      setErrorMessage(t("auth.login.errors.profileLoad"));
      setIsSubmitting(false);
      return;
    }

    if (!profileData.is_active) {
      await supabase.auth.signOut();
      setErrorMessage(t("auth.login.errors.inactive"));
      setIsSubmitting(false);
      return;
    }

    navigate(getDashboardPath(profileData.role), { replace: true });
  };

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>English with Olga</span>
          <h1>{t("auth.login.title")}</h1>
          <p>{t("auth.login.description")}</p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>{t("common.email")}</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className={styles.field}>
            <span>{t("common.password")}</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
            />
          </label>

          {errorMessage && (
            <div className={styles.error} role="alert">
              {errorMessage}
            </div>
          )}

          <button
            type="submit"
            className={styles.submitButton}
            disabled={isSubmitting}
          >
            {isSubmitting ? t("auth.login.signingIn") : t("auth.login.signIn")}
          </button>
        </form>

        <button
          type="button"
          className={styles.backButton}
          onClick={() => navigate("/")}
        >
          {t("common.backHome")}
        </button>
      </section>
    </main>
  );
};

export default LoginPage;
