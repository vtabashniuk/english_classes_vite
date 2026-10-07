import { useState } from "react";
import { useTranslation } from "react-i18next";

import { TIMEZONES } from "../../constants/timezones";
import { updateCurrentUser } from "../../features/auth/api/authApi";
import { updateMyProfile } from "../../features/profiles/api/profilesApi";
import { useAuth } from "../../context/useAuth";
import useToast from "../../shared/toast/useToast";

import styles from "./StudentProfile.module.css";

const StudentProfile = () => {
  const { t } = useTranslation();
  const { profile, refreshProfile } = useAuth();
  const toast = useToast();

  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [timezone, setTimezone] = useState(
    profile?.timezone ?? "Europe/Kyiv",
  );
  const [newEmail, setNewEmail] = useState(profile?.email ?? "");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [emailError, setEmailError] = useState("");

  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [passwordError, setPasswordError] = useState("");

  const handleProfileSubmit = async (event) => {
    event.preventDefault();
    setIsSavingProfile(true);

    try {
      const { error } = await updateMyProfile({
        fullName,
        phone,
        timezone,
      });

      if (error) throw error;

      await refreshProfile();
      toast.success(t("studentProfile.saved"));
    } catch (error) {
      console.error("Profile update error:", error);
      const rawMessage = error?.message ?? "";

      toast.error(
        rawMessage.includes("INVALID_TIMEZONE")
          ? t("studentProfile.invalidTimezone")
          : t("studentProfile.profileSaveError"),
      );
    } finally {
      setIsSavingProfile(false);
    }
  };

  const handleEmailSubmit = async (event) => {
    event.preventDefault();
    setEmailError("");

    const normalizedEmail = newEmail.trim().toLowerCase();

    if (!normalizedEmail) {
      setEmailError(t("studentProfile.emailRequired"));
      return;
    }

    if (normalizedEmail === profile?.email?.toLowerCase()) {
      setEmailError(t("studentProfile.sameEmail"));
      return;
    }

    setIsSavingEmail(true);

    try {
      const { error } = await updateCurrentUser({
        email: normalizedEmail,
      });

      if (error) throw error;

      toast.success(t("studentProfile.emailChangeSent"));
    } catch (error) {
      console.error("Email update error:", error);
      toast.error(t("studentProfile.emailChangeError"));
    } finally {
      setIsSavingEmail(false);
    }
  };

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();
    setPasswordError("");

    if (!currentPassword) {
      setPasswordError(t("studentProfile.password.currentRequired"));
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError(t("studentProfile.password.tooShort"));
      return;
    }

    if (newPassword !== passwordConfirm) {
      setPasswordError(t("studentProfile.password.mismatch"));
      return;
    }

    if (currentPassword === newPassword) {
      setPasswordError(t("studentProfile.password.samePassword"));
      return;
    }

    setIsSavingPassword(true);

    try {
      const { error } = await updateCurrentUser({
        password: newPassword,
        current_password: currentPassword,
      });

      if (error) throw error;

      setCurrentPassword("");
      setNewPassword("");
      setPasswordConfirm("");
      toast.success(t("studentProfile.password.saved"));
    } catch (error) {
      console.error("Password update error:", error);
      const message = (error?.message ?? "").toLowerCase();

      toast.error(
        message.includes("current password") ||
          message.includes("invalid password") ||
          message.includes("password is incorrect")
          ? t("studentProfile.password.currentIncorrect")
          : t("studentProfile.password.saveError"),
      );
    } finally {
      setIsSavingPassword(false);
    }
  };

  return (
    <section className={styles.page}>
      <div className={styles.heading}>
        <h1>{t("studentProfile.title")}</h1>
        <p>{t("studentProfile.description")}</p>
      </div>

      <div className={styles.grid}>
        <article className={styles.card}>
          <h2>{t("studentProfile.contactInfo")}</h2>

          <form className={styles.form} onSubmit={handleProfileSubmit}>
            <label className={styles.field}>
              <span>{t("studentProfile.name")}</span>
              <input
                type="text"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                autoComplete="name"
              />
            </label>

            <label className={styles.field}>
              <span>{t("studentProfile.phone")}</span>
              <input
                type="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
                placeholder="+380..."
                autoComplete="tel"
              />
            </label>

            <label className={styles.field}>
              <span>{t("studentProfile.timezone")}</span>
              <select
                value={timezone}
                onChange={(event) => setTimezone(event.target.value)}
              >
                {TIMEZONES.map((item) => (
                  <option key={item.value} value={item.value}>
                    {t(item.labelKey)}
                  </option>
                ))}
              </select>
            </label>

            <p className={styles.helper}>{t("studentProfile.timezoneHelp")}</p>

            <button
              type="submit"
              className={styles.primaryButton}
              disabled={isSavingProfile}
            >
              {isSavingProfile
                ? t("studentProfile.saving")
                : t("studentProfile.save")}
            </button>
          </form>
        </article>

        <article className={styles.card}>
          <h2>{t("studentProfile.emailTitle")}</h2>

          <p className={styles.helper}>
            {t("studentProfile.currentEmail")}: <strong>{profile?.email}</strong>
          </p>

          <form className={styles.form} onSubmit={handleEmailSubmit}>
            <label className={styles.field}>
              <span>{t("studentProfile.newEmail")}</span>
              <input
                type="email"
                value={newEmail}
                onChange={(event) => setNewEmail(event.target.value)}
                autoComplete="email"
                required
              />
            </label>

            {emailError && <p className={styles.error}>{emailError}</p>}

            <button
              type="submit"
              className={styles.secondaryButton}
              disabled={isSavingEmail}
            >
              {isSavingEmail
                ? t("studentProfile.sending")
                : t("studentProfile.changeEmail")}
            </button>
          </form>
        </article>

        <article className={styles.card}>
          <h2>{t("studentProfile.password.title")}</h2>
          <p className={styles.helper}>
            {t("studentProfile.password.description")}
          </p>

          <form className={styles.form} onSubmit={handlePasswordSubmit}>
            <label className={styles.field}>
              <span>{t("studentProfile.password.current")}</span>
              <input
                type="password"
                value={currentPassword}
                onChange={(event) => setCurrentPassword(event.target.value)}
                autoComplete="current-password"
                required
              />
            </label>

            <label className={styles.field}>
              <span>{t("studentProfile.password.new")}</span>
              <input
                type="password"
                value={newPassword}
                onChange={(event) => setNewPassword(event.target.value)}
                autoComplete="new-password"
                required
              />
            </label>

            <label className={styles.field}>
              <span>{t("studentProfile.password.confirm")}</span>
              <input
                type="password"
                value={passwordConfirm}
                onChange={(event) => setPasswordConfirm(event.target.value)}
                autoComplete="new-password"
                required
              />
            </label>

            {passwordError && <p className={styles.error}>{passwordError}</p>}

            <button
              type="submit"
              className={styles.secondaryButton}
              disabled={isSavingPassword}
            >
              {isSavingPassword
                ? t("studentProfile.password.saving")
                : t("studentProfile.password.submit")}
            </button>
          </form>
        </article>
      </div>
    </section>
  );
};

export default StudentProfile;
