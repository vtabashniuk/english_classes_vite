import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, useParams } from "react-router-dom";

import { supabase } from "../../lib/supabase";
import { getIntlLocale } from "../../utils/getIntlLocale";

import styles from "./TeacherStudentDetails.module.css";

const TeacherStudentDetails = () => {
  const { studentId } = useParams();
  const { t, i18n } = useTranslation();
  const intlLocale = getIntlLocale(i18n.resolvedLanguage || i18n.language);

  const [student, setStudent] = useState(null);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const loadStudent = async () => {
      try {
        setLoading(true);
        setErrorMessage("");

        const { data, error } = await supabase
          .from("profiles")
          .select("id, email, full_name, phone, role, is_active, created_at")
          .eq("id", studentId)
          .eq("role", "student")
          .maybeSingle();

        if (error) throw error;

        if (!data) {
          setErrorMessage(t("teacherStudentDetails.errors.notFound"));
          return;
        }

        setStudent(data);
      } catch (error) {
        console.error("Student details load error:", error);
        setErrorMessage(t("teacherStudentDetails.errors.load"));
      } finally {
        setLoading(false);
      }
    };

    loadStudent();
  }, [studentId, t]);

  const formatDate = (dateString) =>
    new Intl.DateTimeFormat(intlLocale, {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(dateString));

  const backLink = (
    <Link to="/teacher-dashboard/students" className={styles.backLink}>
      ← {t("teacherStudentDetails.back")}
    </Link>
  );

  if (loading) {
    return (
      <section className={styles.page}>
        <p>{t("common.loading")}</p>
      </section>
    );
  }

  if (errorMessage) {
    return (
      <section className={styles.page}>
        {backLink}
        <p className={styles.error}>{errorMessage}</p>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      {backLink}

      <div className={styles.header}>
        <div className={styles.student}>
          <div className={styles.avatar}>
            {(student.full_name || student.email || "?").charAt(0).toUpperCase()}
          </div>

          <div>
            <div className={styles.titleRow}>
              <h1>{student.full_name || t("common.nameNotSpecified")}</h1>
              <span
                className={`${styles.status} ${
                  student.is_active ? styles.active : styles.inactive
                }`}
              >
                {student.is_active
                  ? t("common.active")
                  : t("common.inactive")}
              </span>
            </div>
            <p className={styles.email}>{student.email}</p>
          </div>
        </div>
      </div>

      <div className={styles.grid}>
        <article className={styles.card}>
          <h2>{t("teacherStudentDetails.contactInfo")}</h2>
          <dl className={styles.details}>
            <div>
              <dt>{t("common.email")}</dt>
              <dd>{student.email}</dd>
            </div>
            <div>
              <dt>{t("common.phone")}</dt>
              <dd>{student.phone || t("common.notSpecified")}</dd>
            </div>
            <div>
              <dt>{t("teacherStudentDetails.addedDate")}</dt>
              <dd>{formatDate(student.created_at)}</dd>
            </div>
          </dl>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>{t("teacherStudentDetails.balance")}</h2>
          </div>
          <div className={styles.placeholder}>
            <strong>—</strong>
            <span>{t("teacherStudentDetails.balancePlaceholder")}</span>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>{t("teacherStudentDetails.recurringSchedule")}</h2>
          </div>
          <div className={styles.placeholder}>
            <span>{t("teacherStudentDetails.recurringPlaceholder")}</span>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>{t("teacherStudentDetails.upcomingLessons")}</h2>
          </div>
          <div className={styles.placeholder}>
            <span>{t("teacherStudentDetails.upcomingPlaceholder")}</span>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>{t("teacherStudentDetails.assignments")}</h2>
          </div>
          <div className={styles.placeholder}>
            <span>{t("teacherStudentDetails.assignmentsPlaceholder")}</span>
          </div>
        </article>

        <article className={`${styles.card} ${styles.notesCard}`}>
          <div className={styles.cardHeader}>
            <h2>{t("teacherStudentDetails.privateNotes")}</h2>
          </div>
          <div className={styles.placeholder}>
            <span>{t("teacherStudentDetails.notesPlaceholder")}</span>
          </div>
        </article>
      </div>
    </section>
  );
};

export default TeacherStudentDetails;
