import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getTimezone } from "../../constants/timezones";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { getIntlLocale } from "../../utils/getIntlLocale";

import styles from "./StudentSchedule.module.css";

const StudentSchedule = () => {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const [lessons, setLessons] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [cancellingLessonId, setCancellingLessonId] = useState(null);

  const timezone = profile?.timezone || "Europe/Kyiv";
  const timezoneConfig = getTimezone(timezone);
  const timezoneLabel = timezoneConfig ? t(timezoneConfig.labelKey) : timezone;
  const intlLocale = getIntlLocale(i18n.resolvedLanguage || i18n.language);

  const loadLessons = async () => {
    try {
      setErrorMessage("");

      const { data, error } = await supabase
        .from("lessons")
        .select(
          "id, starts_at, ends_at, duration_minutes, status, zoom_url, cancelled_by, cancelled_at, cancellation_reason",
        )
        .order("starts_at", { ascending: true });

      if (error) {
        throw error;
      }

      setLessons(data ?? []);
    } catch (error) {
      console.error("Lesson load error:", error);
      setErrorMessage(t("studentSchedule.loadError"));
    }
  };

  useEffect(() => {
    const initialize = async () => {
      try {
        setLoading(true);
        await loadLessons();
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, [t]);

  const upcomingLessons = useMemo(() => {
    const now = new Date();

    return lessons.filter(
      (lesson) =>
        lesson.status === "scheduled" && new Date(lesson.ends_at) >= now,
    );
  }, [lessons]);

  const pastLessons = useMemo(() => {
    const now = new Date();

    return lessons
      .filter(
        (lesson) =>
          lesson.status !== "scheduled" || new Date(lesson.ends_at) < now,
      )
      .reverse();
  }, [lessons]);

  const formatDate = (value) =>
    new Intl.DateTimeFormat(intlLocale, {
      timeZone: timezone,
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(new Date(value));

  const formatTime = (value) =>
    new Intl.DateTimeFormat(intlLocale, {
      timeZone: timezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));

  const getLessonDuration = (lesson) => {
    if (lesson.duration_minutes) {
      return lesson.duration_minutes;
    }

    const startsAt = new Date(lesson.starts_at).getTime();
    const endsAt = new Date(lesson.ends_at).getTime();

    return Math.round((endsAt - startsAt) / 60000);
  };

  const getStatusLabel = (status) =>
    t(`studentSchedule.${status}`, { defaultValue: status });

  const handleCancelLesson = async (lesson) => {
    const confirmed = window.confirm(t("studentSchedule.cancel.confirm"));

    if (!confirmed) {
      return;
    }

    try {
      setCancellingLessonId(lesson.id);
      setErrorMessage("");
      setSuccessMessage("");

      const { error } = await supabase.rpc("cancel_lesson", {
        p_lesson_id: lesson.id,
        p_reason: null,
      });

      if (error) {
        throw error;
      }

      setSuccessMessage(t("studentSchedule.cancel.success"));
      await loadLessons();
    } catch (error) {
      console.error("Cancel lesson error:", error);
      setErrorMessage(getCancelLessonError(error, t));
    } finally {
      setCancellingLessonId(null);
    }
  };

  if (loading) {
    return (
      <section className={styles.page}>
        <div className={styles.state}>
          <p>{t("studentSchedule.loading")}</p>
        </div>
      </section>
    );
  }

  if (errorMessage && lessons.length === 0) {
    return (
      <section className={styles.page}>
        <div className={styles.error}>{errorMessage}</div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>{t("studentSchedule.title")}</h1>
          <p>{t("studentSchedule.description")}</p>
        </div>

        <div className={styles.timezone}>
          <span>{t("studentSchedule.timezone")}</span>
          <strong>{timezoneLabel}</strong>
        </div>
      </div>

      {errorMessage && <div className={styles.error}>{errorMessage}</div>}
      {successMessage && <div className={styles.success}>{successMessage}</div>}

      <section className={styles.section}>
        <div className={styles.sectionHeader}>
          <h2>{t("studentSchedule.upcoming")}</h2>
          <span className={styles.counter}>{upcomingLessons.length}</span>
        </div>

        {upcomingLessons.length === 0 ? (
          <div className={styles.emptyState}>
            <h3>{t("studentSchedule.emptyTitle")}</h3>
            <p>{t("studentSchedule.emptyDescription")}</p>
          </div>
        ) : (
          <div className={styles.lessonsGrid}>
            {upcomingLessons.map((lesson) => (
              <article key={lesson.id} className={styles.lessonCard}>
                <div className={styles.lessonHeader}>
                  <div>
                    <p className={styles.date}>{formatDate(lesson.starts_at)}</p>
                    <p className={styles.time}>
                      {formatTime(lesson.starts_at)} — {formatTime(lesson.ends_at)}
                    </p>
                  </div>

                  <span className={`${styles.status} ${styles.scheduled}`}>
                    {getStatusLabel(lesson.status)}
                  </span>
                </div>

                <div className={styles.lessonFooter}>
                  <span className={styles.duration}>
                    {t("studentSchedule.duration", {
                      count: getLessonDuration(lesson),
                    })}
                  </span>

                  <div className={styles.lessonActions}>
                    {lesson.zoom_url ? (
                      <a
                        href={lesson.zoom_url}
                        target="_blank"
                        rel="noreferrer"
                        className={styles.zoomButton}
                      >
                        {t("studentSchedule.joinZoom")}
                      </a>
                    ) : (
                      <span className={styles.noZoom}>
                        {t("studentSchedule.noZoom")}
                      </span>
                    )}

                    <button
                      type="button"
                      className={styles.cancelButton}
                      onClick={() => handleCancelLesson(lesson)}
                      disabled={cancellingLessonId === lesson.id}
                    >
                      {cancellingLessonId === lesson.id
                        ? t("studentSchedule.cancel.cancelling")
                        : t("studentSchedule.cancel.button")}
                    </button>
                  </div>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

      {pastLessons.length > 0 && (
        <section className={styles.section}>
          <div className={styles.sectionHeader}>
            <h2>{t("studentSchedule.history")}</h2>
            <span className={styles.counter}>{pastLessons.length}</span>
          </div>

          <div className={styles.history}>
            {pastLessons.map((lesson) => (
              <article key={lesson.id} className={styles.historyItem}>
                <div>
                  <strong>{formatDate(lesson.starts_at)}</strong>
                  <p>
                    {formatTime(lesson.starts_at)} — {formatTime(lesson.ends_at)}
                  </p>
                </div>

                <span
                  className={`${styles.status} ${
                    lesson.status === "completed"
                      ? styles.completed
                      : lesson.status === "cancelled"
                        ? styles.cancelled
                        : styles.scheduled
                  }`}
                >
                  {getStatusLabel(lesson.status)}
                </span>
              </article>
            ))}
          </div>
        </section>
      )}
    </section>
  );
};

const getCancelLessonError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("LESSON_ALREADY_CANCELLED")) {
    return t("studentSchedule.cancel.errors.alreadyCancelled");
  }

  if (message.includes("COMPLETED_LESSON_CANNOT_BE_CANCELLED")) {
    return t("studentSchedule.cancel.errors.completed");
  }

  if (message.includes("PAST_LESSON_CANNOT_BE_CANCELLED")) {
    return t("studentSchedule.cancel.errors.past");
  }

  if (message.includes("LESSON_NOT_FOUND")) {
    return t("studentSchedule.cancel.errors.notFound");
  }

  return t("studentSchedule.cancel.errors.generic");
};

export default StudentSchedule;
