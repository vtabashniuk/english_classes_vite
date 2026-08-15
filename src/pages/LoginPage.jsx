import { useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";
import styles from "./LoginPage.module.css";

function getDashboardPath(role) {
  return role === "teacher" ? "/teacher-dashboard" : "/student-area";
}

export default function LoginPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { session, profile, loading } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  if (loading) {
    return <div className={styles.status}>Перевірка авторизації…</div>;
  }

  if (session && profile) {
    return <Navigate to={getDashboardPath(profile.role)} replace />;
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setSubmitting(true);
    setErrorMessage("");

    const { data, error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (error) {
      setErrorMessage("Неправильний email або пароль.");
      setSubmitting(false);
      return;
    }

    const { data: profileData, error: profileError } = await supabase
      .from("profiles")
      .select("role, is_active")
      .eq("id", data.user.id)
      .single();

    if (profileError) {
      await supabase.auth.signOut();
      setErrorMessage("Не вдалося завантажити профіль користувача.");
      setSubmitting(false);
      return;
    }

    if (!profileData.is_active) {
      await supabase.auth.signOut();
      setErrorMessage("Обліковий запис деактивовано.");
      setSubmitting(false);
      return;
    }

    const requestedPath = location.state?.from?.pathname;
    const allowedDashboard = getDashboardPath(profileData.role);

    navigate(requestedPath || allowedDashboard, {
      replace: true,
    });
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1>Вхід до кабінету</h1>

        <p className={styles.description}>
          Введіть email і пароль, надані викладачем.
        </p>

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

          <button type="submit" disabled={submitting}>
            {submitting ? "Вхід…" : "Увійти"}
          </button>
        </form>
      </section>
    </main>
  );
}