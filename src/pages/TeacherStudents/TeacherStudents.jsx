import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { supabase } from "../../lib/supabase";

import styles from "./TeacherStudents.module.css";

const TeacherStudents = () => {
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  const [isInviteOpen, setIsInviteOpen] = useState(false);
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [isInviting, setIsInviting] = useState(false);
  const [inviteMessage, setInviteMessage] = useState("");
  const [inviteError, setInviteError] = useState("");

  const loadStudents = async () => {
    try {
      setLoading(true);
      setErrorMessage("");

      const { data, error } = await supabase
        .from("profiles")
        .select("id, email, full_name, phone, is_active, created_at")
        .eq("role", "student")
        .order("full_name", { ascending: true });

      if (error) {
        throw error;
      }

      setStudents(data ?? []);
    } catch (error) {
      console.error("Не вдалося завантажити учнів:", error);

      setErrorMessage("Не вдалося завантажити список учнів.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadStudents();
  }, []);

  const handleInvite = async (event) => {
    event.preventDefault();

    setInviteMessage("");
    setInviteError("");
    setIsInviting(true);

    try {
      const { data, error } = await supabase.functions.invoke(
        "invite-student",
        {
          body: {
            email,
            fullName,
          },
        },
      );

      if (error) {
        throw error;
      }

      if (!data?.success) {
        throw new Error(data?.error || "Не вдалося запросити учня.");
      }

      setInviteMessage("Запрошення успішно надіслано.");
      setFullName("");
      setEmail("");

      await loadStudents();
    } catch (error) {
      console.error("Помилка запрошення:", error);

      setInviteError(
        error instanceof Error ? error.message : "Не вдалося запросити учня.",
      );
    } finally {
      setIsInviting(false);
    }
  };

  const handleCloseInvite = () => {
    setIsInviteOpen(false);
    setInviteMessage("");
    setInviteError("");
  };

  const formatDate = (dateString) => {
    return new Intl.DateTimeFormat("uk-UA", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    }).format(new Date(dateString));
  };

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>Учні</h1>

          <p className={styles.subtitle}>Кількість учнів: {students.length}</p>
        </div>

        <button
          type="button"
          className={styles.inviteButton}
          onClick={() => setIsInviteOpen((current) => !current)}
        >
          {isInviteOpen ? "Закрити" : "+ Запросити учня"}
        </button>
      </div>

      {isInviteOpen && (
        <form className={styles.inviteForm} onSubmit={handleInvite}>
          <div className={styles.formHeading}>
            <h2>Запросити нового учня</h2>
            <p>Учень отримає email із посиланням для створення пароля.</p>
          </div>

          <div className={styles.formGrid}>
            <label className={styles.field}>
              <span>Ім’я учня</span>

              <input
                type="text"
                value={fullName}
                onChange={(event) => setFullName(event.target.value)}
                placeholder="Наприклад, Іван Петренко"
                required
              />
            </label>

            <label className={styles.field}>
              <span>Email</span>

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
              Скасувати
            </button>

            <button
              type="submit"
              className={styles.submitButton}
              disabled={isInviting}
            >
              {isInviting ? "Надсилання..." : "Надіслати запрошення"}
            </button>
          </div>
        </form>
      )}

      {loading ? (
        <div className={styles.state}>Завантаження...</div>
      ) : errorMessage ? (
        <div className={styles.errorMessage}>{errorMessage}</div>
      ) : students.length === 0 ? (
        <div className={styles.emptyState}>
          <h2>Учнів поки немає</h2>

          <p>Запросіть першого учня, щоб почати роботу.</p>
        </div>
      ) : (
        <div className={styles.studentsGrid}>
          {students.map((student) => (
            <article key={student.id} className={styles.studentCard}>
              <div className={styles.studentTop}>
                <div className={styles.avatar}>
                  {(student.full_name || student.email || "?")
                    .charAt(0)
                    .toUpperCase()}
                </div>

                <div className={styles.studentInfo}>
                  <h2>{student.full_name || "Ім’я не вказано"}</h2>

                  <p>{student.email}</p>
                </div>

                <span
                  className={`${styles.status} ${
                    student.is_active ? styles.active : styles.inactive
                  }`}
                >
                  {student.is_active ? "Активний" : "Неактивний"}
                </span>
              </div>

              <div className={styles.studentDetails}>
                <div>
                  <span>Телефон</span>
                  <strong>{student.phone || "Не вказано"}</strong>
                </div>

                <div>
                  <span>Додано</span>
                  <strong>{formatDate(student.created_at)}</strong>
                </div>
              </div>

              <Link
                to={`/teacher-dashboard/students/${student.id}`}
                className={styles.detailsButton}
              >
                Відкрити профіль
              </Link>
            </article>
          ))}
        </div>
      )}
    </section>
  );
};

export default TeacherStudents;
