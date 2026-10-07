import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { requestPasswordReset } from "../features/auth/api/authApi";
import useToast from "../shared/toast/useToast";

import styles from "./ForgotPasswordPage.module.css";

const ForgotPasswordPage = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const toast = useToast();

  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [requestSent, setRequestSent] = useState(false);

  const handleSubmit = async (event) => {
    event.preventDefault();
    setIsSubmitting(true);

    try {
      const appUrl = import.meta.env.VITE_APP_URL;

      if (!appUrl) {
        throw new Error("VITE_APP_URL is not configured");
      }

      const redirectTo = `${appUrl}/reset-password`;

      const { error } = await requestPasswordReset({
        email: email.trim().toLowerCase(),
        redirectTo,
      });

      if (error) throw error;

      setRequestSent(true);
      toast.success(t("auth.forgotPassword.sent"));
    } catch (error) {
      console.error("Password recovery request error:", error);
      toast.error(t("auth.forgotPassword.error"));
    } finally {
      setIsSubmitting(false);
    }
  };
  
  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <div className={styles.heading}>
          <span className={styles.eyebrow}>English with Olga</span>
          <h1>{t("auth.forgotPassword.title")}</h1>
          <p>{t("auth.forgotPassword.description")}</p>
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

          <button
            type="submit"
            className={styles.submitButton}
            disabled={isSubmitting}
          >
            {isSubmitting
              ? t("auth.forgotPassword.sending")
              : requestSent
                ? t("auth.forgotPassword.sendAgain")
                : t("auth.forgotPassword.submit")}
          </button>
        </form>

        {requestSent && (
          <p className={styles.helper}>{t("auth.forgotPassword.checkInbox")}</p>
        )}

        <button
          type="button"
          className={styles.backButton}
          onClick={() => navigate("/login")}
        >
          {t("auth.forgotPassword.backToLogin")}
        </button>
      </section>
    </main>
  );
};

export default ForgotPasswordPage;
