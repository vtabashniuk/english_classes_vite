import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { inviteStudent } from "../../features/students/api/studentInvitesApi";
import {
  EMAIL_PASSWORD,
  GOOGLE_NO_EMAIL,
  isPendingGoogleInviteResult,
} from "../../features/students/lib/studentInvitationMethod";
import {
  listMyPendingGoogleStudentInvitations,
  cancelMyPendingGoogleStudentInvitation,
} from "../../features/students/api/teacherGoogleInvitationsApi";
import { GOOGLE_OAUTH_UI_ENABLED } from "../../features/auth/lib/googleOAuthConfig";
import { getInviteErrorMessage, getInviteSuccessMessageKey } from "../../features/students/lib/studentInviteFeedback";
import useToast from "../../shared/toast/useToast";
import { listTeacherPendingAssignmentCounts } from "../../features/assignments/api/assignmentsApi";
import { listTeacherStudentsLifecycle } from "../../features/studentLifecycle/api/studentLifecycleApi";
import { getIntlLocale } from "../../utils/getIntlLocale";

import styles from "./TeacherStudents.module.css";

const fetchStudents = async () => {
  const { data, error } = await listTeacherStudentsLifecycle();

  if (error) {
    throw error;
  }

  return data ?? [];
};

const TeacherStudents = () => {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const intlLocale = getIntlLocale(i18n.resolvedLanguage || i18n.language);

  const [students, setStudents] = useState([]);
  const [pendingCounts, setPendingCounts] = useState({});
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteError, setInviteError] = useState("");
  const [invitationMethod, setInvitationMethod] = useState(EMAIL_PASSWORD);
  const [pendingGoogleInvites, setPendingGoogleInvites] = useState([]);
  const [pendingGoogleLoading, setPendingGoogleLoading] = useState(GOOGLE_OAUTH_UI_ENABLED);
  const [pendingGoogleError, setPendingGoogleError] = useState("");
  const [cancellingInvitationId, setCancellingInvitationId] = useState(null);

  const groupedStudents = useMemo(
    () => ({
      active: students.filter(
        (student) =>
          student.learning_status === "active" &&
          !student.is_financially_blocked,
      ),
      debtors: students.filter(
        (student) =>
          student.learning_status === "active" &&
          student.is_financially_blocked,
      ),
      paused: students.filter((student) => student.learning_status === "paused"),
      inactive: students.filter(
        (student) => student.learning_status === "inactive",
      ),
    }),
    [students],
  );

  useEffect(() => {
    let cancelled = false;

    const initialize = async () => {
      try {
        const [nextStudents, pendingResult] = await Promise.all([
          fetchStudents(), listTeacherPendingAssignmentCounts(),
        ]);
        if (pendingResult.error) throw pendingResult.error;
        const nextCounts = Object.fromEntries((pendingResult.data ?? [])
          .map((row) => [row.student_id, Number(row.pending_count)]));

        if (!cancelled) {
          setPendingCounts(nextCounts);
          setStudents(nextStudents);
        }
      } catch (error) {
        console.error("Students load error:", error);

        if (!cancelled) {
          setErrorMessage(t("teacherStudents.errors.load"));
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

  // A Google-pending invitation is NOT an auth user/student until first sign-in.
  // Its list is independent from the list of existing students.
  const refreshPendingGoogleInvites = async () => {
    const { data, error } = await listMyPendingGoogleStudentInvitations();
    if (error) throw error;
    setPendingGoogleInvites(data ?? []);
    setPendingGoogleError("");
  };

  useEffect(() => {
    if (!GOOGLE_OAUTH_UI_ENABLED) return;
    let active = true;
    listMyPendingGoogleStudentInvitations()
      .then(({ data, error }) => {
        if (error) throw error;
        if (active) setPendingGoogleInvites(data ?? []);
      })
      .catch((error) => {
        console.error("Google invitations load error:", error);
        if (active) setPendingGoogleError(t("teacherStudents.googleInvitations.loadError"));
      })
      .finally(() => { if (active) setPendingGoogleLoading(false); });
    return () => { active = false; };
  }, [t]);

  const handleCancelGoogleInvite = async (invite) => {
    if (cancellingInvitationId) return;
    if (!window.confirm(t("teacherStudents.googleInvitations.confirmCancel", { email: invite.email }))) return;
    setCancellingInvitationId(invite.id);
    setPendingGoogleError("");
    try {
      const { data, error } = await cancelMyPendingGoogleStudentInvitation(invite.id);
      if (error) throw error;
      if (data !== true) throw new Error("INVITATION_NOT_PENDING");
      toast.success(t("teacherStudents.googleInvitations.cancelSuccess"));
      try { await refreshPendingGoogleInvites(); }
      catch (refreshError) {
        console.error("Google invitations refresh error:", refreshError);
        setPendingGoogleError(t("teacherStudents.googleInvitations.loadError"));
        // Never show an already-cancelled invitation as an active choice.
        setPendingGoogleInvites((items) => items.filter((item) => item.id !== invite.id));
      }
    } catch (error) {
      console.error("Google invitation cancellation error:", error);
      setPendingGoogleError(t("teacherStudents.googleInvitations.cancelError"));
    } finally {
      setCancellingInvitationId(null);
    }
  };

  const handleInvite = async (event) => {
    event.preventDefault();
    setInviteError("");
    setIsInviting(true);

    try {
      const method = GOOGLE_OAUTH_UI_ENABLED ? invitationMethod : EMAIL_PASSWORD;
      const { data, error } = await inviteStudent({ email, fullName, invitationMethod: method });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "INVITE_FAILED");

      const isGoogle = method === GOOGLE_NO_EMAIL;
      if (isGoogle && !isPendingGoogleInviteResult(data)) throw new Error("UNEXPECTED_GOOGLE_INVITE_RESPONSE");
      // A successful invitation must stay successful even if list refresh fails.
      toast.success(t(isGoogle ? "teacherStudents.invite.googleSuccess" : getInviteSuccessMessageKey(data)));
      setFullName("");
      setEmail("");

      if (isGoogle) {
        try { await refreshPendingGoogleInvites(); }
        catch (refreshError) {
          console.error("Google invitation refresh error:", refreshError);
          setPendingGoogleError(t("teacherStudents.googleInvitations.loadError"));
        }
      } else {
        try {
          const nextStudents = await fetchStudents();
          setStudents(nextStudents);
          setErrorMessage("");
        } catch (refreshError) {
          console.error("Students refresh after invitation error:", refreshError);
          setErrorMessage(t("teacherStudents.errors.load"));
        }
      }
    } catch (error) {
      console.error("Student invite error:", error);
      setInviteError(getInviteErrorMessage(error, t));
    } finally {
      setIsInviting(false);
    }
  };

  const handleCloseInvite = () => {
    setIsInviteOpen(false);
    setInviteError("");
  };

  const formatDate = (dateString) =>
    new Intl.DateTimeFormat(intlLocale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(dateString));

  const formatDateOnly = (dateString) =>
    new Intl.DateTimeFormat(intlLocale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(`${dateString}T12:00:00`));

  const renderStudentCard = (student) => {
    const statusKey =
      student.learning_status === "inactive"
        ? "inactive"
        : student.learning_status === "paused"
          ? "paused"
          : student.is_financially_blocked
            ? "debtor"
            : "active";

    return (
      <article key={student.student_id} className={styles.studentCard}>
        <div className={styles.studentTop}>
          <div className={styles.avatar}>
            {(student.full_name || student.email || "?").charAt(0).toUpperCase()}
          </div>

          <div className={styles.studentInfo}>
            <h2>{student.full_name || t("common.nameNotSpecified")}</h2>
            <p>{student.email}</p>
          </div>

          <span
            className={`${styles.status} ${
              statusKey === "active"
                ? styles.active
                : statusKey === "debtor"
                  ? styles.debtor
                  : statusKey === "paused"
                    ? styles.paused
                    : styles.inactive
            }`}
          >
            {t(`teacherStudents.status.${statusKey}`)}
          </span>
        </div>

        <div className={styles.studentDetails}>
          <div>
            <span>{t("common.phone")}</span>
            <strong>{student.phone || t("common.notSpecified")}</strong>
          </div>

          <div>
            <span>{t("teacherStudents.added")}</span>
            <strong>{formatDate(student.created_at)}</strong>
          </div>

          {statusKey === "paused" && student.pause_until && (
            <div>
              <span>{t("teacherStudents.pausePeriod")}</span>
              <strong>
                {student.pause_from
                  ? `${formatDateOnly(student.pause_from)} — ${formatDateOnly(student.pause_until)}`
                  : formatDateOnly(student.pause_until)}
              </strong>
            </div>
          )}
        </div>

        {(pendingCounts[student.student_id] ?? 0) > 0 && (
          <p className={styles.homeworkBadge}>
            {t("teacherAssignments.pendingCount", { count: pendingCounts[student.student_id] })}
          </p>
        )}
        <Link
          to={`/teacher-dashboard/students/${student.student_id}`}
          className={styles.detailsButton}
        >
          {t("teacherStudents.openProfile")}
        </Link>
      </article>
    );
  };

  const renderGroup = (status) => {
    const items = groupedStudents[status];
    if (!items.length) return null;

    return (
      <section className={styles.studentGroup} key={status}>
        <div className={styles.groupHeading}>
          <h2>{t(`teacherStudents.groups.${status}`)}</h2>
          <span>{items.length}</span>
        </div>
        <div className={styles.studentsGrid}>{items.map(renderStudentCard)}</div>
      </section>
    );
  };

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>{t("teacherStudents.title")}</h1>
          <p className={styles.subtitle}>
            {t("teacherStudents.count", { count: students.length })}
          </p>
        </div>

        <button
          type="button"
          className={styles.inviteButton}
          onClick={() => (isInviteOpen ? handleCloseInvite() : setIsInviteOpen(true))}
        >
          {isInviteOpen ? t("common.close") : t("teacherStudents.invite.open")}
        </button>
      </div>

      {isInviteOpen && (
        <form className={styles.inviteForm} onSubmit={handleInvite}>
          <div className={styles.formHeading}>
            <h2>{t("teacherStudents.invite.title")}</h2>
            <p>{t(invitationMethod === GOOGLE_NO_EMAIL && GOOGLE_OAUTH_UI_ENABLED
              ? "teacherStudents.invite.googleDescription"
              : "teacherStudents.invite.description")}</p>
          </div>

          {GOOGLE_OAUTH_UI_ENABLED && (
            <fieldset className={styles.methodChoices} disabled={isInviting}>
              <legend>{t("teacherStudents.invite.methodLabel")}</legend>
              <label className={styles.methodChoice}>
                <input type="radio" name="invitationMethod" value={EMAIL_PASSWORD}
                  checked={invitationMethod === EMAIL_PASSWORD}
                  onChange={() => setInvitationMethod(EMAIL_PASSWORD)} />
                <span>{t("teacherStudents.invite.emailMethod")}</span>
              </label>
              <label className={styles.methodChoice}>
                <input type="radio" name="invitationMethod" value={GOOGLE_NO_EMAIL}
                  checked={invitationMethod === GOOGLE_NO_EMAIL}
                  onChange={() => setInvitationMethod(GOOGLE_NO_EMAIL)} />
                <span>{t("teacherStudents.invite.googleMethod")}</span>
              </label>
            </fieldset>
          )}

          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>{t("teacherStudents.invite.name")}</span>
              <input
                type="text"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder={t("teacherStudents.invite.namePlaceholder")}
                required
              />
            </label>

            <label className={styles.field}>
              <span>{t("common.email")}</span>
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="student@example.com"
                required
              />
            </label>
          </div>

          {inviteError && (
            <p className={styles.errorMessage} role="alert">{inviteError}</p>
          )}

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={handleCloseInvite}
            >
              {t("common.cancel")}
            </button>

            <button
              type="submit"
              className={styles.submitButton}
              disabled={isInviting}
            >
              {isInviting
                ? t("common.sending")
                : t(invitationMethod === GOOGLE_NO_EMAIL && GOOGLE_OAUTH_UI_ENABLED
                  ? "teacherStudents.invite.googleSubmit"
                  : "teacherStudents.invite.submit")}
            </button>
          </div>
        </form>
      )}

      {GOOGLE_OAUTH_UI_ENABLED && (
        <section className={styles.pendingSection} aria-labelledby="pending-google-title">
          <div className={styles.groupHeading}>
            <h2 id="pending-google-title">{t("teacherStudents.googleInvitations.title")}</h2>
            <span>{pendingGoogleInvites.length}</span>
          </div>
          <p className={styles.pendingHint}>{t("teacherStudents.googleInvitations.description")}</p>
          {pendingGoogleLoading ? <p className={styles.state}>{t("common.loading")}</p> : (
            <>
              {pendingGoogleError && <p role="alert" className={styles.errorMessage}>{pendingGoogleError}</p>}
              {pendingGoogleInvites.length === 0 ? (
                <p className={styles.pendingEmpty}>{t("teacherStudents.googleInvitations.empty")}</p>
              ) : (
                <div className={styles.pendingList}>
                  {pendingGoogleInvites.map((invite) => (
                    <article className={styles.pendingItem} key={invite.id}>
                      <div className={styles.pendingInfo}>
                        <strong>{invite.full_name || invite.email}</strong>
                        <span>{invite.email}</span>
                        <small>{t("teacherStudents.googleInvitations.expires", {
                          date: new Date(invite.expires_at).toLocaleString(intlLocale),
                        })}</small>
                      </div>
                      <button type="button" className={styles.cancelButton}
                        disabled={cancellingInvitationId !== null}
                        onClick={() => handleCancelGoogleInvite(invite)}>
                        {cancellingInvitationId === invite.id
                          ? t("teacherStudents.googleInvitations.cancelling")
                          : t("teacherStudents.googleInvitations.cancel")}
                      </button>
                    </article>
                  ))}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {loading ? (
        <div className={styles.state}>{t("common.loading")}</div>
      ) : errorMessage ? (
        <div className={styles.errorMessage}>{errorMessage}</div>
      ) : students.length === 0 ? (
        <div className={styles.emptyState}>
          <h2>{t("teacherStudents.empty.title")}</h2>
          <p>{t("teacherStudents.empty.description")}</p>
        </div>
      ) : (
        <div className={styles.groups}>
          {renderGroup("active")}
          {renderGroup("debtors")}
          {renderGroup("paused")}
          {renderGroup("inactive")}
        </div>
      )}
    </section>
  );
};

export default TeacherStudents;
