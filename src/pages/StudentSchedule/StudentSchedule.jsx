import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getTimezone } from "../../constants/timezones";
import { useAuth } from "../../context/useAuth";
import {
  cancelExtraLessonRequest,
  cancelLessonRescheduleRequest,
  createExtraLessonRequest,
  createLessonRescheduleRequest,
  getExtraLessonAvailability,
  getLessonRescheduleAvailability,
  listStudentLessonRequests,
  previewLessonReschedule,
} from "../../features/lessonRequests/api/lessonRequestsApi";
import {
  listMyLessonCancellationRequests,
  listStudentLessons,
  previewLessonCancellation,
  requestLessonCancellation,
} from "../../features/lessons/api/lessonsApi";
import { getMeetingProviderLabel } from "../../features/lessons/lib/meetingProvider";
import { getMyStudentFinancialAccess } from "../../features/studentFinancialAccess/api/studentFinancialAccessApi";
import { getMyStudentLifecycle } from "../../features/studentLifecycle/api/studentLifecycleApi";
import { formatFinanceMoney } from "../../utils/formatFinanceMoney";
import { getIntlLocale } from "../../utils/getIntlLocale";

import styles from "./StudentSchedule.module.css";


const fetchStudentLessons = async () => {
  const { data, error } = await listStudentLessons();

  if (error) {
    throw error;
  }

  return data ?? [];
};

const fetchStudentRequests = async () => {
  const { data, error } = await listStudentLessonRequests();

  if (error) {
    throw error;
  }

  return data ?? [];
};

const fetchCancellationRequests = async () => {
  const { data, error } = await listMyLessonCancellationRequests();

  if (error) {
    throw error;
  }

  return data ?? [];
};

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
  const [cancellationRequests, setCancellationRequests] = useState([]);
  const [financialAccess, setFinancialAccess] = useState(null);
  const [learningLifecycle, setLearningLifecycle] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [cancellingLessonId, setCancellingLessonId] = useState(null);
  const [currentTimeMs, setCurrentTimeMs] = useState(null);

  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const [requestDate, setRequestDate] = useState(getTodayValue());
  const [availability, setAvailability] = useState([]);
  const [availabilityLoading, setAvailabilityLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState("");
  const [requestMessage, setRequestMessage] = useState("");
  const [requestSubmitting, setRequestSubmitting] = useState(false);
  const [requestError, setRequestError] = useState("");
  const [cancellingRequestId, setCancellingRequestId] = useState(null);

  const [rescheduleLessonId, setRescheduleLessonId] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState(getTodayValue());
  const [rescheduleAvailability, setRescheduleAvailability] = useState([]);
  const [rescheduleAvailabilityLoading, setRescheduleAvailabilityLoading] = useState(false);
  const [rescheduleSelectedSlot, setRescheduleSelectedSlot] = useState("");
  const [rescheduleMessage, setRescheduleMessage] = useState("");
  const [rescheduleSubmitting, setRescheduleSubmitting] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");
  const [cancellingRescheduleRequestId, setCancellingRescheduleRequestId] = useState(null);

  const timezone = profile?.timezone || "Europe/Kyiv";
  const timezoneConfig = getTimezone(timezone);
  const timezoneLabel = timezoneConfig ? t(timezoneConfig.labelKey) : timezone;
  const language = i18n.resolvedLanguage || i18n.language;
  const intlLocale = getIntlLocale(language);
  const financiallyRestricted = Boolean(financialAccess?.access_restricted);
  const learningPaused = learningLifecycle?.learning_status === "paused";
  const learningInactive = learningLifecycle?.learning_status === "inactive";
  const learningRestricted = learningPaused || learningInactive;
  const newLearningRestricted = financiallyRestricted || learningRestricted;

  const loadRequests = async () => {
    const nextRequests = await fetchStudentRequests();
    setRequests(nextRequests);
  };

  const loadCancellationRequests = async () => {
    const nextRequests = await fetchCancellationRequests();
    setCancellationRequests(nextRequests);
  };

  useEffect(() => {
    const updateCurrentTime = () => {
      setCurrentTimeMs(Date.now());
    };

    const initialTimerId = window.setTimeout(updateCurrentTime, 0);
    const intervalId = window.setInterval(updateCurrentTime, 30_000);

    return () => {
      window.clearTimeout(initialTimerId);
      window.clearInterval(intervalId);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        const [
          nextLessons,
          nextRequests,
          nextCancellationRequests,
          accessResult,
          lifecycleResult,
        ] = await Promise.all([
          fetchStudentLessons(),
          fetchStudentRequests(),
          fetchCancellationRequests(),
          getMyStudentFinancialAccess(),
          getMyStudentLifecycle(),
        ]);

        if (accessResult.error || lifecycleResult.error) {
          throw accessResult.error || lifecycleResult.error;
        }

        if (!cancelled) {
          setErrorMessage("");
          setLessons(nextLessons);
          setRequests(nextRequests);
          setCancellationRequests(nextCancellationRequests);
          setFinancialAccess(accessResult.data);
          setLearningLifecycle(lifecycleResult.data);
        }
      } catch (error) {
        console.error("Student schedule load error:", error);

        if (!cancelled) {
          setErrorMessage(t("studentSchedule.loadError"));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    initialize();

    return () => {
      cancelled = true;
    };
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

  const pendingExtraRequests = useMemo(
    () =>
      requests.filter(
        (request) =>
          request.status === "pending" && request.request_type === "extra_lesson",
      ),
    [requests],
  );

  const pendingRescheduleRequests = useMemo(
    () =>
      requests.filter(
        (request) =>
          request.status === "pending" && request.request_type === "reschedule",
      ),
    [requests],
  );

  const pendingRescheduleLessonIds = useMemo(
    () => new Set(pendingRescheduleRequests.map((request) => request.lesson_id)),
    [pendingRescheduleRequests],
  );

  const pendingCancellationLessonIds = useMemo(
    () =>
      new Set(
        cancellationRequests
          .filter((request) => request.status === "pending")
          .map((request) => request.lesson_id),
      ),
    [cancellationRequests],
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

  const formatDateInput = (value) => {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date(value));
    const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
    return `${map.year}-${map.month}-${map.day}`;
  };

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

  const formatCancellationLeadTime = (minutesValue) => {
    const totalMinutes = Math.max(0, Number(minutesValue) || 0);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return t("studentSchedule.cancel.leadTime", {
      hours,
      minutes: String(minutes).padStart(2, "0"),
    });
  };

  const handleCancelLesson = async (lesson) => {
    try {
      setCancellingLessonId(lesson.id);
      setErrorMessage("");
      setSuccessMessage("");

      const { data: preview, error: previewError } =
        await previewLessonCancellation({ lessonId: lesson.id });

      if (previewError) {
        throw previewError;
      }

      const amount =
        preview?.priceAmountMinor != null && preview?.priceCurrency
          ? formatFinanceMoney(
              Number(preview.priceAmountMinor),
              preview.priceCurrency,
              language,
            )
          : null;

      const confirmMessage = preview?.isLate
        ? amount
          ? t("studentSchedule.cancel.lateConfirm", {
              time: formatCancellationLeadTime(preview.minutesBeforeStart),
              amount,
            })
          : t("studentSchedule.cancel.lateConfirmNoPrice", {
              time: formatCancellationLeadTime(preview.minutesBeforeStart),
            })
        : t("studentSchedule.cancel.confirm");

      if (!window.confirm(confirmMessage)) {
        return;
      }

      const { error } = await requestLessonCancellation({
        lessonId: lesson.id,
      });

      if (error) {
        throw error;
      }

      setSuccessMessage(
        preview?.isLate
          ? amount
            ? t("studentSchedule.cancel.lateSuccess", { amount })
            : t("studentSchedule.cancel.lateSuccessNoPrice")
          : t("studentSchedule.cancel.success"),
      );
      await loadCancellationRequests();
      window.dispatchEvent(new Event("lesson-requests-changed"));
    } catch (error) {
      console.error("Request lesson cancellation error:", error);
      setErrorMessage(getCancelLessonError(error, t));
    } finally {
      setCancellingLessonId(null);
    }
  };

  const resetRescheduleForm = () => {
    setRescheduleLessonId(null);
    setRescheduleAvailability([]);
    setRescheduleSelectedSlot("");
    setRescheduleMessage("");
    setRescheduleError("");
  };

  const loadRescheduleAvailability = async (lessonId, dateValue) => {
    if (!lessonId || !dateValue) {
      setRescheduleAvailability([]);
      setRescheduleSelectedSlot("");
      return;
    }

    try {
      setRescheduleAvailabilityLoading(true);
      setRescheduleError("");
      setRescheduleSelectedSlot("");

      const { data, error } = await getLessonRescheduleAvailability({
        lessonId,
        date: dateValue,
      });

      if (error) throw error;
      setRescheduleAvailability(data ?? []);
    } catch (error) {
      console.error("Reschedule availability load error:", error);
      setRescheduleAvailability([]);
      setRescheduleError(getLessonRescheduleError(error, t));
    } finally {
      setRescheduleAvailabilityLoading(false);
    }
  };

  const handleOpenRescheduleForm = async (lesson) => {
    if (learningRestricted) {
      setErrorMessage(t("studentSchedule.lifecycle.restrictedAction"));
      return;
    }

    if (financiallyRestricted) {
      setErrorMessage(t("studentSchedule.financialAccess.restrictedAction"));
      return;
    }

    if (rescheduleLessonId === lesson.id) {
      resetRescheduleForm();
      return;
    }

    try {
      setErrorMessage("");
      setSuccessMessage("");
      setRescheduleError("");

      const { data: preview, error } = await previewLessonReschedule(lesson.id);
      if (error) throw error;

      if (!preview?.canRequest) {
        setErrorMessage(
          getLessonReschedulePreviewError(preview?.reason, preview?.noticeHours, t),
        );
        return;
      }

      const initialDate = formatDateInput(lesson.starts_at);
      setRescheduleLessonId(lesson.id);
      setRescheduleDate(initialDate);
      setRescheduleMessage("");
      await loadRescheduleAvailability(lesson.id, initialDate);
    } catch (error) {
      console.error("Preview lesson reschedule error:", error);
      setErrorMessage(getLessonRescheduleError(error, t));
    }
  };

  const handleRescheduleDateChange = async (lessonId, event) => {
    const value = event.target.value;
    setRescheduleDate(value);
    await loadRescheduleAvailability(lessonId, value);
  };

  const handleCreateRescheduleRequest = async (event, lesson) => {
    event.preventDefault();

    if (learningRestricted) {
      setRescheduleError(t("studentSchedule.lifecycle.restrictedAction"));
      return;
    }

    if (financiallyRestricted) {
      setRescheduleError(t("studentSchedule.financialAccess.restrictedAction"));
      return;
    }

    if (!rescheduleSelectedSlot) {
      setRescheduleError(t("studentSchedule.reschedule.errors.selectSlot"));
      return;
    }

    try {
      setRescheduleSubmitting(true);
      setRescheduleError("");
      setErrorMessage("");
      setSuccessMessage("");

      const { error } = await createLessonRescheduleRequest({
        lessonId: lesson.id,
        requestedStartsAt: rescheduleSelectedSlot,
        message: rescheduleMessage.trim() || null,
      });
      if (error) throw error;

      setSuccessMessage(t("studentSchedule.reschedule.success"));
      resetRescheduleForm();
      await loadRequests();
      window.dispatchEvent(new Event("lesson-requests-changed"));
      window.dispatchEvent(new Event("notifications-changed"));
    } catch (error) {
      console.error("Create lesson reschedule request error:", error);
      if ((error?.message ?? "").includes("STUDENT_FINANCIAL_ACCESS_RESTRICTED")) {
        const accessResult = await getMyStudentFinancialAccess();
        if (!accessResult.error) setFinancialAccess(accessResult.data);
      }
      setRescheduleError(getLessonRescheduleError(error, t));
    } finally {
      setRescheduleSubmitting(false);
    }
  };

  const handleCancelRescheduleRequest = async (request) => {
    if (!window.confirm(t("studentSchedule.reschedule.cancel.confirm"))) return;

    try {
      setCancellingRescheduleRequestId(request.id);
      setErrorMessage("");
      setSuccessMessage("");

      const { error } = await cancelLessonRescheduleRequest(request.id);
      if (error) throw error;

      setSuccessMessage(t("studentSchedule.reschedule.cancel.success"));
      await loadRequests();
      window.dispatchEvent(new Event("lesson-requests-changed"));
    } catch (error) {
      console.error("Cancel lesson reschedule request error:", error);
      setErrorMessage(getLessonRescheduleError(error, t));
    } finally {
      setCancellingRescheduleRequestId(null);
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

      const { data, error } = await getExtraLessonAvailability(dateValue);

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
    if (learningRestricted) {
      setRequestFormOpen(false);
      setRequestError(t("studentSchedule.lifecycle.restrictedAction"));
      return;
    }

    if (financiallyRestricted) {
      setRequestFormOpen(false);
      setRequestError(t("studentSchedule.financialAccess.restrictedAction"));
      return;
    }

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

      const { error } = await cancelExtraLessonRequest(request.id);

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

    if (learningRestricted) {
      setRequestError(t("studentSchedule.lifecycle.restrictedAction"));
      return;
    }

    if (financiallyRestricted) {
      setRequestError(t("studentSchedule.financialAccess.restrictedAction"));
      return;
    }

    if (!selectedSlot) {
      setRequestError(t("studentSchedule.extraLesson.errors.selectSlot"));
      return;
    }

    try {
      setRequestSubmitting(true);
      setRequestError("");
      setSuccessMessage("");

      const { error } = await createExtraLessonRequest({
        startsAt: selectedSlot,
        message: requestMessage.trim() || null,
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
      if ((error?.message ?? "").includes("STUDENT_FINANCIAL_ACCESS_RESTRICTED")) {
        const accessResult = await getMyStudentFinancialAccess();
        if (!accessResult.error) setFinancialAccess(accessResult.data);
      }
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

      {learningRestricted && (
        <div className={`${styles.financialAccessNotice} ${styles.learningPauseNotice}`}>
          <div>
            <strong>
              {learningInactive
                ? t("studentSchedule.lifecycle.inactiveTitle")
                : t("studentSchedule.lifecycle.pausedTitle")}
            </strong>
            <p>
              {learningInactive
                ? t("studentSchedule.lifecycle.inactiveDescription")
                : learningLifecycle?.pause_until
                  ? t("studentSchedule.lifecycle.pausedDescriptionUntil", {
                      date: new Intl.DateTimeFormat(intlLocale, {
                        day: "2-digit",
                        month: "2-digit",
                        year: "numeric",
                      }).format(
                        new Date(`${learningLifecycle.pause_until}T12:00:00`),
                      ),
                    })
                  : t("studentSchedule.lifecycle.pausedDescription")}
            </p>
          </div>
        </div>
      )}

      {!financialAccess?.is_financially_blocked &&
        !financialAccess?.fx_pending &&
        Number(financialAccess?.balance_minor ?? 0) < 0 &&
        Number(financialAccess?.recommended_payment_minor ?? 0) > 0 &&
        financialAccess?.tariff_currency && (
          <div className={styles.financialAccessNotice}>
            <div>
              <strong>{t("studentSchedule.financialAccess.debtTitle")}</strong>
              <p>{t("studentSchedule.financialAccess.debtDescription")}</p>
            </div>
            <span className={styles.financialAccessPayment}>
              {t("studentSchedule.financialAccess.recommendedPayment", {
                amount: formatFinanceMoney(
                  Number(financialAccess.recommended_payment_minor),
                  financialAccess.tariff_currency,
                  language,
                ),
              })}
            </span>
          </div>
        )}

      {financialAccess?.is_financially_blocked && (
        <div
          className={`${styles.financialAccessNotice} ${
            financiallyRestricted
              ? styles.financialAccessRestricted
              : styles.financialAccessTemporary
          }`}
        >
          <div>
            <strong>
              {financiallyRestricted
                ? t("studentSchedule.financialAccess.blockedTitle")
                : t("studentSchedule.financialAccess.temporaryTitle")}
            </strong>
            <p>
              {financiallyRestricted
                ? t("studentSchedule.financialAccess.blockedDescription")
                : t("studentSchedule.financialAccess.temporaryDescription")}
            </p>
          </div>

          {!financialAccess.fx_pending &&
            Number(financialAccess.recommended_payment_minor ?? 0) > 0 &&
            financialAccess.tariff_currency && (
              <span className={styles.financialAccessPayment}>
                {t("studentSchedule.financialAccess.recommendedPayment", {
                  amount: formatFinanceMoney(
                    Number(financialAccess.recommended_payment_minor),
                    financialAccess.tariff_currency,
                    language,
                  ),
                })}
              </span>
            )}
        </div>
      )}

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
            disabled={newLearningRestricted}
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

        {pendingExtraRequests.length > 0 && (
          <div className={styles.pendingRequests}>
            <h3>{t("studentSchedule.extraLesson.pendingTitle")}</h3>

            {pendingExtraRequests.map((request) => (
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

      {pendingRescheduleRequests.length > 0 && (
        <section className={styles.extraLessonSection}>
          <div className={styles.extraLessonHeading}>
            <div>
              <h2>{t("studentSchedule.reschedule.pendingTitle")}</h2>
              <p>{t("studentSchedule.reschedule.pendingDescription")}</p>
            </div>
          </div>

          <div className={styles.pendingRequests}>
            {pendingRescheduleRequests.map((request) => (
              <article key={request.id} className={styles.requestCard}>
                <div>
                  <strong>
                    {t("studentSchedule.reschedule.from")}: {formatDate(request.original_starts_at)}
                  </strong>
                  <p>{formatTime(request.original_starts_at)}</p>
                  <strong className={styles.rescheduleTarget}>
                    {t("studentSchedule.reschedule.to")}: {formatDate(request.requested_starts_at)}
                  </strong>
                  <p>{formatTime(request.requested_starts_at)}</p>
                  {request.message && (
                    <p className={styles.requestMessage}>{request.message}</p>
                  )}
                </div>

                <div className={styles.requestCardActions}>
                  <span className={styles.pendingStatus}>
                    {t("studentSchedule.reschedule.pending")}
                  </span>
                  <button
                    type="button"
                    className={styles.cancelRequestButton}
                    onClick={() => handleCancelRescheduleRequest(request)}
                    disabled={cancellingRescheduleRequestId === request.id}
                  >
                    {cancellingRescheduleRequestId === request.id
                      ? t("studentSchedule.reschedule.cancel.cancelling")
                      : t("studentSchedule.reschedule.cancel.button")}
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>
      )}

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
                    {lesson.meeting_url ? (
                      financiallyRestricted ? (
                        <button
                          type="button"
                          className={`${styles.meetingButton} ${styles.meetingButtonDisabled}`}
                          disabled
                          title={t("studentSchedule.financialAccess.joinBlocked")}
                        >
                          {t("studentSchedule.joinMeeting", {
                            provider: getMeetingProviderLabel(lesson.meeting_url, t),
                          })}
                        </button>
                      ) : (
                        <a
                          href={lesson.meeting_url}
                          target="_blank"
                          rel="noreferrer"
                          className={styles.meetingButton}
                        >
                          {t("studentSchedule.joinMeeting", {
                            provider: getMeetingProviderLabel(lesson.meeting_url, t),
                          })}
                        </a>
                      )
                    ) : (
                      <span className={styles.noMeeting}>
                        {t("studentSchedule.noMeeting")}
                      </span>
                    )}

                    {currentTimeMs !== null &&
                      new Date(lesson.starts_at).getTime() > currentTimeMs && (
                      <>
                        <button
                          type="button"
                          className={styles.rescheduleButton}
                          onClick={() => handleOpenRescheduleForm(lesson)}
                          disabled={
                            financiallyRestricted ||
                            pendingCancellationLessonIds.has(lesson.id) ||
                            pendingRescheduleLessonIds.has(lesson.id)
                          }
                        >
                          {pendingRescheduleLessonIds.has(lesson.id)
                            ? t("studentSchedule.reschedule.pending")
                            : rescheduleLessonId === lesson.id
                              ? t("studentSchedule.reschedule.close")
                              : t("studentSchedule.reschedule.button")}
                        </button>

                        <button
                          type="button"
                          className={styles.cancelButton}
                          onClick={() => handleCancelLesson(lesson)}
                          disabled={
                            cancellingLessonId === lesson.id ||
                            pendingCancellationLessonIds.has(lesson.id) ||
                            pendingRescheduleLessonIds.has(lesson.id)
                          }
                        >
                          {cancellingLessonId === lesson.id
                            ? t("studentSchedule.cancel.cancelling")
                            : pendingCancellationLessonIds.has(lesson.id)
                              ? t("studentSchedule.cancel.pending")
                              : t("studentSchedule.cancel.button")}
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {rescheduleLessonId === lesson.id && (
                  <form
                    className={styles.requestForm}
                    onSubmit={(event) => handleCreateRescheduleRequest(event, lesson)}
                  >
                    <div className={styles.rescheduleCurrent}>
                      <span>{t("studentSchedule.reschedule.currentLesson")}</span>
                      <strong>
                        {formatDate(lesson.starts_at)} · {formatTime(lesson.starts_at)}
                      </strong>
                    </div>

                    <label className={`${styles.formField} ${styles.dateField}`}>
                      <span>{t("studentSchedule.reschedule.date")}</span>
                      <input
                        type="date"
                        value={rescheduleDate}
                        min={getTodayValue()}
                        onChange={(event) =>
                          handleRescheduleDateChange(lesson.id, event)
                        }
                      />
                    </label>

                    <div className={styles.formField}>
                      <span>{t("studentSchedule.reschedule.availableTime")}</span>
                      {rescheduleAvailabilityLoading ? (
                        <p className={styles.helperText}>
                          {t("studentSchedule.reschedule.loadingAvailability")}
                        </p>
                      ) : rescheduleAvailability.length === 0 ? (
                        <p className={styles.helperText}>
                          {t("studentSchedule.reschedule.noAvailability")}
                        </p>
                      ) : (
                        <div className={styles.slotGrid}>
                          {rescheduleAvailability.map((slot) => (
                            <button
                              key={slot.starts_at}
                              type="button"
                              className={`${styles.slotButton} ${
                                rescheduleSelectedSlot === slot.starts_at
                                  ? styles.slotButtonSelected
                                  : ""
                              }`}
                              onClick={() =>
                                setRescheduleSelectedSlot(slot.starts_at)
                              }
                            >
                              {formatTime(slot.starts_at)}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>

                    <label className={styles.formField}>
                      <span>{t("studentSchedule.reschedule.message")}</span>
                      <textarea
                        rows="3"
                        value={rescheduleMessage}
                        onChange={(event) => setRescheduleMessage(event.target.value)}
                        placeholder={t("studentSchedule.reschedule.messagePlaceholder")}
                      />
                    </label>

                    {rescheduleError && (
                      <div className={styles.error}>{rescheduleError}</div>
                    )}

                    <button
                      type="submit"
                      className={styles.submitRequestButton}
                      disabled={!rescheduleSelectedSlot || rescheduleSubmitting}
                    >
                      {rescheduleSubmitting
                        ? t("studentSchedule.reschedule.submitting")
                        : t("studentSchedule.reschedule.submit")}
                    </button>
                  </form>
                )}
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

  if (message.includes("CANCELLATION_REQUEST_ALREADY_PENDING")) {
    return t("studentSchedule.cancel.errors.alreadyPending");
  }

  if (message.includes("RESCHEDULE_REQUEST_PENDING")) {
    return t("studentSchedule.cancel.errors.reschedulePending");
  }

  if (message.includes("LESSON_NOT_SCHEDULED")) {
    return t("studentSchedule.cancel.errors.notScheduled");
  }

  if (message.includes("LESSON_NOT_FOUND")) {
    return t("studentSchedule.cancel.errors.notFound");
  }

  return t("studentSchedule.cancel.errors.generic");
};

const getExtraLessonRequestError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("STUDENT_LEARNING_PAUSED") ||
      message.includes("STUDENT_LEARNING_INACTIVE")) {
    return t("studentSchedule.lifecycle.restrictedAction");
  }
  if (message.includes("STUDENT_FINANCIAL_ACCESS_RESTRICTED")) {
    return t("studentSchedule.financialAccess.restrictedAction");
  }

  if (message.includes("SCHEDULE_BLOCK_CONFLICT")) {
    return t("studentSchedule.extraLesson.errors.scheduleBlocked");
  }

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

const getLessonReschedulePreviewError = (reason, noticeHours, t) => {
  if (reason === "RESCHEDULE_WINDOW_CLOSED") {
    return t("studentSchedule.reschedule.errors.windowClosed", {
      hours: noticeHours ?? 6,
    });
  }
  if (reason === "CANCELLATION_REQUEST_PENDING") {
    return t("studentSchedule.reschedule.errors.cancellationPending");
  }
  if (reason === "RESCHEDULE_REQUEST_PENDING") {
    return t("studentSchedule.reschedule.errors.alreadyPending");
  }
  if (reason === "LESSON_ALREADY_STARTED") {
    return t("studentSchedule.reschedule.errors.started");
  }
  if (reason === "LESSON_NOT_SCHEDULED") {
    return t("studentSchedule.reschedule.errors.notScheduled");
  }
  return t("studentSchedule.reschedule.errors.generic");
};

const getLessonRescheduleError = (error, t) => {
  const message = error?.message ?? "";

  if (message.includes("STUDENT_LEARNING_PAUSED") ||
      message.includes("STUDENT_LEARNING_INACTIVE")) {
    return t("studentSchedule.lifecycle.restrictedAction");
  }
  if (message.includes("STUDENT_FINANCIAL_ACCESS_RESTRICTED")) {
    return t("studentSchedule.financialAccess.restrictedAction");
  }

  if (message.includes("RESCHEDULE_WINDOW_CLOSED")) {
    return t("studentSchedule.reschedule.errors.windowClosedGeneric");
  }
  if (message.includes("CANCELLATION_REQUEST_PENDING")) {
    return t("studentSchedule.reschedule.errors.cancellationPending");
  }
  if (message.includes("RESCHEDULE_REQUEST_PENDING")) {
    return t("studentSchedule.reschedule.errors.alreadyPending");
  }
  if (message.includes("RESCHEDULE_TARGET_UNAVAILABLE")) {
    return t("studentSchedule.reschedule.errors.targetUnavailable");
  }
  if (message.includes("LESSON_ALREADY_STARTED")) {
    return t("studentSchedule.reschedule.errors.started");
  }
  if (message.includes("LESSON_NOT_SCHEDULED")) {
    return t("studentSchedule.reschedule.errors.notScheduled");
  }
  if (message.includes("LESSON_NOT_FOUND")) {
    return t("studentSchedule.reschedule.errors.notFound");
  }
  if (message.includes("REQUEST_ALREADY_RESOLVED")) {
    return t("studentSchedule.reschedule.errors.alreadyResolved");
  }
  return t("studentSchedule.reschedule.errors.generic");
};

export default StudentSchedule;
