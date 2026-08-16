import { useEffect, useState } from "react";

import { supabase } from "../../lib/supabase";
import { useAuth } from "../../context/AuthContext";

import styles from "./StudentProfile.module.css";

const StudentProfile = () => {
  const { profile, refreshProfile } = useAuth();

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");

  const [newEmail, setNewEmail] = useState("");

  const [isSavingProfile, setIsSavingProfile] = useState(false);

  const [isSavingEmail, setIsSavingEmail] = useState(false);

  const [profileMessage, setProfileMessage] = useState("");

  const [profileError, setProfileError] = useState("");

  const [emailMessage, setEmailMessage] = useState("");

  const [emailError, setEmailError] = useState("");

  useEffect(() => {
    if (!profile) {
      return;
    }

    setFullName(profile.full_name ?? "");
    setPhone(profile.phone ?? "");
    setNewEmail(profile.email ?? "");
  }, [profile]);

  const handleProfileSubmit = async (event) => {
    event.preventDefault();

    setProfileMessage("");
    setProfileError("");
    setIsSavingProfile(true);

    try {
      const { error } = await supabase.rpc("update_my_profile", {
        new_full_name: fullName,
        new_phone: phone,
      });

      if (error) {
        throw error;
      }

      await refreshProfile();

      setProfileMessage("Контактні дані успішно збережено.");
    } catch (error) {
      console.error("Помилка оновлення профілю:", error);

      setProfileError(
        error instanceof Error ? error.message : "Не вдалося зберегти профіль.",
      );
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleEmailSubmit = async (event) => {
    event.preventDefault();

    setEmailMessage("");
    setEmailError("");

    const normalizedEmail = newEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      setEmailError("Вкажіть новий email.");
      return;
    }

    if (normalizedEmail === profile?.email?.toLowerCase()) {
      setEmailError("Це вже ваш поточний email.");
      return;
    }

    setIsSavingEmail(true);

    try {
      const { error } = await supabase.auth.updateUser({
        email: normalizedEmail,
      });

      if (error) {
        throw error;
      }

      setEmailMessage(
        "Запит на зміну email надіслано. Перевірте пошту для підтвердження.",
      );
    } catch (error) {
      console.error("Помилка зміни email:", error);

      setEmailError(
        error instanceof Error ? error.message : "Не вдалося змінити email.",
      );
    } finally {
      setIsSavingEmail(false);
    }
  };

  return (
    <section className={styles.page}>
      <div className={styles.heading}>
        <h1>Профіль</h1>

        <p>Керуйте контактною інформацією та email для входу.</p>
      </div>

      <div className={styles.grid}>
        <article className={styles.card}>
          <h2>Контактні дані</h2>

          <form className={styles.form} onSubmit={handleProfileSubmit}>
            <label className={styles.field}>
              <span>Ім’я</span>

              <input
                type="text"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
              />
            </label>

            <label className={styles.field}>
              <span>Телефон</span>

              <input
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+380..."
                autoComplete="tel"
              />
            </label>

            {profileMessage && (
              <p className={styles.success}>{profileMessage}</p>
            )}

            {profileError && <p className={styles.error}>{profileError}</p>}

            <button
              type="submit"
              className={styles.primaryButton}
              disabled={isSavingProfile}
            >
              {isSavingProfile ? "Збереження..." : "Зберегти"}
            </button>
          </form>
        </article>

        <article className={styles.card}>
          <h2>Email для входу</h2>

          <p className={styles.helper}>
            Поточний email:
            <strong> {profile?.email}</strong>
          </p>

          <form className={styles.form} onSubmit={handleEmailSubmit}>
            <label className={styles.field}>
              <span>Новий email</span>

              <input
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>

            {emailMessage && <p className={styles.success}>{emailMessage}</p>}

            {emailError && <p className={styles.error}>{emailError}</p>}

            <button
              type="submit"
              className={styles.secondaryButton}
              disabled={isSavingEmail}
            >
              {isSavingEmail ? "Надсилання..." : "Змінити email"}
            </button>
          </form>
        </article>
      </div>
    </section>
  );
};

export default StudentProfile;
