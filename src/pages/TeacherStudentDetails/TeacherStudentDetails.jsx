import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";

import { supabase } from "../../lib/supabase";

import styles from "./TeacherStudentDetails.module.css";

const TeacherStudentDetails = () => {
  const { studentId } = useParams();

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
          .select(
            "id, email, full_name, phone, role, is_active, created_at"
          )
          .eq("id", studentId)
          .eq("role", "student")
          .maybeSingle();

        if (error) {
          throw error;
        }

        if (!data) {
          setErrorMessage("Учня не знайдено.");
          return;
        }

        setStudent(data);
      } catch (error) {
        console.error(
          "Не вдалося завантажити учня:",
          error
        );

        setErrorMessage(
          "Не вдалося завантажити інформацію про учня."
        );
      } finally {
        setLoading(false);
      }
    };

    loadStudent();
  }, [studentId]);

  const formatDate = (dateString) => {
    return new Intl.DateTimeFormat("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(dateString));
  };

  if (loading) {
    return (
      <section className={styles.page}>
        <p>Завантаження...</p>
      </section>
    );
  }

  if (errorMessage) {
    return (
      <section className={styles.page}>
        <Link
          to="/teacher-dashboard/students"
          className={styles.backLink}
        >
          ← До списку учнів
        </Link>

        <p className={styles.error}>
          {errorMessage}
        </p>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <Link
        to="/teacher-dashboard/students"
        className={styles.backLink}
      >
        ← До списку учнів
      </Link>

      <div className={styles.header}>
        <div className={styles.student}>
          <div className={styles.avatar}>
            {(student.full_name || student.email || "?")
              .charAt(0)
              .toUpperCase()}
          </div>

          <div>
            <div className={styles.titleRow}>
              <h1>
                {student.full_name || "Ім’я не вказано"}
              </h1>

              <span
                className={`${styles.status} ${
                  student.is_active
                    ? styles.active
                    : styles.inactive
                }`}
              >
                {student.is_active
                  ? "Активний"
                  : "Неактивний"}
              </span>
            </div>

            <p className={styles.email}>
              {student.email}
            </p>
          </div>
        </div>
      </div>

      <div className={styles.grid}>
        <article className={styles.card}>
          <h2>Контактна інформація</h2>

          <dl className={styles.details}>
            <div>
              <dt>Email</dt>
              <dd>{student.email}</dd>
            </div>

            <div>
              <dt>Телефон</dt>
              <dd>
                {student.phone || "Не вказано"}
              </dd>
            </div>

            <div>
              <dt>Дата додавання</dt>
              <dd>
                {formatDate(student.created_at)}
              </dd>
            </div>
          </dl>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>Баланс</h2>
          </div>

          <div className={styles.placeholder}>
            <strong>—</strong>
            <span>
              Фінансові дані ще не підключені
            </span>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>Регулярний розклад</h2>
          </div>

          <div className={styles.placeholder}>
            <span>
              Регулярні заняття ще не налаштовані
            </span>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>Найближчі заняття</h2>
          </div>

          <div className={styles.placeholder}>
            <span>
              Запланованих занять поки немає
            </span>
          </div>
        </article>

        <article className={styles.card}>
          <div className={styles.cardHeader}>
            <h2>Завдання</h2>
          </div>

          <div className={styles.placeholder}>
            <span>
              Завдань поки немає
            </span>
          </div>
        </article>

        <article className={`${styles.card} ${styles.notesCard}`}>
          <div className={styles.cardHeader}>
            <h2>Приватні нотатки</h2>
          </div>

          <div className={styles.placeholder}>
            <span>
              Нотатки викладача ще не додані
            </span>
          </div>
        </article>
      </div>
    </section>
  );
};

export default TeacherStudentDetails;