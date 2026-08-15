import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";

import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";

import styles from "./LoginPage.module.css";

const LoginPage = () => {
  const navigate = useNavigate();
  const { session, profile, loading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (loading) {
    return (
      <main className={styles.page}>
        <p>Перевірка авторизації...</p>
      </main>
    );
  }

  if (session && profile) {
    const dashboardPath =
      profile.role === "teacher"
        ? "/teacher-dashboard"
        : "/student-area";

    return <Navigate to={dashboardPath} replace />;
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
      setErrorMessage("Неправильний email або пароль.");
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
      setErrorMessage("Не вдалося завантажити профіль.");
      setIsSubmitting(false);
      return;
    }

    if (!profileData.is_active) {
      await supabase.auth.signOut();
      setErrorMessage("Обліковий запис деактивовано.");
      setIsSubmitting(false);
      return;
    }

    const dashboardPath =
      profileData.role === "teacher"
        ? "/teacher-dashboard"
        : "/student-area";

    navigate(dashboardPath, { replace: true });
  };

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>English with Olga</span>
          <h1>Вхід до особистого кабінету</h1>
          <p>
            Увійдіть, щоб переглянути розклад, матеріали та інформацію
            про заняття.
          </p>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label className={styles.field}>
            <span>Email</span>
            <input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              autoComplete="email"
              required
            />
          </label>

          <label className={styles.field}>
            <span>Пароль</span>
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
            {isSubmitting ? "Вхід..." : "Увійти"}
          </button>
        </form>

        <button
          type="button"
          className={styles.backButton}
          onClick={() => navigate("/")}
        >
          Повернутися на головну
        </button>
      </section>
    </main>
  );
};

export default LoginPage;