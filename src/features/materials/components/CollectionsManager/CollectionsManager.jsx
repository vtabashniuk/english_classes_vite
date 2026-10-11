import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  deleteMaterialCollection, grantCollectionMaterialsToStudent, listGrantedMaterialsForStudentAssignment,
  listMaterialsByIds, saveMaterialCollection, searchMaterials,
} from "../../api/materialsApi";
import useToast from "../../../../shared/toast/useToast";
import AssignmentForm from "../../../assignments/components/AssignmentForm/AssignmentForm";
import usePagePreferences from "../../../../shared/pagination/usePagePreferences";
import PaginationControls from "../../../../shared/pagination/PaginationControls";
import styles from "./CollectionsManager.module.css";

const fresh = () => ({ id: null, name: "", kind: "automatic", level: "", tagMatch: "all", tagIds: [], materialIds: [] });
const normalize = (entry) => ({
  id: entry.id, name: entry.name, kind: entry.kind,
  level: entry.level || "", tagMatch: entry.tag_match,
  tagIds: (entry.material_collection_tags ?? []).map((item) => item.tag_id),
  materialIds: (entry.material_collection_items ?? []).map((item) => item.material_id),
});
const levels = ["", "A1", "A2", "B1", "B2", "C1", "C2"];


const CollectionsManager = ({ collections, tags, students = [], onChanged,
  page = 0, pageSize: collectionPageSize = 20, total = 0, onPageChange }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const { sizes } = usePagePreferences();
  const pageSize = sizes.teacherCollections;
  const [editor, setEditor] = useState(null);
  const [materialQuery, setMaterialQuery] = useState("");
  const [candidatePage, setCandidatePage] = useState(0);
  const [candidateHasNext, setCandidateHasNext] = useState(false);
  const [candidates, setCandidates] = useState([]);
  const [selectedNames, setSelectedNames] = useState([]);
  const [preview, setPreview] = useState([]);
  const [previewId, setPreviewId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [previewPage, setPreviewPage] = useState(0);
  const [hasNext, setHasNext] = useState(false);
  const [selectedIds, setSelectedIds] = useState([]);
  const [studentId, setStudentId] = useState("");
  const [assignmentDraft, setAssignmentDraft] = useState(null);
  const selectedCount = selectedIds.length;
  const tagNames = useMemo(() => new Map(tags.map((tag) => [tag.id, tag.name])), [tags]);

  useEffect(() => {
    if (!editor || editor.kind !== "manual") return undefined;
    let alive = true;
    const handle = setTimeout(async () => {
      const [searchResult, selectedResult] = await Promise.all([
        searchMaterials({ query: materialQuery, offset: candidatePage * pageSize, limit: pageSize + 1 }),
        listMaterialsByIds(editor.materialIds),
      ]);
      if (alive) {
        setCandidates(searchResult.error ? [] : (searchResult.data ?? []).slice(0, pageSize));
        setCandidateHasNext(!searchResult.error && (searchResult.data ?? []).length > pageSize);
        setSelectedNames(selectedResult.error ? [] : selectedResult.data ?? []);
      }
    }, 200);
    return () => { alive = false; clearTimeout(handle); };
  }, [editor, materialQuery, candidatePage, pageSize]);

  const editField = (field, value) => setEditor((current) => ({ ...current, [field]: value }));
  const toggleTag = (id) => editField("tagIds", editor.tagIds.includes(id) ? editor.tagIds.filter((item) => item !== id) : [...editor.tagIds, id]);
  const toggleMaterial = (id) => editField("materialIds", editor.materialIds.includes(id) ? editor.materialIds.filter((item) => item !== id) : [...editor.materialIds, id]);

  const save = async () => {
    if (!editor.name.trim() || (editor.kind === "automatic" && !editor.level && !editor.tagIds.length)) {
      toast.warning(t("materialsCatalog.collectionValidation")); return;
    }
    setBusy(true);
    try {
      const { error } = await saveMaterialCollection(editor);
      if (error) throw error;
      setEditor(null); await onChanged(); toast.success(t("materialsCatalog.collectionSaved"));
    } catch (error) { console.error("Save collection:", error); toast.error(t("materialsCatalog.operationFailed")); }
    finally { setBusy(false); }
  };
  const remove = async (item) => {
    if (!window.confirm(t("materialsCatalog.deleteCollectionConfirm", { name: item.name }))) return;
    setBusy(true);
    try {
      const { error } = await deleteMaterialCollection(item.id);
      if (error) throw error;
      if (previewId === item.id) { setPreviewId(null); setPreview([]); setSelectedIds([]); setAssignmentDraft(null); }
      await onChanged(); toast.success(t("materialsCatalog.collectionDeleted"));
    } catch (error) { console.error("Delete collection:", error); toast.error(t("materialsCatalog.operationFailed")); }
    finally { setBusy(false); }
  };
  const loadPreview = async (collection, page) => {
    setBusy(true);
    try {
      const value = normalize(collection);
      let result;
      if (value.kind === "manual") {
        // A manual collection is an explicit, ordered set; page it before querying.
        const ids = value.materialIds.slice(page * pageSize, (page + 1) * pageSize + 1);
        result = await listMaterialsByIds(ids);
      } else {
        result = await searchMaterials({ level: value.level, tagIds: value.tagIds,
          tagMatch: value.tagMatch, offset: page * pageSize, limit: pageSize + 1 });
      }
      if (result.error) throw result.error;
      const matches = result.data ?? [];
      let visible = matches.slice(0, pageSize);
      if (value.kind === "automatic" && visible.length) {
        const details = await listMaterialsByIds(visible.map((item) => item.id));
        if (details.error) throw details.error;
        const byId = new Map((details.data ?? []).map((item) => [item.id, item]));
        visible = visible.map((item) => byId.get(item.id) || item);
      }
      setPreview(visible);
      setPreviewPage(page);
      setHasNext(matches.length > pageSize);
      setPreviewId(collection.id);
    } catch (error) {
      console.error("Collection preview:", error);
      toast.error(t("materialsCatalog.operationFailed"));
    } finally { setBusy(false); }
  };
  const showPreview = async (collection) => {
    if (previewId === collection.id) {
      setPreviewId(null); setPreview([]); setSelectedIds([]); setAssignmentDraft(null);
      return;
    }
    setSelectedIds([]); setStudentId(""); setAssignmentDraft(null);
    await loadPreview(collection, 0);
  };
  const toggleSelected = (id) => {
    if (!selectedIds.includes(id) && selectedIds.length >= 100) {
      toast.warning(t("materialsCatalog.selectionLimit"));
      return;
    }
    setSelectedIds((current) => current.includes(id)
      ? current.filter((item) => item !== id) : [...current, id]);
  };
  const togglePageSelection = () => {
    const pageIds = preview.map((m) => m.id);
    setSelectedIds((current) => pageIds.every((id) => current.includes(id))
      ? current.filter((id) => !pageIds.includes(id))
      : [...new Set([...current, ...pageIds])].slice(0, 100));
  };
  const grantAccess = async () => {
    if (!studentId || !selectedIds.length) return;
    setBusy(true);
    try {
      const { error } = await grantCollectionMaterialsToStudent(studentId, selectedIds);
      if (error) throw error;
      toast.success(t("materialsCatalog.bulkGranted"));
    } catch (error) {
      console.error("Collection access:", error);
      toast.error(t("materialsCatalog.operationFailed"));
    } finally { setBusy(false); }
  };
  const createAssignment = async () => {
    if (!studentId || !selectedIds.length) return;
    setBusy(true);
    try {
      // Creating a homework must never silently share resources.
      const { data, error } = await listGrantedMaterialsForStudentAssignment(studentId);
      if (error) throw error;
      const allowed = new Set((data ?? []).map((m) => m.id));
      if (!selectedIds.every((id) => allowed.has(id))) {
        toast.warning(t("materialsCatalog.shareBeforeAssignment")); return;
      }
      setAssignmentDraft({ studentId, materialIds: [...selectedIds] });
    } catch (error) {
      console.error("Collection assignment:", error);
      toast.error(t("materialsCatalog.operationFailed"));
    } finally { setBusy(false); }
  };
  const tagCriteria = (collection) => (collection.material_collection_tags ?? [])
    .map((item) => tagNames.get(item.tag_id)).filter(Boolean);
  return (
    <div className={styles.wrapper}>
      <button type="button" className={styles.button} onClick={() => { setEditor(fresh()); setPreviewId(null); }}>
        + {t("materialsCatalog.newCollection")}
      </button>
      {editor && <div className={styles.editor}>
        <label>{t("materialsCatalog.collectionName")}
          <input value={editor.name} maxLength={120} onChange={(e) => editField("name", e.target.value)} />
        </label>
        <label>{t("materialsCatalog.collectionType")}
          <select value={editor.kind} onChange={(e) => editField("kind", e.target.value)}>
            <option value="automatic">{t("materialsCatalog.automatic")}</option>
            <option value="manual">{t("materialsCatalog.manual")}</option>
          </select>
        </label>
        {editor.kind === "automatic" ? <>
          <label>{t("materialsFeature.level")}
            <select value={editor.level} onChange={(e) => editField("level", e.target.value)}>
              {levels.map((level) => <option key={level} value={level}>{level || t("materialsFeature.allLevels")}</option>)}
            </select>
          </label>
          <label>{t("materialsCatalog.tagMatch")}
            <select value={editor.tagMatch} onChange={(e) => editField("tagMatch", e.target.value)}>
              <option value="all">{t("materialsCatalog.matchAll")}</option>
              <option value="any">{t("materialsCatalog.matchAny")}</option>
            </select>
          </label>
          <div className={styles.tagOptions}>
            {tags.map(({ id, name }) => (
              <label key={id}><input type="checkbox" checked={editor.tagIds.includes(id)} onChange={() => toggleTag(id)} /> #{name}</label>
            ))}
          </div>
          <p className={styles.hint}>{t("materialsCatalog.automaticHint")}</p>
        </> : <>
          <label>{t("materialsCatalog.findForCollection")}
            <input type="search" value={materialQuery} onChange={(e) => { setMaterialQuery(e.target.value); setCandidatePage(0); }} />
          </label>
          <div className={styles.materialOptions}>
            {candidates.map((m) => (
              <label key={m.id}><input type="checkbox" checked={editor.materialIds.includes(m.id)} onChange={() => toggleMaterial(m.id)} /> {m.title}</label>
            ))}
          </div>
          {(candidateHasNext || candidatePage > 0) && <PaginationControls page={candidatePage} pageSize={pageSize}
            total={null} hasMore={candidateHasNext} disabled={busy} onPageChange={setCandidatePage}
            previousLabel={t("commonPagination.previous")} nextLabel={t("commonPagination.next")}
            summary={t("studentMaterials.pageSummary", { page: candidatePage + 1 })} />}
          <div className={styles.chips}>{selectedNames.map((m) => (
            <button type="button" key={m.id} onClick={() => toggleMaterial(m.id)}>{m.title} ×</button>
          ))}</div>
        </>}
        <div className={styles.actions}>
          <button type="button" className={styles.button} disabled={busy} onClick={save}>{t("materialsCatalog.save")}</button>
          <button type="button" className={styles.button} onClick={() => setEditor(null)}>{t("materialsCatalog.cancel")}</button>
        </div>
      </div>}
      <div className={styles.list}>{collections.map((collection) => (
        <div key={collection.id} className={styles.collection}>
          <div className={styles.row}>
            <div className={styles.heading}>
              <strong>{collection.name}</strong>
              <small>{t(collection.kind === "automatic" ? "materialsCatalog.automatic" : "materialsCatalog.manual")}</small>
              {collection.kind === "automatic" ? (
                <div className={styles.criteria}>
                  {collection.level && <span>{collection.level}</span>}
                  {tagCriteria(collection).map((tag) => <span key={tag}>#{tag}</span>)}
                  {tagCriteria(collection).length > 0 && <small>{t(collection.tag_match === "any" ? "materialsCatalog.matchAny" : "materialsCatalog.matchAll")}</small>}
                </div>
              ) : <small>{t("materialsCatalog.manualCount", { count: collection.material_collection_items?.length ?? 0 })}</small>}
            </div>
            <button type="button" disabled={busy} onClick={() => showPreview(collection)}>
              {t(previewId === collection.id ? "materialsCatalog.closePreview" : "materialsCatalog.viewCollection")}
            </button>
            <button type="button" disabled={busy} onClick={() => { setEditor(normalize(collection)); setMaterialQuery(""); }}>
              {t("materialsCatalog.edit")}
            </button>
            <button type="button" disabled={busy} onClick={() => remove(collection)}>{t("materialsCatalog.delete")}</button>
          </div>
          {previewId === collection.id && <div className={styles.preview}>
            <p className={styles.hint}>{t("materialsCatalog.selectHint")}</p>
            <div className={styles.selectionBar}>
              <button type="button" onClick={togglePageSelection} disabled={!preview.length}>
                {t("materialsCatalog.togglePage")}
              </button>
              <small>{t("materialsCatalog.selectedCount", { count: selectedCount })}</small>
            </div>
            {preview.map((m) => <article className={styles.materialCard} key={m.id}>
              <input type="checkbox" aria-label={m.title} checked={selectedIds.includes(m.id)}
                disabled={selectedIds.length >= 100 && !selectedIds.includes(m.id)} onChange={() => toggleSelected(m.id)} />
              <div className={styles.materialContent}>
                <strong>{m.title}</strong>
                {m.description && <p>{m.description}</p>}
                <div className={styles.criteria}>
                  {m.level && <span>{m.level}</span>}
                  {(m.tags ?? []).map((tag) => <span key={tag}>#{tag}</span>)}
                </div>
                {(m.material_resources ?? []).filter((r) => r.external_url).map((r) =>
                  <a key={r.id} href={r.external_url} target="_blank" rel="noopener noreferrer">{r.title} ↗</a>
                )}
              </div>
            </article>)}
            {!preview.length && <p>{t("materialsCatalog.noMatches")}</p>}
            <PaginationControls page={previewPage} pageSize={pageSize} total={null} hasMore={hasNext}
              disabled={busy} onPageChange={(nextPage) => loadPreview(collection, nextPage)}
              previousLabel={t("commonPagination.previous")} nextLabel={t("commonPagination.next")}
              summary={t("studentMaterials.pageSummary", { page: previewPage + 1 })} />
            <div className={styles.grantPanel}>
              <label>{t("materialsCatalog.studentForCollection")}
                <select value={studentId} onChange={(event) => { setStudentId(event.target.value); setAssignmentDraft(null); }}>
                  <option value="">{t("materialsCatalog.chooseStudent")}</option>
                  {students.map((student) => <option key={student.id} value={student.id}>
                    {student.full_name || student.email}
                  </option>)}
                </select>
              </label>
              <div className={styles.actions}>
                <button type="button" disabled={busy || !studentId || !selectedCount} onClick={grantAccess}>
                  {t("materialsCatalog.grantSelected")}
                </button>
                <button type="button" disabled={busy || !studentId || !selectedCount} onClick={createAssignment}>
                  {t("materialsCatalog.assignmentFromSelected")}
                </button>
              </div>
              {assignmentDraft && <AssignmentForm
                key={`${assignmentDraft.studentId}-${assignmentDraft.materialIds.join("-")}`}
                studentId={assignmentDraft.studentId}
                initialMaterialIds={assignmentDraft.materialIds}
                onSaved={() => setAssignmentDraft(null)}
                onCancel={() => setAssignmentDraft(null)}
              />}
            </div>
          </div>}
        </div>
      ))}</div>
      {total > collectionPageSize && <PaginationControls page={page} pageSize={collectionPageSize}
        total={total} disabled={busy} onPageChange={(next) => { setPreviewId(null); setSelectedIds([]); onPageChange(next); }}
        previousLabel={t("commonPagination.previous")} nextLabel={t("commonPagination.next")}
        summary={t("studentMaterials.pageSummary", { page: page + 1 })} />}
      {!total && <p className={styles.hint}>{t("materialsCatalog.noCollections")}</p>}
    </div>
  );
};
export default CollectionsManager;
