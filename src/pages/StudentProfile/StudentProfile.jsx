import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { TIMEZONES } from "../../constants/timezones";
import { updateCurrentUser } from "../../features/auth/api/authApi";
import { updateMyProfile } from "../../features/profiles/api/profilesApi";
import {
  applyStudentLearningPause,
  getMyStudentLifecycle,
  resumeStudentLearningPause,
} from "../../features/studentLifecycle/api/studentLifecycleApi";
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

  const [learningLifecycle, setLearningLifecycle] = useState(null);
  const [pauseLoading, setPauseLoading] = useState(true);
  const [pauseSaving, setPauseSaving] = useState(false);
  const [pauseError, setPauseError] = useState("");
  const [pauseFrom, setPauseFrom] = useState(getLocalDateString());
  const [pauseUntil, setPauseUntil] = useState(() =>
    getDateDaysFrom(getLocalDateString(), 6),
  );

  useEffect(() => {
    let cancelled = false;

    const loadLifecycle = async () => {
      try {
        setPauseLoading(true);
        const { data, error } = await getMyStudentLifecycle();
        if (error) throw error;
        if (!cancelled) setLearningLifecycle(data);
      } catch (error) {
        console.error("Student lifecycle load error:", error);
        if (!cancelled) setPauseError(t("studentProfile.learningPause.errors.load"));
      } finally {
        if (!cancelled) setPauseLoading(false);
      }
    };

    loadLifecycle();
    return () => {
      cancelled = true;
    };
  }, [t]);

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

  const handlePauseResume = async () => {
    setPauseError("");
    const wasActivePause = Boolean(learningLifecycle?.pause_is_active);

    try {
      setPauseSaving(true);
      const { data, error } = await resumeStudentLearningPause();
      if (error) throw error;

      setLearningLifecycle(data);
      setPauseFrom(getLocalDateString());
      setPauseUntil(getDateDaysFrom(getLocalDateString(), 6));
      window.dispatchEvent(new Event("notifications-changed"));
      toast.success(
        t(
          wasActivePause
            ? "studentProfile.learningPause.resumed"
            : "studentProfile.learningPause.scheduledCancelled",
        ),
      );
    } catch (error) {
      console.error("Student pause resume error:", error);
      toast.error(t("studentProfile.learningPause.errors.resume"));
    } finally {
      setPauseSaving(false);
    }
  };

  const handlePauseSubmit = async (event) => {
    event.preventDefault();
    setPauseError("");

    if (!pauseFrom || !pauseUntil) {
      setPauseError(t("studentProfile.learningPause.errors.required"));
      return;
    }

    try {
      setPauseSaving(true);
      const { data, error } = await applyStudentLearningPause({
        pauseFrom,
        pauseUntil,
      });
      if (error) throw error;

      setLearningLifecycle(data);
      window.dispatchEvent(new Event("notifications-changed"));
      toast.success(t("studentProfile.learningPause.saved"));
    } catch (error) {
      console.error("Student pause apply error:", error);
      const message = error?.message ?? "";
      setPauseError(
        message.includes("PAUSE_TOO_LONG") ||
          message.includes("PAUSE_START_IN_PAST") ||
          message.includes("PAUSE_END_BEFORE_START")
          ? t("studentProfile.learningPause.errors.invalidPeriod")
          : message.includes("STUDENT_ALREADY_PAUSED")
            ? t("studentProfile.learningPause.errors.alreadyPaused")
            : t("studentProfile.learningPause.errors.save"),
      );
    } finally {
      setPauseSaving(false);
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
          <h2>{t("studentProfile.learningPause.title")}</h2>

          {pauseLoading ? (
            <p className={styles.helper}>{t("common.loading")}</p>
          ) : learningLifecycle?.learning_status === "paused" ? (
            <>
              <p className={styles.helper}>
                {t("studentProfile.learningPause.currentPeriod", {
                  from: formatDateOnly(learningLifecycle.pause_from),
                  until: formatDateOnly(learningLifecycle.pause_until),
                })}
              </p>
              <p className={styles.helper}>
                {t("studentProfile.learningPause.activeHint")}
              </p>
              {pauseError && <p className={styles.error}>{pauseError}</p>}
              <button
                type="button"
                className={styles.secondaryButton}
                onClick={handlePauseResume}
                disabled={pauseSaving}
              >
                {pauseSaving
                  ? t("studentProfile.learningPause.resuming")
                  : learningLifecycle?.pause_is_active
                    ? t("studentProfile.learningPause.resume")
                    : t("studentProfile.learningPause.cancelScheduled")}
              </button>
            </>
          ) : (
            <form className={styles.form} onSubmit={handlePauseSubmit}>
              <p className={styles.helper}>
                {t("studentProfile.learningPause.description")}
              </p>

              <div className={styles.pausePeriod}>
                <label className={styles.field}>
                  <span>{t("studentProfile.learningPause.from")}</span>
                  <input
                    type="date"
                    min={getLocalDateString()}
                    value={pauseFrom}
                    onChange={(event) => {
                      const nextFrom = event.target.value;
                      setPauseFrom(nextFrom);
                      if (nextFrom) {
                        const maxUntil = getDateDaysFrom(nextFrom, 13);
                        if (!pauseUntil || pauseUntil < nextFrom || pauseUntil > maxUntil) {
                          setPauseUntil(getDateDaysFrom(nextFrom, 6));
                        }
                      }
                    }}
                    disabled={pauseSaving}
                    required
                  />
                </label>

                <label className={styles.field}>
                  <span>{t("studentProfile.learningPause.until")}</span>
                  <input
                    type="date"
                    min={pauseFrom || getLocalDateString()}
                    max={pauseFrom ? getDateDaysFrom(pauseFrom, 13) : undefined}
                    value={pauseUntil}
                    onChange={(event) => setPauseUntil(event.target.value)}
                    disabled={pauseSaving}
                    required
                  />
                </label>
              </div>

              <p className={styles.helper}>
                {t("studentProfile.learningPause.maxHint")}
              </p>
              <p className={styles.helper}>
                {t("studentProfile.learningPause.cancellationHint")}
              </p>

              {pauseError && <p className={styles.error}>{pauseError}</p>}

              <button
                type="submit"
                className={styles.secondaryButton}
                disabled={pauseSaving}
              >
                {pauseSaving
                  ? t("studentProfile.learningPause.saving")
                  : t("studentProfile.learningPause.submit")}
              </button>
            </form>
          )}
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

const getLocalDateString = () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const getDateDaysFrom = (dateString, days) => {
  if (!dateString) return "";
  const date = new Date(`${dateString}T12:00:00`);
  date.setDate(date.getDate() + days);
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
};

const formatDateOnly = (dateString) => {
  if (!dateString) return "—";
  return new Intl.DateTimeFormat(undefined, {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(`${dateString}T12:00:00`));
};

export default StudentProfile;
