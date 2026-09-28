import { useState } from "react";
import { useTranslation } from "react-i18next";

import { TIMEZONES } from "../../constants/timezones";
import { updateCurrentUser } from "../../features/auth/api/authApi";
import { updateMyProfile } from "../../features/profiles/api/profilesApi";
import { useAuth } from "../../context/useAuth";

import styles from "./StudentProfile.module.css";

const StudentProfile = () => {
  const { t } = useTranslation();
  const { profile, refreshProfile } = useAuth();

  const [fullName, setFullName] = useState(profile?.full_name ?? "");
  const [phone, setPhone] = useState(profile?.phone ?? "");
  const [timezone, setTimezone] = useState(
    profile?.timezone ?? "Europe/Kyiv",
  );
  const [newEmail, setNewEmail] = useState(profile?.email ?? "");
  const [isSavingProfile, setIsSavingProfile] = useState(false);
  const [isSavingEmail, setIsSavingEmail] = useState(false);
  const [profileMessage, setProfileMessage] = useState("");
  const [profileError, setProfileError] = useState("");
  const [emailMessage, setEmailMessage] = useState("");
  const [emailError, setEmailError] = useState("");

  const handleProfileSubmit = async (event) => {
    event.preventDefault();
    setProfileMessage("");
    setProfileError("");
    setIsSavingProfile(true);

    try {
      const { error } = await updateMyProfile({
        fullName,
        phone,
        timezone,
      });

      if (error) throw error;

      await refreshProfile();
      setProfileMessage(t("studentProfile.saved"));
    } catch (error) {
      console.error("Profile update error:", error);
      const rawMessage = error?.message ?? "";

      setProfileError(
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
    setEmailMessage("");
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

      setEmailMessage(t("studentProfile.emailChangeSent"));
    } catch (error) {
      console.error("Email update error:", error);
      setEmailError(t("studentProfile.emailChangeError"));
    } finally {
      setIsSavingEmail(false);
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

            {profileMessage && (
              <p className={styles.success}>{profileMessage}</p>
            )}
            {profileError && <p className={styles.error}>{profileError}</p>}

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

            {emailMessage && <p className={styles.success}>{emailMessage}</p>}
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
      </div>
    </section>
  );
};

export default StudentProfile;
