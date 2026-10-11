import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../context/useAuth";
import Button from "../../components/common/ui/Button/Button";
import { completeAssignment, listStudentAssignments } from "../../features/assignments/api/assignmentsApi";
import useAssignmentGroups from "../../features/assignments/hooks/useAssignmentGroups";
import { getIntlLocale } from "../../utils/getIntlLocale";
import { isAssignmentOverdue } from "../../features/assignments/lib/assignmentStatus";
import PaginationControls from "../../shared/pagination/PaginationControls";
import usePagePreferences from "../../shared/pagination/usePagePreferences";
import styles from "./StudentAssignments.module.css";

const StudentAssignments = () => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const { sizes } = usePagePreferences();
  const [processingId, setProcessingId] = useState(null);
  const [actionError, setActionError] = useState("");
  const locale = getIntlLocale(i18n.resolvedLanguage || i18n.language);
  const fetchGroup = useCallback((options) => listStudentAssignments(options), []);
  const { pending, completed, pages, pageSizes, setPage, loading, error, reload } =
    useAssignmentGroups(fetchGroup, user?.id ?? "anonymous", { pending: sizes.studentPendingAssignments, completed: sizes.studentCompletedAssignments });

  const markCompleted = async (id) => {
    try {
      setProcessingId(id);
      setActionError("");
      const { error: completeError } = await completeAssignment(id);
      if (completeError) throw completeError;
      reload();
    } catch (cause) {
      console.error("Complete assignment error:", cause);
      setActionError(t("studentAssignments.errors.complete"));
    } finally {
      setProcessingId(null);
    }
  };

  const formatDue = (value) => value
    ? new Intl.DateTimeFormat(locale, { day: "2-digit", month: "long", year: "numeric" })
      .format(new Date(`${value}T12:00:00`))
    : t("studentAssignments.noDeadline");

  if (loading && !pending.count && !completed.count) {
    return <section className={styles.page}><div className={styles.state}>{t("studentAssignments.loading")}</div></section>;
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1>{t("studentAssignments.title")}</h1>
        <p>{t("studentAssignments.description")}</p>
      </header>
      {(error || actionError) && <p className={styles.error}>{actionError || t("studentAssignments.errors.load")}</p>}
      {!loading && pending.count + completed.count === 0 ? (
        <div className={styles.empty}>{t("studentAssignments.empty")}</div>
      ) : (
        <div className={styles.grouped}>
          {[{ key: "pending", ...pending }, { key: "completed", ...completed }].map((group) => (
            <section key={group.key}>
              <h2>{t(`studentAssignments.groups.${group.key}`)} ({group.count})</h2>
              <div className={styles.list}>
                {group.items.map((assignment) => (
                  <article key={assignment.id} className={styles.card}>
                    <div className={styles.cardTop}>
                      <div>
                        <span className={styles.deadline}>
                          {t("studentAssignments.deadline")}: {formatDue(assignment.due_date)}
                        </span>
                        <h2>{assignment.title}</h2>
                      </div>
                      <span className={`${styles.status} ${assignment.status === "completed" ? styles.completed : styles.assigned}`}>
                        {t(`studentAssignments.statuses.${assignment.status}`)}
                      </span>
                      {isAssignmentOverdue(assignment) && <span className={styles.overdue}>{t("studentAssignments.overdue")}</span>}
                    </div>
                    {assignment.description && <p>{assignment.description}</p>}
                    {(assignment.assignment_materials ?? []).length > 0 && (
                      <div className={styles.materials}>
                        <strong>{t("studentAssignments.materials")}</strong>
                        {assignment.assignment_materials.flatMap((link) => (
                          link.materials?.material_resources?.length
                            ? link.materials.material_resources
                            : link.materials?.url
                              ? [{ id: "primary", external_url: link.materials.url, title: link.materials.title }]
                              : []
                        ).map((resource) => ({ ...resource, materialId: link.materials?.id })))
                          .filter((resource) => Boolean(resource.external_url))
                          .map((resource) => (
                            <a key={`${resource.materialId}-${resource.id}`} href={resource.external_url}
                              target="_blank" rel="noreferrer">{resource.title}</a>
                          ))}
                      </div>
                    )}
                    {assignment.status !== "completed" && (
                      <div className={styles.actions}>
                        <Button variant="success" onClick={() => markCompleted(assignment.id)}
                          disabled={processingId === assignment.id}>
                          {t("studentAssignments.complete")}
                        </Button>
                      </div>
                    )}
                  </article>
                ))}
              </div>
              <PaginationControls page={pages[group.key]} pageSize={pageSizes[group.key]} total={group.count}
                disabled={loading || Boolean(processingId)}
                onPageChange={(nextPage) => setPage(group.key, nextPage)}
                previousLabel={t("commonPagination.previous")}
                nextLabel={t("commonPagination.next")}
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

export default StudentAssignments;
