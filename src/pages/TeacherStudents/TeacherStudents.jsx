import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { inviteStudent } from "../../features/students/api/studentInvitesApi";
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
  const intlLocale = getIntlLocale(i18n.resolvedLanguage || i18n.language);

  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteError, setInviteError] = useState("");

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
        const nextStudents = await fetchStudents();

        if (!cancelled) {
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

  const handleInvite = async (event) => {
    event.preventDefault();
    setInviteMessage("");
    setInviteError("");
    setIsInviting(true);

    try {
      const { data, error } = await inviteStudent({ email, fullName });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || "INVITE_FAILED");

      setInviteMessage(t("teacherStudents.invite.success"));
      setFullName("");
      setEmail("");
      const nextStudents = await fetchStudents();
      setStudents(nextStudents);
    } catch (error) {
      console.error("Student invite error:", error);
      setInviteError(error?.message || t("teacherStudents.errors.invite"));
    } finally {
      setIsInviting(false);
    }
  };

  const handleCloseInvite = () => {
    setIsInviteOpen(false);
    setInviteMessage("");
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
          onClick={() => setIsInviteOpen((current) => !current)}
        >
          {isInviteOpen ? t("common.close") : t("teacherStudents.invite.open")}
        </button>
      </div>

      {isInviteOpen && (
        <form className={styles.inviteForm} onSubmit={handleInvite}>
          <div className={styles.formHeading}>
            <h2>{t("teacherStudents.invite.title")}</h2>
            <p>{t("teacherStudents.invite.description")}</p>
          </div>

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

          {inviteMessage && (
            <p className={styles.successMessage}>{inviteMessage}</p>
          )}
          {inviteError && <p className={styles.errorMessage}>{inviteError}</p>}

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
                : t("teacherStudents.invite.submit")}
            </button>
          </div>
        </form>
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
