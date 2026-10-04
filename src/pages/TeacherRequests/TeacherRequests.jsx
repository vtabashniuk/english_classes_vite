import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getTimezone } from "../../constants/timezones";
import { useAuth } from "../../context/useAuth";
import {
  approveLessonRequest,
  approveLessonRescheduleRequest,
  listPendingTeacherLessonRequests,
  rejectLessonRequest,
  rejectLessonRescheduleRequest,
} from "../../features/lessonRequests/api/lessonRequestsApi";
import {
  listPendingTeacherLessonCancellationRequests,
  resolveLessonCancellationRequest,
} from "../../features/lessons/api/lessonsApi";
import { getStudentsByIds } from "../../features/profiles/api/profilesApi";
import { getTeacherTimezone } from "../../features/settings/api/teacherSettingsApi";
import { formatFinanceMoney } from "../../utils/formatFinanceMoney";
import { getIntlLocale } from "../../utils/getIntlLocale";

import styles from "./TeacherRequests.module.css";

const fetchTeacherScheduleTimezone = async (teacherId) => {
  if (!teacherId) {
    return null;
  }

  const { data, error } = await getTeacherTimezone(teacherId);

  if (error) {
    console.error("Teacher settings timezone load error:", error);
    return null;
  }

  return data?.schedule_timezone ?? null;
};

const fetchPendingRequestsWithStudents = async () => {
  const [
    { data: lessonRequestRows, error: lessonRequestsError },
    { data: cancellationRows, error: cancellationError },
  ] = await Promise.all([
    listPendingTeacherLessonRequests(),
    listPendingTeacherLessonCancellationRequests(),
  ]);

  if (lessonRequestsError) {
    throw lessonRequestsError;
  }

  if (cancellationError) {
    throw cancellationError;
  }

  const lessonRequests = lessonRequestRows ?? [];
  const cancellationRequests = cancellationRows ?? [];
  const studentIds = [
    ...new Set(
      [...lessonRequests, ...cancellationRequests].map(
        (item) => item.student_id,
      ),
    ),
  ];

  if (studentIds.length === 0) {
    return {
      lessonRequests,
      cancellationRequests,
      students: {},
    };
  }

  const { data: studentRows, error: studentsError } =
    await getStudentsByIds(studentIds);

  if (studentsError) {
    throw studentsError;
  }

  return {
    lessonRequests,
    cancellationRequests,
    students: Object.fromEntries(
      (studentRows ?? []).map((student) => [student.id, student]),
    ),
  };
};

const TeacherRequests = () => {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const [requests, setRequests] = useState([]);
  const [cancellationRequests, setCancellationRequests] = useState([]);
  const [students, setStudents] = useState({});
  const [scheduleTimezone, setScheduleTimezone] = useState(
    profile?.timezone || "Europe/Kyiv",
  );
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");
  const [processingId, setProcessingId] = useState(null);
  const [rejectingId, setRejectingId] = useState(null);
  const [rejectionComment, setRejectionComment] = useState("");
  const [resolvingCancellationId, setResolvingCancellationId] = useState(null);
  const [waiverRequestId, setWaiverRequestId] = useState(null);
  const [waiverReason, setWaiverReason] = useState("");
  const [currentTimeMs, setCurrentTimeMs] = useState(null);

  const language = i18n.resolvedLanguage || i18n.language;
  const intlLocale = getIntlLocale(language);

  const timezoneConfig = getTimezone(scheduleTimezone);
  const timezoneLabel = timezoneConfig
    ? t(timezoneConfig.labelKey)
    : scheduleTimezone;

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

  const pendingCancellationRequests = useMemo(
    () =>
      cancellationRequests.filter((request) => request.status === "pending"),
    [cancellationRequests],
  );

  const loadRequests = async () => {
    const next = await fetchPendingRequestsWithStudents();
    setRequests(next.lessonRequests);
    setCancellationRequests(next.cancellationRequests);
    setStudents(next.students);
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
        const [nextTimezone, next] = await Promise.all([
          fetchTeacherScheduleTimezone(profile?.id),
          fetchPendingRequestsWithStudents(),
        ]);

        if (!cancelled) {
          setErrorMessage("");

          if (nextTimezone) {
            setScheduleTimezone(nextTimezone);
          }

          setRequests(next.lessonRequests);
          setCancellationRequests(next.cancellationRequests);
          setStudents(next.students);
        }
      } catch (error) {
        console.error("Teacher requests load error:", error);

        if (!cancelled) {
          setErrorMessage(t("teacherRequests.errors.load"));
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
  }, [profile?.id, t]);

  useEffect(() => {
    let cancelled = false;

    const handleFocus = async () => {
      try {
        const next = await fetchPendingRequestsWithStudents();

        if (!cancelled) {
          setRequests(next.lessonRequests);
          setCancellationRequests(next.cancellationRequests);
          setStudents(next.students);
        }
      } catch (error) {
        console.error("Teacher requests refresh error:", error);
      }
    };

    window.addEventListener("focus", handleFocus);

    return () => {
      cancelled = true;
      window.removeEventListener("focus", handleFocus);
    };
  }, []);

  const formatDate = (value) =>
    new Intl.DateTimeFormat(intlLocale, {
      timeZone: scheduleTimezone,
      weekday: "long",
      day: "2-digit",
      month: "long",
      year: "numeric",
    }).format(new Date(value));

  const formatTime = (value) =>
    new Intl.DateTimeFormat(intlLocale, {
      timeZone: scheduleTimezone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    }).format(new Date(value));

  const formatLeadTime = (minutesValue) => {
    const totalMinutes = Math.max(0, Number(minutesValue) || 0);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    return t("teacherRequests.cancellation.leadTime", {
      hours,
      minutes: String(minutes).padStart(2, "0"),
    });
  };

  const getStudentName = (request) => {
    const student = students[request.student_id];

    return (
      student?.full_name?.trim() ||
      student?.email ||
      t("teacherRequests.unknownStudent")
    );
  };

  const getRequestError = (error) => {
    const message = error?.message || "";

    if (message.includes("LESSON_TIME_CONFLICT")) {
      return t("teacherRequests.errors.lessonConflict");
    }

    if (message.includes("REQUEST_ALREADY_RESOLVED")) {
      return t("teacherRequests.errors.alreadyResolved");
    }

    if (message.includes("REQUEST_TIME_PASSED")) {
      return t("teacherRequests.errors.timePassed");
    }

    if (message.includes("RESCHEDULE_REQUEST_STALE")) {
      return t("teacherRequests.reschedule.errors.stale");
    }

    if (message.includes("RESCHEDULE_TARGET_UNAVAILABLE")) {
      return t("teacherRequests.reschedule.errors.targetUnavailable");
    }

    if (message.includes("LESSON_ALREADY_STARTED")) {
      return t("teacherRequests.reschedule.errors.started");
    }

    if (message.includes("CANCELLATION_REQUEST_PENDING")) {
      return t("teacherRequests.reschedule.errors.cancellationPending");
    }

    if (
      message.includes("NON_WORKING_DAY") ||
      message.includes("OUTSIDE_WORKING_HOURS") ||
      message.includes("INVALID_TIME_SLOT") ||
      message.includes("SCHEDULE_BLOCK_CONFLICT")
    ) {
      return t("teacherRequests.errors.scheduleUnavailable");
    }


    if (message.includes("REQUEST_NOT_FOUND")) {
      return t("teacherRequests.errors.notFound");
    }

    return t("teacherRequests.errors.generic");
  };

  const getCancellationError = (error) => {
    const message = error?.message || "";

    if (message.includes("WAIVER_REASON_REQUIRED")) {
      return t("teacherRequests.cancellation.errors.waiverReason");
    }

    if (message.includes("LESSON_PRICE_NOT_SET")) {
      return t("teacherRequests.cancellation.errors.priceMissing");
    }

    if (message.includes("CANCELLATION_REQUEST_NOT_PENDING")) {
      return t("teacherRequests.cancellation.errors.notPending");
    }

    if (message.includes("LESSON_ALREADY_CANCELLED")) {
      return t("teacherRequests.cancellation.errors.alreadyCancelled");
    }

    if (message.includes("LESSON_ALREADY_STARTED_CANNOT_BE_CANCELLED")) {
      return t("teacherRequests.cancellation.errors.started");
    }

    return t("teacherRequests.cancellation.errors.generic");
  };

  const handleApprove = async (request) => {
    const isReschedule = request.request_type === "reschedule";
    const confirmed = window.confirm(
      isReschedule
        ? t("teacherRequests.reschedule.approveConfirm", {
            student: getStudentName(request),
            oldDate: formatDate(request.original_starts_at),
            oldTime: formatTime(request.original_starts_at),
            date: formatDate(request.requested_starts_at),
            time: formatTime(request.requested_starts_at),
          })
        : t("teacherRequests.approveConfirm", {
            student: getStudentName(request),
            date: formatDate(request.requested_starts_at),
            time: formatTime(request.requested_starts_at),
          }),
    );

    if (!confirmed) return;

    try {
      setProcessingId(request.id);
      setErrorMessage("");
      setSuccessMessage("");
      setRejectingId(null);
      setRejectionComment("");

      const { error } = isReschedule
        ? await approveLessonRescheduleRequest(request.id)
        : await approveLessonRequest(request.id);

      if (error) throw error;

      setSuccessMessage(
        t(
          isReschedule
            ? "teacherRequests.reschedule.approveSuccess"
            : "teacherRequests.approveSuccess",
        ),
      );
      await loadRequests();
      window.dispatchEvent(new Event("lesson-requests-changed"));
      window.dispatchEvent(new Event("notifications-changed"));
    } catch (error) {
      console.error("Approve lesson request error:", error);
      setErrorMessage(getRequestError(error));
    } finally {
      setProcessingId(null);
    }
  };

  const openRejectForm = (requestId) => {
    setRejectingId(requestId);
    setRejectionComment("");
    setErrorMessage("");
    setSuccessMessage("");
  };

  const closeRejectForm = () => {
    setRejectingId(null);
    setRejectionComment("");
  };

  const handleReject = async (request) => {
    try {
      setProcessingId(request.id);
      setErrorMessage("");
      setSuccessMessage("");

      const rejectAction =
        request.request_type === "reschedule"
          ? rejectLessonRescheduleRequest
          : rejectLessonRequest;

      const { error } = await rejectAction({
        requestId: request.id,
        comment: rejectionComment.trim() || null,
      });

      if (error) {
        throw error;
      }

      setSuccessMessage(
        t(
          request.request_type === "reschedule"
            ? "teacherRequests.reschedule.rejectSuccess"
            : "teacherRequests.rejectSuccess",
        ),
      );
      closeRejectForm();
      await loadRequests();
      window.dispatchEvent(new Event("lesson-requests-changed"));
    } catch (error) {
      console.error("Reject lesson request error:", error);

      if ((error?.message || "").includes("COMMENT_TOO_LONG")) {
        setErrorMessage(t("teacherRequests.errors.commentTooLong"));
      } else {
        setErrorMessage(getRequestError(error));
      }
    } finally {
      setProcessingId(null);
    }
  };

  const handleResolveCancellation = async ({
    request,
    action,
    waiverReasonValue = null,
  }) => {
    try {
      setResolvingCancellationId(request.id);
      setErrorMessage("");
      setSuccessMessage("");

      const { error } = await resolveLessonCancellationRequest({
        requestId: request.id,
        action,
        waiverReason: waiverReasonValue,
      });

      if (error) {
        throw error;
      }

      const successKey =
        action === "reject"
          ? "teacherRequests.cancellation.rejectSuccess"
          : action === "cancel_charge"
            ? "teacherRequests.cancellation.chargeSuccess"
            : action === "cancel_waive"
              ? "teacherRequests.cancellation.waiveSuccess"
              : "teacherRequests.cancellation.cancelSuccess";

      setSuccessMessage(t(successKey));
      setWaiverRequestId(null);
      setWaiverReason("");
      await loadRequests();
      window.dispatchEvent(new Event("lesson-requests-changed"));
      window.dispatchEvent(new Event("notifications-changed"));
    } catch (error) {
      console.error("Resolve cancellation request error:", error);
      setErrorMessage(getCancellationError(error));
    } finally {
      setResolvingCancellationId(null);
    }
  };

  if (loading) {
    return (
      <section className={styles.page}>
        <div className={styles.state}>{t("teacherRequests.loading")}</div>
      </section>
    );
  }

  const hasAnyRequests =
    pendingExtraRequests.length > 0 ||
    pendingRescheduleRequests.length > 0 ||
    pendingCancellationRequests.length > 0;

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{t("teacherRequests.title")}</h1>
          <p>{t("teacherRequests.description")}</p>
        </div>

        <div className={styles.timezone}>
          <span>{t("teacherRequests.timezone")}</span>
          <strong>{timezoneLabel}</strong>
        </div>
      </header>

      {errorMessage && <div className={styles.error}>{errorMessage}</div>}
      {successMessage && <div className={styles.success}>{successMessage}</div>}

      {!hasAnyRequests && (
        <div className={styles.emptyState}>
          <h2>{t("teacherRequests.emptyTitle")}</h2>
          <p>{t("teacherRequests.emptyDescription")}</p>
        </div>
      )}

      {pendingCancellationRequests.length > 0 && (
        <section className={styles.requestSection}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>{t("teacherRequests.cancellation.sectionTitle")}</h2>
              <p>{t("teacherRequests.cancellation.sectionDescription")}</p>
            </div>
            <span className={styles.sectionCount}>
              {pendingCancellationRequests.length}
            </span>
          </div>

          <div className={styles.list}>
            {pendingCancellationRequests.map((request) => {
              const lesson = request.lessons;
              const isResolving = resolvingCancellationId === request.id;
              const isWaiverOpen = waiverRequestId === request.id;
              const priceAmountMinor = Number(lesson?.price_amount_minor);
              const priceCurrency = lesson?.price_currency;
              const hasPrice =
                Number.isFinite(priceAmountMinor) && Boolean(priceCurrency);
              const amount = hasPrice
                ? formatFinanceMoney(
                    priceAmountMinor,
                    priceCurrency,
                    language,
                  )
                : "—";
              const lessonAlreadyStarted =
                currentTimeMs !== null && lesson?.starts_at
                  ? new Date(lesson.starts_at).getTime() <= currentTimeMs
                  : false;
              const paymentDecisionPending =
                request.is_late &&
                lesson?.status === "cancelled" &&
                lesson?.cancelled_by === "student" &&
                lesson?.cancellation_request_id === request.id &&
                lesson?.cancellation_charge_mode == null;

              return (
                <article key={request.id} className={styles.card}>
                  <div className={styles.cardMain}>
                    <div className={styles.studentRow}>
                      <div>
                        <span className={styles.eyebrow}>
                          {t("teacherRequests.student")}
                        </span>
                        <h2>{getStudentName(request)}</h2>
                      </div>

                      <span
                        className={`${styles.status} ${
                          request.is_late ? styles.lateStatus : ""
                        }`}
                      >
                        {request.is_late
                          ? t("teacherRequests.cancellation.late")
                          : t("teacherRequests.cancellation.early")}
                      </span>
                    </div>

                    <div className={styles.lessonMeta}>
                      <div>
                        <span>{t("teacherRequests.date")}</span>
                        <strong>
                          {lesson?.starts_at
                            ? formatDate(lesson.starts_at)
                            : "—"}
                        </strong>
                      </div>
                      <div>
                        <span>{t("teacherRequests.time")}</span>
                        <strong>
                          {lesson?.starts_at
                            ? formatTime(lesson.starts_at)
                            : "—"}
                        </strong>
                      </div>
                      <div>
                        <span>{t("teacherRequests.duration")}</span>
                        <strong>
                          {t("teacherRequests.minutes", {
                            count: lesson?.duration_minutes ?? 0,
                          })}
                        </strong>
                      </div>
                    </div>

                    <div
                      className={`${styles.cancellationRule} ${
                        request.is_late ? styles.lateRule : ""
                      }`}
                    >
                      {request.is_late
                        ? t("teacherRequests.cancellation.lateRule", {
                            time: formatLeadTime(
                              request.minutes_before_start,
                            ),
                            amount,
                          })
                        : t("teacherRequests.cancellation.earlyRule", {
                            time: formatLeadTime(
                              request.minutes_before_start,
                            ),
                          })}
                    </div>

                    {request.reason && (
                      <div className={styles.studentComment}>
                        <span>
                          {t("teacherRequests.cancellation.studentReason")}
                        </span>
                        <p>{request.reason}</p>
                      </div>
                    )}

                    {request.is_late && !hasPrice && (
                      <p className={styles.inlineWarning}>
                        {t("teacherRequests.cancellation.priceMissing")}
                      </p>
                    )}
                  </div>

                  {isWaiverOpen ? (
                    <div className={styles.rejectPanel}>
                      <label className={styles.commentField}>
                        <span>
                          {t("teacherRequests.cancellation.waiverReason")}
                        </span>
                        <textarea
                          value={waiverReason}
                          onChange={(event) =>
                            setWaiverReason(event.target.value)
                          }
                          rows={3}
                          disabled={isResolving}
                        />
                      </label>

                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.approveButton}
                          disabled={
                            isResolving || waiverReason.trim().length === 0
                          }
                          onClick={() =>
                            handleResolveCancellation({
                              request,
                              action: "cancel_waive",
                              waiverReasonValue: waiverReason.trim(),
                            })
                          }
                        >
                          {isResolving
                            ? t("teacherRequests.processing")
                            : t(
                                "teacherRequests.cancellation.confirmWaive",
                              )}
                        </button>
                        <button
                          type="button"
                          className={styles.cancelButton}
                          disabled={isResolving}
                          onClick={() => {
                            setWaiverRequestId(null);
                            setWaiverReason("");
                          }}
                        >
                          {t("teacherRequests.cancel")}
                        </button>
                      </div>
                    </div>
                  ) : lessonAlreadyStarted && !request.is_late ? (
                    <p className={styles.inlineWarning}>
                      {t(
                        "teacherRequests.cancellation.earlyAutoCancellation",
                      )}
                    </p>
                  ) : (
                    <>
                      {lessonAlreadyStarted && request.is_late && (
                        <p className={styles.inlineWarning}>
                          {t(
                            paymentDecisionPending
                              ? "teacherRequests.cancellation.paymentDecisionPending"
                              : "teacherRequests.cancellation.lateAutoCancellation",
                          )}
                        </p>
                      )}

                      <div className={styles.actions}>
                        {request.is_late ? (
                          <>
                            <button
                              type="button"
                              className={styles.rejectConfirmButton}
                              disabled={isResolving || !hasPrice}
                              onClick={() =>
                                handleResolveCancellation({
                                  request,
                                  action: "cancel_charge",
                                })
                              }
                            >
                              {isResolving
                                ? t("teacherRequests.processing")
                                : t(
                                    lessonAlreadyStarted
                                      ? "teacherRequests.cancellation.chargeAfterAutoCancellation"
                                      : "teacherRequests.cancellation.cancelWithCharge",
                                  )}
                            </button>
                            <button
                              type="button"
                              className={styles.approveButton}
                              disabled={isResolving}
                              onClick={() => {
                                setWaiverRequestId(request.id);
                                setWaiverReason("");
                              }}
                            >
                              {t(
                                lessonAlreadyStarted
                                  ? "teacherRequests.cancellation.waiveAfterAutoCancellation"
                                  : "teacherRequests.cancellation.cancelWithoutCharge",
                              )}
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className={styles.approveButton}
                            disabled={isResolving}
                            onClick={() =>
                              handleResolveCancellation({
                                request,
                                action: "cancel",
                              })
                            }
                          >
                            {isResolving
                              ? t("teacherRequests.processing")
                              : t(
                                  "teacherRequests.cancellation.cancelLesson",
                                )}
                          </button>
                        )}

                        {!lessonAlreadyStarted && (
                          <button
                            type="button"
                            className={styles.rejectButton}
                            disabled={isResolving}
                            onClick={() =>
                              handleResolveCancellation({
                                request,
                                action: "reject",
                              })
                            }
                          >
                            {t("teacherRequests.cancellation.reject")}
                          </button>
                        )}
                      </div>
                    </>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {pendingRescheduleRequests.length > 0 && (
        <section className={styles.requestSection}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>{t("teacherRequests.reschedule.sectionTitle")}</h2>
              <p>{t("teacherRequests.reschedule.sectionDescription")}</p>
            </div>
            <span className={styles.sectionCount}>
              {pendingRescheduleRequests.length}
            </span>
          </div>

          <div className={styles.list}>
            {pendingRescheduleRequests.map((request) => {
              const isProcessing = processingId === request.id;
              const isRejecting = rejectingId === request.id;

              return (
                <article key={request.id} className={styles.card}>
                  <div className={styles.cardMain}>
                    <div className={styles.studentRow}>
                      <div>
                        <span className={styles.eyebrow}>
                          {t("teacherRequests.student")}
                        </span>
                        <h2>{getStudentName(request)}</h2>
                      </div>
                      <span className={styles.status}>
                        {t("teacherRequests.pending")}
                      </span>
                    </div>

                    <div className={styles.lessonMeta}>
                      <div>
                        <span>{t("teacherRequests.reschedule.current")}</span>
                        <strong>{formatDate(request.original_starts_at)}</strong>
                        <small>{formatTime(request.original_starts_at)}</small>
                      </div>
                      <div>
                        <span>{t("teacherRequests.reschedule.requested")}</span>
                        <strong>{formatDate(request.requested_starts_at)}</strong>
                        <small>{formatTime(request.requested_starts_at)}</small>
                      </div>
                      <div>
                        <span>{t("teacherRequests.duration")}</span>
                        <strong>
                          {t("teacherRequests.minutes", {
                            count: request.duration_minutes,
                          })}
                        </strong>
                      </div>
                    </div>

                    {request.message && (
                      <div className={styles.studentComment}>
                        <span>{t("teacherRequests.studentComment")}</span>
                        <p>{request.message}</p>
                      </div>
                    )}
                  </div>

                  {!isRejecting ? (
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.approveButton}
                        onClick={() => handleApprove(request)}
                        disabled={isProcessing}
                      >
                        {isProcessing
                          ? t("teacherRequests.processing")
                          : t("teacherRequests.reschedule.approve")}
                      </button>
                      <button
                        type="button"
                        className={styles.rejectButton}
                        onClick={() => openRejectForm(request.id)}
                        disabled={isProcessing}
                      >
                        {t("teacherRequests.reject")}
                      </button>
                    </div>
                  ) : (
                    <div className={styles.rejectPanel}>
                      <label className={styles.commentField}>
                        <span>{t("teacherRequests.rejectionComment")}</span>
                        <textarea
                          value={rejectionComment}
                          onChange={(event) =>
                            setRejectionComment(event.target.value.slice(0, 500))
                          }
                          maxLength={500}
                          rows={3}
                          placeholder={t("teacherRequests.rejectionCommentPlaceholder")}
                          disabled={isProcessing}
                        />
                      </label>
                      <div className={styles.commentCounter}>
                        {rejectionComment.length}/500
                      </div>
                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.rejectConfirmButton}
                          onClick={() => handleReject(request)}
                          disabled={isProcessing}
                        >
                          {isProcessing
                            ? t("teacherRequests.processing")
                            : t("teacherRequests.rejectConfirm")}
                        </button>
                        <button
                          type="button"
                          className={styles.cancelButton}
                          onClick={closeRejectForm}
                          disabled={isProcessing}
                        >
                          {t("teacherRequests.cancel")}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}

      {pendingExtraRequests.length > 0 && (
        <section className={styles.requestSection}>
          <div className={styles.sectionHeading}>
            <div>
              <h2>{t("teacherRequests.extraLessonSectionTitle")}</h2>
              <p>{t("teacherRequests.extraLessonSectionDescription")}</p>
            </div>
            <span className={styles.sectionCount}>{pendingExtraRequests.length}</span>
          </div>

          <div className={styles.list}>
            {pendingExtraRequests.map((request) => {
              const isProcessing = processingId === request.id;
              const isRejecting = rejectingId === request.id;

              return (
                <article key={request.id} className={styles.card}>
                  <div className={styles.cardMain}>
                    <div className={styles.studentRow}>
                      <div>
                        <span className={styles.eyebrow}>
                          {t("teacherRequests.student")}
                        </span>
                        <h2>{getStudentName(request)}</h2>
                      </div>

                      <span className={styles.status}>
                        {t("teacherRequests.pending")}
                      </span>
                    </div>

                    <div className={styles.lessonMeta}>
                      <div>
                        <span>{t("teacherRequests.date")}</span>
                        <strong>
                          {formatDate(request.requested_starts_at)}
                        </strong>
                      </div>

                      <div>
                        <span>{t("teacherRequests.time")}</span>
                        <strong>
                          {formatTime(request.requested_starts_at)}
                        </strong>
                      </div>

                      <div>
                        <span>{t("teacherRequests.duration")}</span>
                        <strong>
                          {t("teacherRequests.minutes", {
                            count: request.duration_minutes,
                          })}
                        </strong>
                      </div>
                    </div>

                    {request.message && (
                      <div className={styles.studentComment}>
                        <span>{t("teacherRequests.studentComment")}</span>
                        <p>{request.message}</p>
                      </div>
                    )}
                  </div>

                  {!isRejecting ? (
                    <div className={styles.actions}>
                      <button
                        type="button"
                        className={styles.approveButton}
                        onClick={() => handleApprove(request)}
                        disabled={isProcessing}
                      >
                        {isProcessing
                          ? t("teacherRequests.processing")
                          : t("teacherRequests.approve")}
                      </button>

                      <button
                        type="button"
                        className={styles.rejectButton}
                        onClick={() => openRejectForm(request.id)}
                        disabled={isProcessing}
                      >
                        {t("teacherRequests.reject")}
                      </button>
                    </div>
                  ) : (
                    <div className={styles.rejectPanel}>
                      <label className={styles.commentField}>
                        <span>{t("teacherRequests.rejectionComment")}</span>
                        <textarea
                          value={rejectionComment}
                          onChange={(event) =>
                            setRejectionComment(
                              event.target.value.slice(0, 500),
                            )
                          }
                          maxLength={500}
                          rows={3}
                          placeholder={t(
                            "teacherRequests.rejectionCommentPlaceholder",
                          )}
                          disabled={isProcessing}
                        />
                      </label>

                      <div className={styles.commentCounter}>
                        {rejectionComment.length}/500
                      </div>

                      <div className={styles.actions}>
                        <button
                          type="button"
                          className={styles.rejectConfirmButton}
                          onClick={() => handleReject(request)}
                          disabled={isProcessing}
                        >
                          {isProcessing
                            ? t("teacherRequests.processing")
                            : t("teacherRequests.rejectConfirm")}
                        </button>

                        <button
                          type="button"
                          className={styles.cancelButton}
                          onClick={closeRejectForm}
                          disabled={isProcessing}
                        >
                          {t("teacherRequests.cancel")}
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>
        </section>
      )}
    </section>
  );
};

export default TeacherRequests;
