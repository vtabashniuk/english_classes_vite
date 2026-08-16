import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { getTimezone } from "../../constants/timezones";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";
import { getIntlLocale } from "../../utils/getIntlLocale";

import styles from "./TeacherRequests.module.css";

const TeacherRequests = () => {
  const { t, i18n } = useTranslation();
  const { profile } = useAuth();

  const [requests, setRequests] = useState([]);
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

  const intlLocale = getIntlLocale(i18n.resolvedLanguage || i18n.language);

  const timezoneConfig = getTimezone(scheduleTimezone);
  const timezoneLabel = timezoneConfig
    ? t(timezoneConfig.labelKey)
    : scheduleTimezone;

  const pendingRequests = useMemo(
    () => requests.filter((request) => request.status === "pending"),
    [requests],
  );

  const loadScheduleTimezone = async () => {
    if (!profile?.id) {
      return;
    }

    const { data, error } = await supabase
      .from("teacher_settings")
      .select("schedule_timezone")
      .eq("teacher_id", profile.id)
      .maybeSingle();

    if (error) {
      console.error("Teacher settings timezone load error:", error);
      return;
    }

    if (data?.schedule_timezone) {
      setScheduleTimezone(data.schedule_timezone);
    }
  };

  const loadRequests = async () => {
    const { data, error } = await supabase
      .from("lesson_requests")
      .select(
        "id, student_id, requested_starts_at, duration_minutes, message, status, created_at",
      )
      .eq("status", "pending")
      .order("requested_starts_at", { ascending: true });

    if (error) {
      throw error;
    }

    const nextRequests = data ?? [];
    setRequests(nextRequests);

    const studentIds = [...new Set(nextRequests.map((item) => item.student_id))];

    if (studentIds.length === 0) {
      setStudents({});
      return;
    }

    const { data: studentRows, error: studentsError } = await supabase
      .from("profiles")
      .select("id, full_name, email")
      .in("id", studentIds);

    if (studentsError) {
      throw studentsError;
    }

    setStudents(
      Object.fromEntries((studentRows ?? []).map((student) => [student.id, student])),
    );
  };

  const loadAll = async () => {
    try {
      setErrorMessage("");
      await Promise.all([loadScheduleTimezone(), loadRequests()]);
    } catch (error) {
      console.error("Teacher requests load error:", error);
      setErrorMessage(t("teacherRequests.errors.load"));
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
  }, [profile?.id, t]);

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

    if (message.includes("REQUEST_NOT_FOUND")) {
      return t("teacherRequests.errors.notFound");
    }

    return t("teacherRequests.errors.generic");
  };

  const handleApprove = async (request) => {
    const confirmed = window.confirm(
      t("teacherRequests.approveConfirm", {
        student: getStudentName(request),
        date: formatDate(request.requested_starts_at),
        time: formatTime(request.requested_starts_at),
      }),
    );

    if (!confirmed) {
      return;
    }

    try {
      setProcessingId(request.id);
      setErrorMessage("");
      setSuccessMessage("");
      setRejectingId(null);
      setRejectionComment("");

      const { error } = await supabase.rpc("approve_lesson_request", {
        p_request_id: request.id,
      });

      if (error) {
        throw error;
      }

      setSuccessMessage(t("teacherRequests.approveSuccess"));
      await loadRequests();
      window.dispatchEvent(new Event("lesson-requests-changed"));
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

      const { error } = await supabase.rpc("reject_lesson_request", {
        p_request_id: request.id,
        p_comment: rejectionComment.trim() || null,
      });

      if (error) {
        throw error;
      }

      setSuccessMessage(t("teacherRequests.rejectSuccess"));
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

  if (loading) {
    return (
      <section className={styles.page}>
        <div className={styles.state}>{t("teacherRequests.loading")}</div>
      </section>
    );
  }

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

      {pendingRequests.length === 0 ? (
        <div className={styles.emptyState}>
          <h2>{t("teacherRequests.emptyTitle")}</h2>
          <p>{t("teacherRequests.emptyDescription")}</p>
        </div>
      ) : (
        <div className={styles.list}>
          {pendingRequests.map((request) => {
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
                      <strong>{formatDate(request.requested_starts_at)}</strong>
                    </div>

                    <div>
                      <span>{t("teacherRequests.time")}</span>
                      <strong>{formatTime(request.requested_starts_at)}</strong>
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
                          setRejectionComment(event.target.value.slice(0, 500))
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
      )}
    </section>
  );
};

export default TeacherRequests;
