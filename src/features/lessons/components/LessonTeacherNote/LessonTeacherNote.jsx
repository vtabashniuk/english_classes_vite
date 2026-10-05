import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "../../../../components/common/ui/Button/Button";
import {
  getLessonTeacherNote,
  updateLessonTeacherNote,
} from "../../api/lessonsApi";
import useToast from "../../../../shared/toast/useToast";

import styles from "./LessonTeacherNote.module.css";

const MAX_LENGTH = 5000;

const LessonTeacherNote = ({
  lessonId,
  rows = 5,
  formatUpdatedAt = null,
  className = "",
}) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [note, setNote] = useState("");
  const [draft, setDraft] = useState("");
  const [updatedAt, setUpdatedAt] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      if (!lessonId) {
        setNote("");
        setDraft("");
        setUpdatedAt(null);
        setErrorMessage("");
        setLoading(false);
        return;
      }

      try {
        setLoading(true);
        setErrorMessage("");

        const { data, error } = await getLessonTeacherNote(lessonId);
        if (error) throw error;
        if (cancelled) return;

        const nextNote = data?.teacher_note ?? "";
        setNote(nextNote);
        setDraft(nextNote);
        setUpdatedAt(data?.updated_at ?? null);
      } catch (error) {
        if (cancelled) return;
        console.error("Lesson teacher note load error:", error);
        setErrorMessage(t("teacherSchedule.lessonNote.errors.load"));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();

    return () => {
      cancelled = true;
    };
  }, [lessonId, t]);

  const handleSubmit = async (event) => {
    event?.preventDefault?.();
    if (!lessonId) return;

    try {
      setSaving(true);
      setErrorMessage("");

      const { data, error } = await updateLessonTeacherNote({
        lessonId,
        teacherNote: draft,
      });

      if (error) throw error;

      const savedNote = data?.teacher_note ?? "";
      setNote(savedNote);
      setDraft(savedNote);
      setUpdatedAt(data?.updated_at ?? new Date().toISOString());
      toast.success(t("teacherSchedule.lessonNote.saved"));
    } catch (error) {
      console.error("Update lesson teacher note error:", error);
      toast.error(t("teacherSchedule.lessonNote.errors.save"));
    } finally {
      setSaving(false);
    }
  };

  const formattedUpdatedAt =
    updatedAt && note && typeof formatUpdatedAt === "function"
      ? formatUpdatedAt(updatedAt)
      : null;

  return (
    <form
      className={`${styles.editor}${className ? ` ${className}` : ""}`}
      onSubmit={handleSubmit}
    >
      <label className={styles.field}>
        <span>{t("teacherSchedule.lessonNote.label")}</span>
        <textarea
          rows={rows}
          maxLength={MAX_LENGTH}
          value={draft}
          onChange={(event) => {
            setDraft(event.target.value);
            setErrorMessage("");
          }}
          placeholder={t("teacherSchedule.lessonNote.placeholder")}
          disabled={loading || saving}
        />
      </label>

      <div className={styles.meta}>
        <span>{draft.length} / {MAX_LENGTH}</span>
        <span>{t("teacherSchedule.lessonNote.privateHint")}</span>
        {formattedUpdatedAt && (
          <span>
            {t("teacherSchedule.lessonNote.updated", {
              date: formattedUpdatedAt,
            })}
          </span>
        )}
      </div>

      {loading && (
        <p className={styles.muted}>{t("teacherSchedule.lessonNote.loading")}</p>
      )}
      {errorMessage && <p className={styles.error}>{errorMessage}</p>}

      <div className={styles.actions}>
        <Button
          type="submit"
          variant="secondary"
          disabled={loading || saving || draft === note}
        >
          {saving
            ? t("teacherSchedule.lessonNote.saving")
            : t("teacherSchedule.lessonNote.save")}
        </Button>
      </div>
    </form>
  );
};

export default LessonTeacherNote;
