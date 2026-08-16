import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import { supabase } from "../../lib/supabase";
import { getIntlLocale } from "../../utils/getIntlLocale";

import styles from "./TeacherSchedule.module.css";

const TeacherSchedule = () => {
  const { t, i18n } = useTranslation();
  const intlLocale = getIntlLocale(i18n.resolvedLanguage || i18n.language);

  const [students, setStudents] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [studentId, setStudentId] = useState("");
  const [lessonDate, setLessonDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [zoomUrl, setZoomUrl] = useState("");
  const [scheduleTimezone, setScheduleTimezone] = useState("Europe/Kyiv");
  const [loadingStudents, setLoadingStudents] = useState(true);
  const [loadingLessons, setLoadingLessons] = useState(true);
  const [isCreating, setIsCreating] = useState(false);
  const [message, setMessage] = useState("");
  const [errorMessage, setErrorMessage] = useState("");

  const timeSlots = useMemo(() => {
    const slots = [];
    for (let hour = 9; hour <= 18; hour += 1) {
      slots.push(`${String(hour).padStart(2, "0")}:00`);
      if (hour < 18) slots.push(`${String(hour).padStart(2, "0")}:30`);
    }
    return slots;
  }, []);

  const loadTeacherSettings = async () => {
    try {
      const { data, error } = await supabase
        .from("teacher_settings")
        .select("schedule_timezone")
        .single();

      if (error) throw error;
      setScheduleTimezone(data?.schedule_timezone || "Europe/Kyiv");
    } catch (error) {
      console.error("Teacher settings load error:", error);
    }
  };

  const loadStudents = async () => {
    try {
      setLoadingStudents(true);
      const { data, error } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "student")
        .eq("is_active", true)
        .order("full_name", { ascending: true });

      if (error) throw error;
      setStudents(data ?? []);
    } catch (error) {
      console.error("Students load error:", error);
    } finally {
      setLoadingStudents(false);
    }
  };

  const loadLessons = async () => {
    try {
      setLoadingLessons(true);
      const { data, error } = await supabase
        .from("lessons")
        .select(`
          id,
          starts_at,
          ends_at,
          status,
          zoom_url,
          student_id,
          profiles!lessons_student_id_fkey (
            full_name,
            email
          )
        `)
        .order("starts_at", { ascending: true });

      if (error) throw error;
      setLessons(data ?? []);
    } catch (error) {
      console.error("Lessons load error:", error);
    } finally {
      setLoadingLessons(false);
    }
  };

  useEffect(() => {
    loadStudents();
    loadLessons();
    loadTeacherSettings();
  }, []);

  const handleCreateLesson = async (event) => {
    event.preventDefault();
    setMessage("");
    setErrorMessage("");

    if (!studentId || !lessonDate || !startTime) {
      setErrorMessage(t("teacherSchedule.errors.required"));
      return;
    }

    setIsCreating(true);

    try {
      const { error } = await supabase.rpc("create_lesson", {
        p_student_id: studentId,
        p_lesson_date: lessonDate,
        p_start_time: startTime,
        p_zoom_url: zoomUrl.trim() || null,
      });

      if (error) throw error;

      setMessage(t("teacherSchedule.success"));
      setLessonDate("");
      setStartTime("");
      setZoomUrl("");
      await loadLessons();
    } catch (error) {
      console.error("Lesson creation error:", error);
      const rawMessage = error?.message ?? "";

      const errorKey = rawMessage.includes("WEEKEND_NOT_ALLOWED")
        ? "weekend"
        : rawMessage.includes("OUTSIDE_WORKING_HOURS")
          ? "workingHours"
          : rawMessage.includes("INVALID_TIME_SLOT")
            ? "timeSlot"
            : rawMessage.includes("LESSON_TIME_CONFLICT")
              ? "conflict"
              : rawMessage.includes("LESSON_IN_PAST")
                ? "past"
                : rawMessage.includes("STUDENT_NOT_FOUND")
                  ? "studentNotFound"
                  : "create";

      setErrorMessage(t(`teacherSchedule.errors.${errorKey}`));
    } finally {
      setIsCreating(false);
    }
  };

  const formatLessonDate = (value) =>
    new Intl.DateTimeFormat(intlLocale, {
      timeZone: scheduleTimezone,
      weekday: "short",
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));

  const getStatusLabel = (status) =>
    t(`studentSchedule.${status}`, { defaultValue: status });

  return (
    <section className={styles.page}>
      <div className={styles.header}>
        <div>
          <h1>{t("teacherSchedule.title")}</h1>
          <p>{t("teacherSchedule.description")}</p>
        </div>
      </div>

      <div className={styles.layout}>
        <article className={styles.card}>
          <h2>{t("teacherSchedule.newLesson")}</h2>

          <form className={styles.form} onSubmit={handleCreateLesson}>
            <label className={styles.field}>
              <span>{t("teacherSchedule.student")}</span>
              <select
                value={studentId}
                onChange={(event) => setStudentId(event.target.value)}
                disabled={loadingStudents}
                required
              >
                <option value="">{t("teacherSchedule.selectStudent")}</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.full_name || student.email}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>{t("teacherSchedule.date")}</span>
              <input
                type="date"
                value={lessonDate}
                onChange={(event) => setLessonDate(event.target.value)}
                required
              />
            </label>

            <label className={styles.field}>
              <span>{t("teacherSchedule.time")}</span>
              <select
                value={startTime}
                onChange={(event) => setStartTime(event.target.value)}
                required
              >
                <option value="">{t("teacherSchedule.selectTime")}</option>
                {timeSlots.map((time) => (
                  <option key={time} value={time}>{time}</option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>{t("teacherSchedule.zoomUrl")}</span>
              <input
                type="url"
                value={zoomUrl}
                onChange={(event) => setZoomUrl(event.target.value)}
                placeholder="https://..."
              />
            </label>

            {message && <p className={styles.success}>{message}</p>}
            {errorMessage && <p className={styles.error}>{errorMessage}</p>}

            <button
              type="submit"
              className={styles.submitButton}
              disabled={isCreating}
            >
              {isCreating
                ? t("teacherSchedule.creating")
                : t("teacherSchedule.create")}
            </button>
          </form>
        </article>

        <article className={styles.card}>
          <h2>{t("teacherSchedule.scheduledLessons")}</h2>

          {loadingLessons ? (
            <p>{t("common.loading")}</p>
          ) : lessons.length === 0 ? (
            <p className={styles.empty}>{t("teacherSchedule.empty")}</p>
          ) : (
            <div className={styles.lessons}>
              {lessons.map((lesson) => (
                <div key={lesson.id} className={styles.lesson}>
                  <div>
                    <strong>
                      {lesson.profiles?.full_name ||
                        lesson.profiles?.email ||
                        t("common.student")}
                    </strong>
                    <p>{formatLessonDate(lesson.starts_at)}</p>
                  </div>

                  <span className={styles.status}>
                    {getStatusLabel(lesson.status)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </article>
      </div>
    </section>
  );
};

export default TeacherSchedule;
