import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "../../../../components/common/ui/Button/Button";
import { listTeacherStudentAssignments } from "../../api/assignmentsApi";
import { getIntlLocale } from "../../../../utils/getIntlLocale";
import AssignmentForm from "../AssignmentForm/AssignmentForm";
import { isAssignmentOverdue } from "../../lib/assignmentStatus";
import useAssignmentGroups from "../../hooks/useAssignmentGroups";
import PaginationControls from "../../../../shared/pagination/PaginationControls";
import usePagePreferences from "../../../../shared/pagination/usePagePreferences";

import styles from "./TeacherStudentAssignmentsSection.module.css";

const TeacherStudentAssignmentsSection = ({ studentId, canManage = true }) => {
  const { t, i18n } = useTranslation();
  const { sizes } = usePagePreferences();
  const locale = getIntlLocale(i18n.resolvedLanguage || i18n.language);

  const [formOpen, setFormOpen] = useState(false);
  const [editingAssignment, setEditingAssignment] = useState(null);
  const fetchGroup = useCallback((options) => listTeacherStudentAssignments(studentId, options), [studentId]);
  const { pending, completed, pages, pageSizes, setPage, loading, error, reload } =
    useAssignmentGroups(fetchGroup, studentId, { pending: sizes.teacherPendingAssignments, completed: sizes.teacherCompletedAssignments });
  const errorMessage = error ? t("teacherAssignments.errors.load") : "";

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
    reload();
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
      ) : pending.count + completed.count === 0 ? (
        <div className={styles.placeholder}>
          {t("teacherStudentDetails.assignmentsPlaceholder")}
        </div>
      ) : (
        <div className={styles.groups}>
          {[{ key: "pending", ...pending }, { key: "completed", ...completed }].map((group) => (
            <section key={group.key} className={styles.assignmentGroup}>
              <h3>{t(`teacherAssignments.groups.${group.key}`)} ({group.count})</h3>
              {!group.items.length && <p className={styles.placeholder}>{t("teacherAssignments.groupEmpty")}</p>}
              <div className={styles.list}>
                {group.items.map((assignment) => (
                  <article key={assignment.id} className={styles.item}>
                    <div className={styles.itemTop}>
                      <div className={styles.itemText}>
                        <div className={styles.titleRow}>
                          <strong>{assignment.title}</strong>
                          <span className={`${styles.status} ${assignment.status === "completed" ? styles.completed : styles.assigned}`}>
                            {t(`teacherAssignments.statuses.${assignment.status}`)}
                          </span>
                          {isAssignmentOverdue(assignment) && <span className={styles.overdue}>{t("teacherAssignments.overdue")}</span>}
                        </div>
                        <small>{t("teacherAssignments.deadline")}: {formatDue(assignment.due_date)}</small>
                      </div>
                      {canManage && assignment.status !== "completed" && (
                        <Button onClick={() => openEdit(assignment)}>{t("teacherAssignments.edit")}</Button>
                      )}
                    </div>
                    {assignment.description && <p className={styles.description}>{assignment.description}</p>}
                    {(assignment.assignment_materials ?? []).flatMap((link) =>
                      (link.materials?.material_resources?.length ? link.materials.material_resources
                        : link.materials?.url ? [{ id: "primary", title: link.materials.title, external_url: link.materials.url }] : [])
                        .map((resource) => ({ ...resource, materialId: link.materials?.id })),
                    ).filter((resource) => Boolean(resource.external_url)).map((resource) => (
                      <a key={`${resource.materialId}-${resource.id}`} href={resource.external_url}
                        target="_blank" rel="noopener noreferrer" className={styles.materialLink}>{resource.title} ↗</a>
                    ))}
                  </article>
                ))}
              </div>
              <PaginationControls page={pages[group.key]} pageSize={pageSizes[group.key]} total={group.count}
                disabled={loading} onPageChange={(nextPage) => setPage(group.key, nextPage)}
                previousLabel={t("commonPagination.previous")} nextLabel={t("commonPagination.next")}
                summary={t("commonPagination.summary", {
                  current: pages[group.key] + 1,
                  total: Math.max(1, Math.ceil(group.count / pageSizes[group.key])), count: group.count,
                })} />
            </section>
          ))}
        </div>
      )}
    </section>
  );
};

export default TeacherStudentAssignmentsSection;
