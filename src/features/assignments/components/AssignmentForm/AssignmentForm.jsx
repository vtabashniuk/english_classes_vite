import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "../../../../components/common/ui/Button/Button";
import { saveAssignment } from "../../api/assignmentsApi";
import { listStudentLessonsForAssignment } from "../../../lessons/api/lessonsApi";
import { listGrantedMaterialsForStudentAssignment } from "../../../materials/api/materialsApi";
import useToast from "../../../../shared/toast/useToast";
import { getIntlLocale } from "../../../../utils/getIntlLocale";
import { getMyTeacherScheduleSettings } from "../../../settings/api/teacherSettingsApi";
import { getLessonDueDate } from "../../lib/lessonDueDate";

import styles from "./AssignmentForm.module.css";

const AssignmentForm = ({ studentId, assignment = null, initialMaterialIds = [], onSaved, onCancel }) => {
  const { t, i18n } = useTranslation();
  const toast = useToast();
  const locale = getIntlLocale(i18n.resolvedLanguage || i18n.language);

  const [title, setTitle] = useState(assignment?.title || "");
  const [description, setDescription] = useState(assignment?.description || "");
  const [dueDate, setDueDate] = useState(assignment?.due_date || "");
  const [lessonId, setLessonId] = useState(assignment?.lesson_id || "");
  const [materialIds, setMaterialIds] = useState(
    assignment ? (assignment.assignment_materials ?? [])
      .map((link) => link.materials?.id)
      .filter(Boolean) : initialMaterialIds,
  );
  const [lessons, setLessons] = useState([]);
  const [scheduleTimezone, setScheduleTimezone] = useState("Europe/Kyiv");
  const [materials, setMaterials] = useState([]);
  const [optionsLoading, setOptionsLoading] = useState(true);
  const [optionsError, setOptionsError] = useState("");
  const [saving, setSaving] = useState(false);

  const editingId = assignment?.id || null;
  const groupedMaterials = useMemo(() => {
    const existing = new Set(materials.map((material) => material.id));
    // Revoked links from an older assignment remain visible as history,
    // but cannot be selected as new links.
    const historical = (assignment?.assignment_materials ?? [])
      .map((link) => link.materials)
      .filter((material) => material && !existing.has(material.id))
      .map((material) => ({ ...material, accessRevoked: true }));
    return [...materials, ...historical];
  }, [materials, assignment]);

  useEffect(() => {
    let cancelled = false;

    const loadOptions = async () => {
      try {
        setOptionsLoading(true);
        setOptionsError("");

        const from = new Date();
        from.setDate(from.getDate() - 30);

        const to = new Date();
        to.setDate(to.getDate() + 90);

        const [materialsResult, lessonsResult, settingsResult] = await Promise.all([
          listGrantedMaterialsForStudentAssignment(studentId),
          listStudentLessonsForAssignment({
            studentId,
            fromIso: from.toISOString(),
            toIso: to.toISOString(),
          }),
          getMyTeacherScheduleSettings(),
        ]);

        if (materialsResult.error || lessonsResult.error) {
          throw materialsResult.error || lessonsResult.error;
        }

        if (cancelled) return;

        setMaterials(materialsResult.data ?? []);
        setLessons(lessonsResult.data ?? []);
        setScheduleTimezone(settingsResult.data?.schedule_timezone || "Europe/Kyiv");
      } catch (error) {
        if (cancelled) return;
        console.error("Assignment form options load error:", error);
        setOptionsError(t("teacherAssignments.errors.load"));
      } finally {
        if (!cancelled) setOptionsLoading(false);
      }
    };

    loadOptions();

    return () => {
      cancelled = true;
    };
  }, [studentId, t]);

  const handleLessonChange = (nextLessonId) => {
    setLessonId(nextLessonId);
    if (nextLessonId) {
      const lesson = lessons.find((item) => item.id === nextLessonId);
      if (lesson) setDueDate(getLessonDueDate(lesson.starts_at, scheduleTimezone));
    } else {
      setDueDate("");
    }
  };

  const toggleMaterial = (id) => {
    setMaterialIds((current) =>
      current.includes(id)
        ? current.filter((item) => item !== id)
        : [...current, id],
    );
  };

  const formatLesson = (lesson) =>
    new Intl.DateTimeFormat(locale, {
      day: "2-digit",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: scheduleTimezone,
    }).format(new Date(lesson.starts_at));

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!title.trim()) {
      return;
    }

    try {
      setSaving(true);

      const { error } = await saveAssignment({
        editingId,
        payload: {
          p_student_id: studentId,
          p_title: title.trim(),
          p_description: description.trim() || null,
          p_due_date: lessonId
            ? getLessonDueDate(lessons.find((item) => item.id === lessonId)?.starts_at, scheduleTimezone) || dueDate || null
            : dueDate || null,
          p_lesson_id: lessonId || null,
          p_material_ids: materialIds,
        },
      });

      if (error) throw error;

      toast.success(
        t(
          editingId
            ? "teacherAssignments.messages.updated"
            : "teacherAssignments.messages.created",
        ),
      );
      onSaved?.();
    } catch (error) {
      console.error("Save assignment error:", error);
      toast.error(getAssignmentSaveError(error, t, Boolean(editingId)));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className={styles.panel}>
      <h3>
        {t(
          editingId
            ? "teacherAssignments.editTitle"
            : "teacherAssignments.createTitle",
        )}
      </h3>

      {optionsError && <p className={styles.error}>{optionsError}</p>}

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.formRow}>
          <label className={styles.field}>
            <span>{t("teacherAssignments.dueDate")}</span>
            <input
              type="date"
              value={dueDate}
              onChange={(event) => setDueDate(event.target.value)}
              disabled={Boolean(lessonId)}
            />
          </label>

          <label className={styles.field}>
            <span>{t("teacherAssignments.lesson")}</span>
            <select
              value={lessonId}
              onChange={(event) => handleLessonChange(event.target.value)}
              disabled={optionsLoading}
            >
              <option value="">{t("teacherAssignments.noLesson")}</option>
              {lessons.map((lesson) => (
                <option key={lesson.id} value={lesson.id}>
                  {formatLesson(lesson)}
                </option>
              ))}
            </select>
          </label>
        </div>

        {lessonId && <p className={styles.dueHint}>{t("teacherAssignments.lessonDueDateHint")}</p>}

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

        <fieldset className={styles.materialsField} disabled={optionsLoading}>
          <legend>{t("teacherAssignments.materials")}</legend>

          {optionsLoading ? (
            <p>{t("common.loading")}</p>
          ) : groupedMaterials.length === 0 ? (
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
                    {material.accessRevoked ? ` (${t("materialsFeature.revoked")})` : ""}
                  </span>
                </label>
              ))}
            </div>
          )}
        </fieldset>

        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={saving || optionsLoading}>
            {saving
              ? t("teacherAssignments.saving")
              : t(
                  editingId
                    ? "teacherAssignments.saveChanges"
                    : "teacherAssignments.create",
                )}
          </Button>

          <Button onClick={onCancel} disabled={saving}>
            {t("teacherAssignments.cancel")}
          </Button>
        </div>
      </form>
    </section>
  );
};

const getAssignmentSaveError = (error, t, editing) => {
  const message = error?.message || "";

  if (message.includes("MATERIAL_NOT_SHARED")) {
    return t("materialsFeature.assignmentNeedsAccess");
  }

  if (message.includes("ASSIGNMENT_COMPLETED")) {
    return t("teacherAssignments.errors.completed");
  }

  return t(
    editing ? "teacherAssignments.errors.update" : "teacherAssignments.errors.create",
  );
};

export default AssignmentForm;
