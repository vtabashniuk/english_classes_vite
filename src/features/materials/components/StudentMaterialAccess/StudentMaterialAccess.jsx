import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  countActiveStudentMaterialGrantsForTeacher,
  getStudentMaterialGrantForTeacher,
  listStudentMaterialGrantsForTeacher,
  listMaterialsForAssignment,
  restoreMaterialAccess,
  revokeAllStudentMaterials,
  revokeMaterialFromStudent,
  shareMaterialWithStudent,
} from "../../api/materialsApi";
import PaginationControls from "../../../../shared/pagination/PaginationControls";
import usePagePreferences from "../../../../shared/pagination/usePagePreferences";
import { getPageCount } from "../../../../shared/pagination/pagination";
import styles from "./StudentMaterialAccess.module.css";



const StudentMaterialAccess = ({ studentId }) => {
  const { t } = useTranslation();
  const { sizes } = usePagePreferences();
  const pageSize = sizes.teacherStudentMaterials;
  const [grants, setGrants] = useState([]);
  const [total, setTotal] = useState(0);
  const [activeCount, setActiveCount] = useState(0);
  const [library, setLibrary] = useState([]);
  const [page, setPage] = useState(0);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const refresh = useCallback(() => setReloadKey((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const [access, materials, active] = await Promise.all([
          listStudentMaterialGrantsForTeacher(studentId, { page, pageSize: pageSize }),
          listMaterialsForAssignment(),
          countActiveStudentMaterialGrantsForTeacher(studentId),
        ]);
        if (access.error || materials.error || active.error) throw access.error || materials.error || active.error;
        if (cancelled) return;
        const count = access.count ?? 0;
        if (page >= getPageCount(count, pageSize)) {
          setPage(getPageCount(count, pageSize) - 1);
          return;
        }
        setGrants(access.data ?? []);
        setTotal(count);
        setActiveCount(active.count ?? 0);
        setLibrary(materials.data ?? []);
        setError("");
      } catch (failure) {
        if (!cancelled) setError(failure.message);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [page, pageSize, reloadKey, studentId]);

  const run = async (task) => {
    setBusy(true); setError("");
    try {
      const result = await task();
      if (result.error) throw result.error;
      refresh();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  };
  const assign = () => {
    if (!selected) return;
    run(async () => {
      const existing = await getStudentMaterialGrantForTeacher(studentId, selected);
      if (existing.error) return existing;
      return existing.data?.revoked_at
        ? restoreMaterialAccess({ materialId: selected, studentId })
        : shareMaterialWithStudent({ materialId: selected, studentId });
    });
  };
  const revokeAll = () => {
    if (!window.confirm(t("materialsFeature.confirmRevokeAll"))) return;
    run(() => revokeAllStudentMaterials(studentId));
  };

  return <section className={styles.section}>
    <h2>{t("materialsFeature.studentAccess")}</h2>
    {error && <p role="alert" className={styles.error}>{error}</p>}
    <div className={styles.controls}>
      <select value={selected} onChange={(event) => setSelected(event.target.value)} aria-label={t("materialsFeature.selectMaterial")}>
        <option value="">{t("materialsFeature.selectMaterial")}</option>
        {library.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      <button disabled={busy || !selected} onClick={assign}>{t("materialsFeature.assign")}</button>
      <button disabled={busy || !activeCount} onClick={revokeAll}>{t("materialsFeature.revokeAll")}</button>
    </div>
    {!total ? <p>{t("materialsFeature.noGrants")}</p> : (
      <>
        <div className={styles.list}>{grants.map((grant) => <div key={grant.id} className={styles.item}>
          <span>{grant.materials?.title ?? grant.material_id} {grant.revoked_at ? `(${t("materialsFeature.revoked")})` : ""}</span>
          <button disabled={busy} onClick={() => run(() => grant.revoked_at
            ? restoreMaterialAccess({ materialId: grant.material_id, studentId })
            : revokeMaterialFromStudent({ materialId: grant.material_id, studentId }))}>
            {grant.revoked_at ? t("materialsFeature.restore") : t("materialsFeature.revoke")}
          </button>
        </div>)}</div>
        <PaginationControls page={page} pageSize={pageSize} total={total} disabled={busy}
          onPageChange={setPage} previousLabel={t("commonPagination.previous")}
          nextLabel={t("commonPagination.next")}
          summary={t("commonPagination.summary", { current: page + 1, total: getPageCount(total, pageSize), count: total })} />
      </>
    )}
  </section>;
};
export default StudentMaterialAccess;
