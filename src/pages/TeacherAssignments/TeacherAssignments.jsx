import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "../../components/common/ui/Button/Button";
import { supabase } from "../../lib/supabase";
import { getIntlLocale } from "../../utils/getIntlLocale";

import styles from "./TeacherAssignments.module.css";

const TeacherAssignments = () => {
  const { t, i18n } = useTranslation();
  const [students, setStudents] = useState([]);
  const [materials, setMaterials] = useState([]);
  const [assignments, setAssignments] = useState([]);
  const [lessons, setLessons] = useState([]);
  const [studentId, setStudentId] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [materialIds, setMaterialIds] = useState([]);
  const [editingId, setEditingId] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const locale = getIntlLocale(i18n.resolvedLanguage || i18n.language);

  const loadBase = async () => {
    const [studentsResult, materialsResult, assignmentsResult] = await Promise.all([
      supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "student")
        .eq("is_active", true)
        .order("full_name"),
      supabase.from("materials").select("id, title, category").order("title"),
      supabase
        .from("assignments")
        .select(
          "id, student_id, lesson_id, title, description, due_date, status, created_at, profiles:student_id(full_name,email), assignment_materials(materials(id,title,url))",
        )
        .order("created_at", { ascending: false }),
    ]);

    if (studentsResult.error) throw studentsResult.error;
    if (materialsResult.error) throw materialsResult.error;
    if (assignmentsResult.error) throw assignmentsResult.error;

    setStudents(studentsResult.data ?? []);
    setMaterials(materialsResult.data ?? []);
    setAssignments(assignmentsResult.data ?? []);
  };

  useEffect(() => {
    const initialize = async () => {
      try {
        setLoading(true);
        await loadBase();
      } catch (error) {
        console.error("Teacher assignments load error:", error);
        setErrorMessage(t("teacherAssignments.errors.load"));
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, [t]);

  useEffect(() => {
    const loadLessons = async () => {
      if (!studentId) {
        setLessons([]);
        setLessonId("");
        return;
      }

      const from = new Date();
      from.setDate(from.getDate() - 30);

      const to = new Date();
      to.setDate(to.getDate() + 90);

      const { data, error } = await supabase
        .from("lessons")
        .select("id, starts_at, status")
        .eq("student_id", studentId)
        .gte("starts_at", from.toISOString())
        .lte("starts_at", to.toISOString())
        .neq("status", "cancelled")
        .order("starts_at");

      if (error) {
        return;
      }

      const lessonRows = data ?? [];
      setLessons(lessonRows);
      setLessonId((current) =>
        current && lessonRows.some((lesson) => lesson.id === current) ? current : "",
      );
    };

    loadLessons();
  }, [studentId]);

  const groupedMaterials = useMemo(() => materials, [materials]);

  const resetForm = () => {
    setStudentId("");
    setTitle("");
    setDescription("");
    setDueDate("");
    setLessonId("");
    setMaterialIds([]);
    setEditingId(null);
  };

  const closeForm = () => {
    resetForm();
    setFormOpen(false);
  };

  const handleOpenCreateForm = () => {
    resetForm();
    setErrorMessage("");
    setSuccessMessage("");
    setFormOpen(true);

    requestAnimationFrame(() => {
      document.getElementById("assignment-form")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const toggleMaterial = (id) => {
    setMaterialIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!studentId || !title.trim()) {
      return;
    }

    try {
      setSaving(true);
      setErrorMessage("");
      setSuccessMessage("");

      const rpcName = editingId ? "update_assignment" : "create_assignment";
      const rpcPayload = {
        p_student_id: studentId,
        p_title: title.trim(),
        p_description: description.trim() || null,
        p_due_date: dueDate || null,
        p_lesson_id: lessonId || null,
        p_material_ids: materialIds,
      };

      if (editingId) {
        rpcPayload.p_assignment_id = editingId;
      }

      const { error } = await supabase.rpc(rpcName, rpcPayload);

      if (error) {
        throw error;
      }

      const wasEditing = Boolean(editingId);
      closeForm();
      setSuccessMessage(
        t(
          wasEditing
            ? "teacherAssignments.messages.updated"
            : "teacherAssignments.messages.created",
        ),
      );
      await loadBase();
    } catch (error) {
      console.error("Save assignment error:", error);
      setErrorMessage(getAssignmentSaveError(error, t, Boolean(editingId)));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (assignment) => {
    if (assignment.status === "completed") {
      return;
    }

    setEditingId(assignment.id);
    setStudentId(assignment.student_id || "");
    setTitle(assignment.title || "");
    setDescription(assignment.description || "");
    setDueDate(assignment.due_date || "");
    setLessonId(assignment.lesson_id || "");
    setMaterialIds(
      (assignment.assignment_materials ?? [])
        .map((link) => link.materials?.id)
        .filter(Boolean),
    );
    setErrorMessage("");
    setSuccessMessage("");
    setFormOpen(true);

    requestAnimationFrame(() => {
      document.getElementById("assignment-form")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const formatLesson = (lesson) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(lesson.starts_at));

  const formatDue = (value) =>
    value
      ? new Intl.DateTimeFormat(locale, {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(new Date(`${value}T12:00:00`))
      : t("teacherAssignments.noDeadline");

  if (loading) {
    return (
      <section className={styles.page}>
        <div className={styles.state}>{t("teacherAssignments.loading")}</div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{t("teacherAssignments.title")}</h1>
          <p>{t("teacherAssignments.description")}</p>
        </div>

        {!formOpen && (
          <Button variant="primary" size="large" onClick={handleOpenCreateForm}>
            {t("teacherAssignments.openCreate")}
          </Button>
        )}
      </header>

      {formOpen && (
      <section id="assignment-form" className={styles.panel}>
        <h2>
          {t(
            editingId
              ? "teacherAssignments.editTitle"
              : "teacherAssignments.createTitle",
          )}
        </h2>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formRow}>
            <label className={styles.field}>
              <span>{t("teacherAssignments.student")}</span>
              <select
                value={studentId}
                onChange={(event) => setStudentId(event.target.value)}
                required
              >
                <option value="">{t("teacherAssignments.selectStudent")}</option>
                {students.map((student) => (
                  <option key={student.id} value={student.id}>
                    {student.full_name || student.email}
                  </option>
                ))}
              </select>
            </label>

            <label className={styles.field}>
              <span>{t("teacherAssignments.dueDate")}</span>
              <input
                type="date"
                value={dueDate}
                onChange={(event) => setDueDate(event.target.value)}
              />
            </label>
          </div>

          <label className={styles.field}>
            <span>{t("teacherAssignments.assignmentTitle")}</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              required
            />
          </label>

          <label className={styles.field}>
            <span>{t("teacherAssignments.descriptionLabel")}</span>
            <textarea
              rows="4"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          </label>

          <label className={styles.field}>
            <span>{t("teacherAssignments.lesson")}</span>
            <select
              value={lessonId}
              onChange={(event) => setLessonId(event.target.value)}
              disabled={!studentId}
            >
              <option value="">{t("teacherAssignments.noLesson")}</option>
              {lessons.map((lesson) => (
                <option key={lesson.id} value={lesson.id}>
                  {formatLesson(lesson)}
                </option>
              ))}
            </select>
          </label>

          <fieldset className={styles.materialsField}>
            <legend>{t("teacherAssignments.materials")}</legend>

            {groupedMaterials.length === 0 ? (
              <p>{t("teacherAssignments.noMaterials")}</p>
            ) : (
              <div className={styles.checkGrid}>
                {groupedMaterials.map((material) => (
                  <label key={material.id} className={styles.checkItem}>
                    <input
                      type="checkbox"
                      checked={materialIds.includes(material.id)}
                      onChange={() => toggleMaterial(material.id)}
                    />
                    <span>
                      {material.title}
                      {material.category ? ` · ${material.category}` : ""}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>

          <div className={styles.actions}>
            <Button type="submit" variant="primary" size="large" disabled={saving}>
              {saving
                ? t("teacherAssignments.saving")
                : t(
                    editingId
                      ? "teacherAssignments.saveChanges"
                      : "teacherAssignments.create",
                  )}
            </Button>

            <Button onClick={closeForm} disabled={saving}>
              {t("teacherAssignments.cancel")}
            </Button>
          </div>
        </form>
      </section>
      )}

      {errorMessage && <p className={styles.error}>{errorMessage}</p>}
      {successMessage && <p className={styles.success}>{successMessage}</p>}

      <section className={styles.listSection}>
        <h2>{t("teacherAssignments.listTitle")}</h2>

        {assignments.length === 0 ? (
          <div className={styles.empty}>{t("teacherAssignments.empty")}</div>
        ) : (
          <div className={styles.list}>
            {assignments.map((assignment) => (
              <article key={assignment.id} className={styles.card}>
                <div className={styles.cardTop}>
                  <div>
                    <span className={styles.student}>
                      {assignment.profiles?.full_name ||
                        assignment.profiles?.email ||
                        "—"}
                    </span>
                    <h3>{assignment.title}</h3>
                  </div>

                  <span
                    className={`${styles.status} ${
                      assignment.status === "completed"
                        ? styles.completed
                        : styles.assigned
                    }`}
                  >
                    {t(`teacherAssignments.statuses.${assignment.status}`)}
                  </span>
                </div>

                {assignment.description && (
                  <p className={styles.descriptionText}>{assignment.description}</p>
                )}

                <div className={styles.meta}>
                  <span>
                    {t("teacherAssignments.deadline")}: {" "}
                    <strong>{formatDue(assignment.due_date)}</strong>
                  </span>
                </div>

                {(assignment.assignment_materials ?? []).length > 0 && (
                  <div className={styles.materialLinks}>
                    {assignment.assignment_materials.map((link) => (
                      <a
                        key={link.materials?.id}
                        href={link.materials?.url}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {link.materials?.title}
                      </a>
                    ))}
                  </div>
                )}

                {assignment.status !== "completed" && (
                  <div className={styles.cardActions}>
                    <Button onClick={() => handleEdit(assignment)}>
                      {t("teacherAssignments.edit")}
                    </Button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </section>
    </section>
  );
};

const getAssignmentSaveError = (error, t, editing) => {
  const message = error?.message || "";

  if (message.includes("ASSIGNMENT_COMPLETED")) {
    return t("teacherAssignments.errors.completed");
  }

  return t(
    editing ? "teacherAssignments.errors.update" : "teacherAssignments.errors.create",
  );
};

export default TeacherAssignments;
