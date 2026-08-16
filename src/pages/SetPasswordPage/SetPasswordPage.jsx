import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../context/AuthContext";

import { supabase } from "../../lib/supabase";

import styles from "./SetPasswordPage.module.css";

const SetPasswordPage = () => {
  const navigate = useNavigate();

  const [password, setPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const { session, loading } = useAuth();

  const handleSubmit = async (event) => {
    event.preventDefault();

    setErrorMessage("");

    if (password.length < 8) {
      setErrorMessage("Пароль має містити щонайменше 8 символів.");
      return;
    }

    if (password !== passwordConfirm) {
      setErrorMessage("Паролі не співпадають.");
      return;
    }

    setIsSubmitting(true);

    try {
      const { error } = await supabase.auth.updateUser({
        password,
      });

      if (error) {
        throw error;
      }

      navigate("/student-area", {
        replace: true,
      });
    } catch (error) {
      console.error("Помилка встановлення пароля:", error);

      setErrorMessage(
        error instanceof Error
          ? error.message
          : "Не вдалося встановити пароль.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (loading) {
    return (
      <main>
        <p>Перевірка запрошення...</p>
      </main>
    );
  }

  if (!session) {
    return <Navigate to="/login" replace />;
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <h1>Створіть пароль</h1>

        <p>Встановіть пароль для входу до особистого кабінету.</p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <label>
            <span>Пароль</span>

            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="new-password"
              required
            />
          </label>

          <label>
            <span>Повторіть пароль</span>

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
            {isSubmitting ? "Збереження..." : "Встановити пароль"}
          </button>
        </form>
      </section>
    </main>
  );
};

export default SetPasswordPage;
