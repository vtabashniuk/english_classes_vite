import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import { supabase } from "../../lib/supabase";

import { TIMEZONES } from "../../constants/timezones";

import {
  DEFAULT_SCHEDULE_SETTINGS,
  MIN_LESSON_DURATION,
  MAX_LESSON_DURATION,
  LESSON_DURATION_STEP,
} from "../../constants/schedule";

import styles from "./TeacherSettings.module.css";

const TeacherSettings = () => {
  const { t } = useTranslation();

  const [timezone, setTimezone] = useState(DEFAULT_SCHEDULE_SETTINGS.timezone);

  const [workdayStart, setWorkdayStart] = useState(
    DEFAULT_SCHEDULE_SETTINGS.workdayStart,
  );

  const [workdayEnd, setWorkdayEnd] = useState(
    DEFAULT_SCHEDULE_SETTINGS.workdayEnd,
  );

  const [lessonDurationMinutes, setLessonDurationMinutes] = useState(
    DEFAULT_SCHEDULE_SETTINGS.lessonDurationMinutes,
  );

  const [loading, setLoading] = useState(true);

  const [saving, setSaving] = useState(false);

  const [errorMessage, setErrorMessage] = useState("");

  const [successMessage, setSuccessMessage] = useState("");

  useEffect(() => {
    const loadSettings = async () => {
      try {
        setLoading(true);
        setErrorMessage("");

        const { data, error } = await supabase
          .from("teacher_settings")
          .select(
            `
              schedule_timezone,
              workday_start,
              workday_end,
              lesson_duration_minutes,
              slot_interval_minutes
            `,
          )
          .single();

        if (error) {
          throw error;
        }

        setTimezone(
          data?.schedule_timezone || DEFAULT_SCHEDULE_SETTINGS.timezone,
        );

        setWorkdayStart(
          data?.workday_start?.slice(0, 5) ||
            DEFAULT_SCHEDULE_SETTINGS.workdayStart,
        );

        setWorkdayEnd(
          data?.workday_end?.slice(0, 5) ||
            DEFAULT_SCHEDULE_SETTINGS.workdayEnd,
        );

        setLessonDurationMinutes(
          data?.lesson_duration_minutes ??
            DEFAULT_SCHEDULE_SETTINGS.lessonDurationMinutes,
        );
      } catch (error) {
        console.error("Load teacher settings error:", error);

        setErrorMessage(t("teacherSettings.errors.load"));
      } finally {
        setLoading(false);
      }
    };

    loadSettings();
  }, [t]);

  const handleSubmit = async (event) => {
    event.preventDefault();

    setErrorMessage("");
    setSuccessMessage("");

    if (workdayEnd <= workdayStart) {
      setErrorMessage(t("teacherSettings.errors.invalidWorkday"));

      return;
    }

    try {
      setSaving(true);

      const { error } = await supabase.rpc("update_my_teacher_settings", {
        p_schedule_timezone: timezone,
        p_workday_start: workdayStart,
        p_workday_end: workdayEnd,
        p_lesson_duration_minutes: Number(lessonDurationMinutes),
      });

      if (error) {
        throw error;
      }

      setSuccessMessage(t("teacherSettings.messages.saved"));
    } catch (error) {
      console.error("Update teacher settings error:", error);

      setErrorMessage(getSettingsError(error, t));
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <section className={styles.page}>
        <div className={styles.state}>{t("teacherSettings.loading")}</div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{t("teacherSettings.title")}</h1>

          <p>{t("teacherSettings.description")}</p>
        </div>
      </header>

      <div className={styles.content}>
        <form className={styles.card} onSubmit={handleSubmit}>
          <div className={styles.cardHeader}>
            <h2>{t("teacherSettings.scheduleTitle")}</h2>

            <p>{t("teacherSettings.scheduleDescription")}</p>
          </div>

          <label className={styles.field}>
            <span>{t("teacherSettings.timezone")}</span>

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

            <small>{t("teacherSettings.timezoneHint")}</small>
          </label>

          <div className={styles.row}>
            <label className={styles.field}>
              <span>{t("teacherSettings.workdayStart")}</span>

              <input
                type="time"
                step="1800"
                value={workdayStart}
                onChange={(event) => setWorkdayStart(event.target.value)}
              />
            </label>

            <label className={styles.field}>
              <span>{t("teacherSettings.workdayEnd")}</span>

              <input
                type="time"
                step="1800"
                value={workdayEnd}
                onChange={(event) => setWorkdayEnd(event.target.value)}
              />
            </label>
          </div>

          <label className={styles.field}>
            <span>{t("teacherSettings.lessonDuration")}</span>

            <select
              value={lessonDurationMinutes}
              onChange={(event) =>
                setLessonDurationMinutes(Number(event.target.value))
              }
            >
              {createDurationOptions().map((minutes) => (
                <option key={minutes} value={minutes}>
                  {t("teacherSettings.minutes", {
                    count: minutes,
                  })}
                </option>
              ))}
            </select>

            <small>{t("teacherSettings.lessonDurationHint")}</small>
          </label>

          <div className={styles.readOnlyField}>
            <span>{t("teacherSettings.slotInterval")}</span>

            <strong>
              {t("teacherSettings.minutes", {
                count: DEFAULT_SCHEDULE_SETTINGS.slotIntervalMinutes,
              })}
            </strong>

            <small>{t("teacherSettings.slotIntervalHint")}</small>
          </div>

          {errorMessage && <p className={styles.error}>{errorMessage}</p>}

          {successMessage && <p className={styles.success}>{successMessage}</p>}

          <div className={styles.actions}>
            <button
              type="submit"
              className={styles.primaryButton}
              disabled={saving}
            >
              {saving ? t("teacherSettings.saving") : t("teacherSettings.save")}
            </button>
          </div>
        </form>
      </div>
    </section>
  );
};

const createDurationOptions = () => {
  const options = [];

  for (
    let value = MIN_LESSON_DURATION;
    value <= MAX_LESSON_DURATION;
    value += LESSON_DURATION_STEP
  ) {
    options.push(value);
  }

  return options;
};

const getSettingsError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("INVALID_TIMEZONE")) {
    return t("teacherSettings.errors.invalidTimezone");
  }

  if (message.includes("INVALID_WORKDAY")) {
    return t("teacherSettings.errors.invalidWorkday");
  }

  if (message.includes("INVALID_LESSON_DURATION")) {
    return t("teacherSettings.errors.invalidDuration");
  }

  if (message.includes("WORKDAY_TOO_SHORT")) {
    return t("teacherSettings.errors.workdayTooShort");
  }

  if (message.includes("TEACHER_REQUIRED")) {
    return t("teacherSettings.errors.teacherRequired");
  }

  return t("teacherSettings.errors.save");
};

export default TeacherSettings;
