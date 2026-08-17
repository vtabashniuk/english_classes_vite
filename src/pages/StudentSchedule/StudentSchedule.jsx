import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getTimezone } from "../../constants/timezones";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { getIntlLocale } from "../../utils/getIntlLocale";

import styles from "./StudentSchedule.module.css";

const getTodayValue = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
};

const StudentSchedule = () => {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const [lessons, setLessons] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [cancellingLessonId, setCancellingLessonId] = useState(null);

  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [requestDate, setRequestDate] = useState(getTodayValue());
  const [availability, setAvailability] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [cancellingRequestId, setCancellingRequestId] = useState(null);

  const timezone = profile?.timezone || "Europe/Kyiv";
  const timezoneConfig = getTimezone(timezone);
  const timezoneLabel = timezoneConfig ? t(timezoneConfig.labelKey) : timezone;
  const intlLocale = getIntlLocale(i18n.resolvedLanguage || i18n.language);

  const loadLessons = async () => {
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
  };

  const loadRequests = async () => {
    const { data, error } = await supabase
      .from("lesson_requests")
      .select(
        "id, request_type, requested_starts_at, duration_minutes, message, status, created_at",
      )
      .order("created_at", { ascending: false });

    if (error) {
      throw error;
    }

    setRequests(data ?? []);
  };

  const loadAll = async () => {
    try {
      setErrorMessage("");
      await Promise.all([loadLessons(), loadRequests()]);
    } catch (error) {
      console.error("Student schedule load error:", error);
      setErrorMessage(t("studentSchedule.loadError"));
    }
  };

  useEffect(() => {
    const initialize = async () => {
      try {
        setLoading(true);
        await loadAll();
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

  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === "pending"),
    [requests],
  );

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

  const getRequestStatusLabel = (status) =>
    t(`studentSchedule.extraLesson.statuses.${status}`, {
      defaultValue: status,
    });

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

  const loadAvailability = async (dateValue) => {
    if (!dateValue) {
      setAvailability([]);
      setSelectedSlot("");
      return;
    }

    try {
      setAvailabilityLoading(true);
      setRequestError("");
      setSelectedSlot("");

      const { data, error } = await supabase.rpc(
        "get_extra_lesson_availability",
        { p_date: dateValue },
      );

      if (error) {
        throw error;
      }

      setAvailability(data ?? []);
    } catch (error) {
      console.error("Availability load error:", error);
      setAvailability([]);
      setRequestError(t("studentSchedule.extraLesson.errors.availability"));
    } finally {
      setAvailabilityLoading(false);
    }
  };

  const handleOpenRequestForm = async () => {
    const nextOpenState = !requestFormOpen;
    setRequestFormOpen(nextOpenState);
    setRequestError("");
    setSuccessMessage("");

    if (nextOpenState) {
      await loadAvailability(requestDate);
    }
  };

  const handleRequestDateChange = async (event) => {
    const value = event.target.value;
    setRequestDate(value);
    await loadAvailability(value);
  };

  const handleCancelRequest = async (request) => {
    const confirmed = window.confirm(
      t("studentSchedule.extraLesson.cancel.confirm"),
    );

    if (!confirmed) {
      return;
    }

    try {
      setCancellingRequestId(request.id);
      setRequestError("");
      setSuccessMessage("");

      const { error } = await supabase.rpc("cancel_extra_lesson_request", {
        p_request_id: request.id,
      });

      if (error) {
        throw error;
      }

      setSuccessMessage(t("studentSchedule.extraLesson.cancel.success"));
      await loadRequests();
    } catch (error) {
      console.error("Cancel extra lesson request error:", error);
      setRequestError(getCancelExtraLessonRequestError(error, t));
    } finally {
      setCancellingRequestId(null);
    }
  };

  const handleCreateRequest = async (event) => {
    event.preventDefault();

    if (!selectedSlot) {
      setRequestError(t("studentSchedule.extraLesson.errors.selectSlot"));
      return;
    }

    try {
      setRequestSubmitting(true);
      setRequestError("");
      setSuccessMessage("");

      const { error } = await supabase.rpc("create_extra_lesson_request", {
        p_requested_starts_at: selectedSlot,
        p_message: requestMessage.trim() || null,
      });

      if (error) {
        throw error;
      }

      setSuccessMessage(t("studentSchedule.extraLesson.success"));
      setRequestMessage("");
      setSelectedSlot("");
      setAvailability([]);
      setRequestFormOpen(false);
      await loadRequests();
    } catch (error) {
      console.error("Create extra lesson request error:", error);
      setRequestError(getExtraLessonRequestError(error, t));
    } finally {
      setRequestSubmitting(false);
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

  if (errorMessage && lessons.length === 0 && requests.length === 0) {
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

      <section className={styles.extraLessonSection}>
        <div className={styles.extraLessonHeading}>
          <div>
            <h2>{t("studentSchedule.extraLesson.title")}</h2>
            <p>{t("studentSchedule.extraLesson.description")}</p>
          </div>

          <button
            type="button"
            className={styles.requestToggleButton}
            onClick={handleOpenRequestForm}
          >
            {requestFormOpen
              ? t("studentSchedule.extraLesson.close")
              : t("studentSchedule.extraLesson.open")}
          </button>
        </div>

        {requestFormOpen && (
          <form className={styles.requestForm} onSubmit={handleCreateRequest}>
            <label className={`${styles.formField} ${styles.dateField}`}>
              <span>{t("studentSchedule.extraLesson.date")}</span>
              <input
                type="date"
                value={requestDate}
                min={getTodayValue()}
                onChange={handleRequestDateChange}
              />
            </label>

            <div className={styles.formField}>
              <span>{t("studentSchedule.extraLesson.availableTime")}</span>

              {availabilityLoading ? (
                <p className={styles.helperText}>
                  {t("studentSchedule.extraLesson.loadingAvailability")}
                </p>
              ) : availability.length === 0 ? (
                <p className={styles.helperText}>
                  {t("studentSchedule.extraLesson.noAvailability")}
                </p>
              ) : (
                <div className={styles.slotGrid}>
                  {availability.map((slot) => (
                    <button
                      key={slot.starts_at}
                      type="button"
                      className={`${styles.slotButton} ${
                        selectedSlot === slot.starts_at
                          ? styles.slotButtonSelected
                          : ""
                      }`}
                      onClick={() => setSelectedSlot(slot.starts_at)}
                    >
                      {formatTime(slot.starts_at)}
                    </button>
                  ))}
                </div>
              )}

              <small className={styles.helperText}>
                {t("studentSchedule.extraLesson.timezoneHint", {
                  timezone: timezoneLabel,
                })}
              </small>
            </div>

            <label className={styles.formField}>
              <span>{t("studentSchedule.extraLesson.message")}</span>
              <textarea
                rows="3"
                value={requestMessage}
                onChange={(event) => setRequestMessage(event.target.value)}
                placeholder={t(
                  "studentSchedule.extraLesson.messagePlaceholder",
                )}
              />
            </label>

            {requestError && <div className={styles.error}>{requestError}</div>}

            <button
              type="submit"
              className={styles.submitRequestButton}
              disabled={!selectedSlot || requestSubmitting}
            >
              {requestSubmitting
                ? t("studentSchedule.extraLesson.submitting")
                : t("studentSchedule.extraLesson.submit")}
            </button>
          </form>
        )}

        {pendingRequests.length > 0 && (
          <div className={styles.pendingRequests}>
            <h3>{t("studentSchedule.extraLesson.pendingTitle")}</h3>

            {pendingRequests.map((request) => (
              <article key={request.id} className={styles.requestCard}>
                <div>
                  <strong>{formatDate(request.requested_starts_at)}</strong>
                  <p>
                    {formatTime(request.requested_starts_at)} ·{" "}
                    {t("studentSchedule.duration", {
                      count: request.duration_minutes,
                    })}
                  </p>
                  {request.message && (
                    <p className={styles.requestMessage}>{request.message}</p>
                  )}
                </div>

                <div className={styles.requestCardActions}>
                  <span className={styles.pendingStatus}>
                    {getRequestStatusLabel(request.status)}
                  </span>

                  <button
                    type="button"
                    className={styles.cancelRequestButton}
                    onClick={() => handleCancelRequest(request)}
                    disabled={cancellingRequestId === request.id}
                  >
                    {cancellingRequestId === request.id
                      ? t("studentSchedule.extraLesson.cancel.cancelling")
                      : t("studentSchedule.extraLesson.cancel.button")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        )}
      </section>

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
                    <p className={styles.date}>
                      {formatDate(lesson.starts_at)}
                    </p>
                    <p className={styles.time}>
                      {formatTime(lesson.starts_at)} —{" "}
                      {formatTime(lesson.ends_at)}
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
                    {formatTime(lesson.starts_at)} —{" "}
                    {formatTime(lesson.ends_at)}
                  </p>
                </div>

                <span
                  className={`${styles.status} ${styles[lesson.status] || styles.scheduled}`}
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

const getExtraLessonRequestError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("LESSON_TIME_CONFLICT")) {
    return t("studentSchedule.extraLesson.errors.lessonConflict");
  }

  if (message.includes("REQUEST_TIME_CONFLICT")) {
    return t("studentSchedule.extraLesson.errors.requestConflict");
  }

  if (message.includes("NON_WORKING_DAY")) {
    return t("studentSchedule.extraLesson.errors.nonWorkingDay");
  }

  if (message.includes("OUTSIDE_WORKING_HOURS")) {
    return t("studentSchedule.extraLesson.errors.outsideHours");
  }

  if (message.includes("INVALID_TIME_SLOT")) {
    return t("studentSchedule.extraLesson.errors.invalidSlot");
  }

  if (message.includes("LESSON_MUST_BE_IN_FUTURE")) {
    return t("studentSchedule.extraLesson.errors.past");
  }

  return t("studentSchedule.extraLesson.errors.generic");
};

const getCancelExtraLessonRequestError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("REQUEST_NOT_FOUND")) {
    return t("studentSchedule.extraLesson.cancel.errors.notFound");
  }

  if (message.includes("REQUEST_NOT_PENDING")) {
    return t("studentSchedule.extraLesson.cancel.errors.notPending");
  }

  return t("studentSchedule.extraLesson.cancel.errors.generic");
};

export default StudentSchedule;
