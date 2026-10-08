import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "../../../../components/common/ui/Button/Button";
import { listTeacherStudentAssignments } from "../../api/assignmentsApi";
import { getIntlLocale } from "../../../../utils/getIntlLocale";
import AssignmentForm from "../AssignmentForm/AssignmentForm";

import styles from "./TeacherStudentAssignmentsSection.module.css";

const TeacherStudentAssignmentsSection = ({ studentId, canManage = true }) => {
  const { t, i18n } = useTranslation();
  const locale = getIntlLocale(i18n.resolvedLanguage || i18n.language);

  const [loadState, setLoadState] = useState({
    studentId: null,
    assignments: [],
    errorMessage: "",
  });
  const [formOpen, setFormOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState(null);

  const loading = loadState.studentId !== studentId;
  const assignments = loading ? [] : loadState.assignments;
  const errorMessage = loading ? "" : loadState.errorMessage;

  useEffect(() => {
    let cancelled = false;

    listTeacherStudentAssignments(studentId)
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) throw error;

        setLoadState({
          studentId,
          assignments: data ?? [],
          errorMessage: "",
        });
      })
      .catch((error) => {
        if (cancelled) return;

        console.error("Teacher student assignments load error:", error);
        setLoadState({
          studentId,
          assignments: [],
          errorMessage: t("teacherAssignments.errors.load"),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [studentId, t]);

  const reloadAssignments = async () => {
    setLoadState((current) => ({
      ...current,
      studentId: null,
      errorMessage: "",
    }));

    try {
      const { data, error } = await listTeacherStudentAssignments(studentId);
      if (error) throw error;

      setLoadState({
        studentId,
        assignments: data ?? [],
        errorMessage: "",
      });
    } catch (error) {
      console.error("Teacher student assignments load error:", error);
      setLoadState({
        studentId,
        assignments: [],
        errorMessage: t("teacherAssignments.errors.load"),
      });
    }
  };

  const openCreate = () => {
    setEditingAssignment(null);
    setFormOpen(true);
  };

  const openEdit = (assignment) => {
    if (assignment.status === "completed") return;
    setEditingAssignment(assignment);
    setFormOpen(true);
  };

  const closeForm = () => {
    setEditingAssignment(null);
    setFormOpen(false);
  };

  const handleSaved = async () => {
    closeForm();
    await reloadAssignments();
  };

  const formatDue = (value) =>
    value
      ? new Intl.DateTimeFormat(locale, {
          day: "2-digit",
          month: "short",
          year: "numeric",
        }).format(new Date(`${value}T12:00:00`))
      : t("teacherAssignments.noDeadline");

  return (
    <section className={styles.section}>
      <div className={styles.header}>
        <h2>{t("teacherStudentDetails.assignments")}</h2>
        {!formOpen && canManage && (
          <Button variant="primary" onClick={openCreate}>
            {t("teacherAssignments.openCreate")}
          </Button>
        )}
      </div>

      {formOpen && (
        <AssignmentForm
          studentId={studentId}
          assignment={editingAssignment}
          onSaved={handleSaved}
          onCancel={closeForm}
        />
      )}

      {errorMessage ? (
        <p className={styles.error}>{errorMessage}</p>
      ) : loading ? (
        <div className={styles.placeholder}>{t("common.loading")}</div>
      ) : assignments.length === 0 ? (
        <div className={styles.placeholder}>
          {t("teacherStudentDetails.assignmentsPlaceholder")}
        </div>
      ) : (
        <div className={styles.list}>
          {assignments.map((assignment) => (
            <article key={assignment.id} className={styles.item}>
              <div className={styles.itemTop}>
                <div className={styles.itemText}>
                  <div className={styles.titleRow}>
                    <strong>{assignment.title}</strong>
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
                  <small>
                    {t("teacherAssignments.deadline")}: {formatDue(assignment.due_date)}
                  </small>
                </div>
                {canManage && assignment.status !== "completed" && (
                  <Button onClick={() => openEdit(assignment)}>
                    {t("teacherAssignments.edit")}
                  </Button>
                )}
              </div>

              {assignment.description && (
                <p className={styles.description}>{assignment.description}</p>
              )}

              {(assignment.assignment_materials ?? []).length > 0 && (
                <div className={styles.materials}>
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
            </article>
          ))}
        </div>
      )}
    </section>
  );
};

export default TeacherStudentAssignmentsSection;
