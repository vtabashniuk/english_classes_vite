import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "../../components/common/ui/Button/Button";
import { useAuth } from "../../context/useAuth";
import {
  listMaterialTags,
  listMaterialCollections,
  revokeMaterialFromStudent,
  restoreMaterialAccess,
  saveExternalMaterial,
  deleteMaterial,
  listTeacherMaterialsWithAssignments,
  shareMaterialWithStudent,
} from "../../features/materials/api/materialsApi";
import { listActiveStudents } from "../../features/profiles/api/profilesApi";

import { getMaterialResourceLabel, validateMaterial } from "../../features/materials/lib/materialValidation";
import TagPicker from "../../features/materials/components/TagPicker/TagPicker";
import TagManager from "../../features/materials/components/TagManager/TagManager";
import CollectionsManager from "../../features/materials/components/CollectionsManager/CollectionsManager";
import useToast from "../../shared/toast/useToast";
import usePagePreferences from "../../shared/pagination/usePagePreferences";
import PaginationControls from "../../shared/pagination/PaginationControls";
import styles from "./TeacherMaterials.module.css";



const newResourceRow = () => ({ key: crypto.randomUUID(), title: "", url: "" });
const emptyForm = () => ({ title: "", description: "", resources: [newResourceRow()], tags: [], level: "" });

const TeacherMaterials = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { sizes } = usePagePreferences();
  const pageSize = sizes.teacherMaterials;
  const collectionPageSize = sizes.teacherCollectionList;
  const { profile } = useAuth();
  const [materials, setMaterials] = useState([]);
  const [students, setStudents] = useState([]);
  const [tags, setTags] = useState([]);
  const [collections, setCollections] = useState([]);
  const [collectionPage, setCollectionPage] = useState(0);
  const [collectionTotal, setCollectionTotal] = useState(0);
  const [toolPanel, setToolPanel] = useState("");
  const [query, setQuery] = useState("");
  const [filterLevel, setFilterLevel] = useState("");
  const [filterTag, setFilterTag] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [shareStudentByMaterial, setShareStudentByMaterial] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processingId, setProcessingId] = useState(null);

  const sortedMaterials = useMemo(() => materials.filter((material) => !material.archived_at), [materials]);

  const loadData = async () => {
    const [materialResult, studentResult, tagResult, collectionResult] = await Promise.all([
      listTeacherMaterialsWithAssignments(query, page * pageSize, pageSize + 1, filterLevel, filterTag ? [filterTag] : []),
      listActiveStudents(), listMaterialTags(), listMaterialCollections({ page: collectionPage, pageSize: collectionPageSize }),
    ]);
    const error = materialResult.error || studentResult.error || tagResult.error || collectionResult.error;
    if (error) throw error;
    setMaterials((materialResult.data ?? []).slice(0, pageSize));
    setHasMore((materialResult.data ?? []).length > pageSize);
    setStudents(studentResult.data ?? []);
    setTags(tagResult.data ?? []);
    setCollections(collectionResult.data ?? []);
    setCollectionTotal(collectionResult.count ?? 0);
    if (collectionPage > 0 && (collectionResult.count ?? 0) <= collectionPage * collectionPageSize) {
      setCollectionPage(Math.max(0, Math.ceil((collectionResult.count ?? 0) / collectionPageSize) - 1));
    }
  };

  useEffect(() => {
    let alive = true;
    const initialize = async () => {
      try {
        const [materialResult, studentResult, tagResult, collectionResult] = await Promise.all([
          listTeacherMaterialsWithAssignments(query, page * pageSize, pageSize + 1, filterLevel, filterTag ? [filterTag] : []),
          listActiveStudents(), listMaterialTags(), listMaterialCollections({ page: collectionPage, pageSize: collectionPageSize }),
        ]);
        const error = materialResult.error || studentResult.error || tagResult.error || collectionResult.error;
        if (error) throw error;
        if (!alive) return;
        setMaterials((materialResult.data ?? []).slice(0, pageSize));
        setHasMore((materialResult.data ?? []).length > pageSize);
        setStudents(studentResult.data ?? []);
        setTags(tagResult.data ?? []);
        setCollections(collectionResult.data ?? []);
        setCollectionTotal(collectionResult.count ?? 0);
        if (collectionPage > 0 && (collectionResult.count ?? 0) <= collectionPage * collectionPageSize) {
          setCollectionPage(Math.max(0, Math.ceil((collectionResult.count ?? 0) / collectionPageSize) - 1));
        }
      } catch (error) {
        console.error("Teacher materials load error:", error);
        if (alive) toast.error(t("teacherMaterials.errors.load"));
      } finally {
        if (alive) setLoading(false);
      }
    };
    const timer = setTimeout(initialize, 200);
    return () => { alive = false; clearTimeout(timer); };
  }, [profile?.id, t, query, filterLevel, filterTag, page, pageSize, collectionPage, collectionPageSize, toast]);

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const updateResource = (key, field, value) => {
    setForm((current) => ({ ...current, resources: current.resources.map((resource) =>
      resource.key === key ? { ...resource, [field]: value } : resource),
    }));
  };

  const addResource = () => setForm((current) => ({
    ...current, resources: [...current.resources, newResourceRow()],
  }));

  const removeResource = (key) => setForm((current) => ({
    ...current, resources: current.resources.filter((resource) => resource.key !== key),
  }));

  const resetForm = () => {
    setForm(emptyForm());
    setEditingId(null);
  };

  const closeForm = () => {
    resetForm();
    setFormOpen(false);
  };

  const handleOpenCreateForm = () => {
    resetForm();
    setFormOpen(true);

    requestAnimationFrame(() => {
      document.getElementById("material-form")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    const resources = form.resources.map(({ title, url }) => ({ title: title.trim(), url: url.trim() }));
    const validationError = validateMaterial({ ...form, resources });
    if (validationError) { toast.warning(t(validationError)); return; }

    try {
      setSaving(true);

      const { error } = await saveExternalMaterial({
        materialId: editingId,
        payload: {
          title: form.title.trim(), description: form.description.trim(),
          tags: form.tags, resources, level: form.level,
        },
      });

      if (error) {
        throw error;
      }

      const wasEditing = Boolean(editingId);

      closeForm();
      await loadData();
      toast.success(t(wasEditing ? "teacherMaterials.messages.updated" : "teacherMaterials.messages.created"));
    } catch (error) {
      console.error("Save material error:", error);
      toast.error(t("teacherMaterials.errors.save"));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (material) => {
    setEditingId(material.id);
    setForm({
      title: material.title || "",
      description: material.description || "",
      resources: (material.material_resources?.length
        ? [...material.material_resources].sort((a, b) => a.sort_order - b.sort_order).map((item, index) => ({
          key: item.id, title: getMaterialResourceLabel(item, index, t), url: item.external_url || "",
        }))
        : [{ key: crypto.randomUUID(), title: material.title || "", url: material.url || "" }]),
      tags: material.tags ?? [],
      level: material.level || "",
    });
    setFormOpen(true);

    requestAnimationFrame(() => {
      document.getElementById("material-form")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const handleDelete = async (material) => {
    if (!window.confirm(t("teacherMaterials.deleteConfirm", { title: material.title }))) {
      return;
    }

    try {
      setProcessingId(material.id);

      const { error } = await deleteMaterial(material.id);

      if (error) {
        throw error;
      }

      if (editingId === material.id) {
        closeForm();
      }

      await loadData();
      toast.success(t("teacherMaterials.messages.deleted"));
    } catch (error) {
      console.error("Delete material error:", error);
      toast.error(t("teacherMaterials.errors.delete"));
    } finally {
      setProcessingId(null);
    }
  };

  const handleShare = async (material) => {
    const studentId = shareStudentByMaterial[material.id];

    if (!studentId) {
      return;
    }

    try {
      setProcessingId(material.id);

      const existing = (material.student_materials ?? []).find((row) => row.student_id === studentId);
      const { error } = existing?.revoked_at
        ? await restoreMaterialAccess({ materialId: material.id, studentId })
        : await shareMaterialWithStudent({ materialId: material.id, studentId });

      if (error) {
        throw error;
      }

      toast.success(t("teacherMaterials.messages.shared"));
      setShareStudentByMaterial((current) => ({
        ...current,
        [material.id]: "",
      }));
      await loadData();
    } catch (error) {
      console.error("Share material error:", error);
      toast.error(t("teacherMaterials.errors.share"));
    } finally {
      setProcessingId(null);
    }
  };

  const handleAccess = async (material, studentId, active) => {
    try {
      setProcessingId(material.id);
      const result = active
        ? await revokeMaterialFromStudent({ materialId: material.id, studentId })
        : await restoreMaterialAccess({ materialId: material.id, studentId });
      if (result.error) throw result.error;
      await loadData();
      toast.success(t(active ? "materialsCatalog.accessRevoked" : "materialsCatalog.accessRestored"));
    } catch (error) {
      console.error("Material access change failed", error);
      toast.error(t("teacherMaterials.errors.share"));
    } finally { setProcessingId(null); }
  };

  if (loading) {
    return (
      <section className={styles.page}>
        <div className={styles.state}>{t("teacherMaterials.loading")}</div>
      </section>
    );
  }

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>{t("teacherMaterials.title")}</h1>
          <p>{t("teacherMaterials.description")}</p>
        </div>

        {!formOpen && (
          <Button variant="primary" size="large" onClick={handleOpenCreateForm}>
            {t("teacherMaterials.form.openCreate")}
          </Button>
        )}
      </header>

      {formOpen && (
        <section id="material-form" className={styles.panel}>
          <h2>
            {t(
              editingId
                ? "teacherMaterials.form.editTitle"
                : "teacherMaterials.form.createTitle",
            )}
          </h2>

          <form className={styles.form} onSubmit={handleSubmit}>
            <label className={styles.field}>
              <span>{t("teacherMaterials.form.title")}</span>
              <input value={form.title} onChange={(event) => updateForm("title", event.target.value)} required />
            </label>

            <fieldset className={styles.resourceFieldset}>
              <legend>{t("materialsFeature.resourcesTitle")}</legend>
              <p className={styles.fieldHint}>{t("materialsFeature.resourcesHint")}</p>
              {form.resources.map((resource, index) => (
                <div key={resource.key} className={styles.resourceRow}>
                  <label className={styles.field}>
                    <span>{t("materialsFeature.resourceName", { number: index + 1 })}</span>
                    <input value={resource.title} onChange={(event) => updateResource(resource.key, "title", event.target.value)} required maxLength={200} placeholder={t("materialsFeature.resourceNamePlaceholder")} />
                  </label>
                  <label className={styles.field}>
                    <span>{t("materialsFeature.resourceUrl")}</span>
                    <input type="url" value={resource.url} onChange={(event) => updateResource(resource.key, "url", event.target.value)} required placeholder="https://..." />
                  </label>
                  {form.resources.length > 1 && <button type="button" className={styles.removeResource} onClick={() => removeResource(resource.key)} aria-label={t("materialsFeature.removeResource", { number: index + 1 })}>
                    {t("materialsFeature.removeResource", { number: index + 1 })}
                  </button>}
                </div>
              ))}
              <button type="button" className={styles.addResource} onClick={addResource}>{t("materialsFeature.addResource")}</button>
            </fieldset>

            <div className={styles.field}>
              <span>{t("materialsCatalog.tagsOptional")}</span>
              <TagPicker value={form.tags} onChange={(value) => updateForm("tags", value)} catalog={tags} />
            </div>
            <label className={styles.field}><span>{t("materialsFeature.level")}</span>
              <select value={form.level} onChange={(event) => updateForm("level", event.target.value)}>
                {["", "A1", "A2", "B1", "B2", "C1", "C2"].map((level) => <option key={level} value={level}>{level || t("materialsFeature.allLevels")}</option>)}
              </select>
            </label>
            <label className={styles.field}>
              <span>{t("teacherMaterials.form.description")}</span>
              <textarea
                value={form.description}
                onChange={(event) => updateForm("description", event.target.value)}
                rows="3"
                required
              />
            </label>

            <div className={styles.actions}>
              <Button type="submit" variant="primary" size="large" disabled={saving}>
                {saving
                  ? t("teacherMaterials.form.saving")
                  : t(
                      editingId
                        ? "teacherMaterials.form.save"
                        : "teacherMaterials.form.create",
                    )}
              </Button>

              <Button onClick={closeForm} disabled={saving}>
                {t("teacherMaterials.form.cancel")}
              </Button>
            </div>
          </form>
        </section>
      )}


      <section className={styles.catalogTools}>
        <div className={styles.toolButtons}>
          <Button onClick={() => setToolPanel((value) => value === "tags" ? "" : "tags")}>{t("materialsCatalog.manageTags")}</Button>
          <Button onClick={() => setToolPanel((value) => value === "collections" ? "" : "collections")}>{t("materialsCatalog.collections")}</Button>
        </div>
        {toolPanel === "tags" && <div className={styles.panel}>
          <h2>{t("materialsCatalog.manageTags")}</h2>
          <TagManager tags={tags} onChanged={loadData} />
        </div>}
        {toolPanel === "collections" && <div className={styles.panel}>
          <h2>{t("materialsCatalog.collections")}</h2>
          <CollectionsManager collections={collections} tags={tags} students={students} onChanged={loadData}
            page={collectionPage} pageSize={collectionPageSize} total={collectionTotal} onPageChange={setCollectionPage} />
        </div>}
      </section>

      <section className={styles.listSection}>
        <h2>{t("teacherMaterials.libraryTitle")}</h2>
        <div className={styles.catalogFilters}>
          <label className={styles.field}><span>{t("materialsFeature.search")}</span>
            <input type="search" value={query} onChange={(event) => { setQuery(event.target.value); setPage(0); }} placeholder={t("materialsFeature.searchPlaceholder")} />
          </label>
          <label className={styles.field}><span>{t("materialsFeature.level")}</span>
            <select value={filterLevel} onChange={(event) => { setFilterLevel(event.target.value); setPage(0); }}>
              {["", "A1", "A2", "B1", "B2", "C1", "C2"].map((value) => <option key={value} value={value}>{value || t("materialsFeature.allLevels")}</option>)}
            </select>
          </label>
          <label className={styles.field}><span>{t("materialsCatalog.filterTag")}</span>
            <select value={filterTag} onChange={(event) => { setFilterTag(event.target.value); setPage(0); }}>
              <option value="">{t("materialsCatalog.allTags")}</option>
              {tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
            </select>
          </label>
        </div>

        {sortedMaterials.length === 0 ? (
          <div className={styles.empty}>{t("teacherMaterials.empty")}</div>
        ) : (
          <div className={styles.list}>
            {sortedMaterials.map((material) => {
              const sharedIds = new Set(
                (material.student_materials ?? []).filter((row) => !row.revoked_at).map((row) => row.student_id),
              );

              return (
                <article key={material.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <div>
                      <h3>{material.title}</h3>
                      {material.description && <p>{material.description}</p>}
                    </div>

                    <span className={styles.sharedCount}>
                      {t("teacherMaterials.sharedCount", { count: sharedIds.size })}
                    </span>
                  </div>

                  <div className={styles.tags}>
                    {(material.tags ?? []).map((tag) => <span key={tag} className={styles.tag}>#{tag}</span>)}
                  </div>
                  <div className={styles.resourceLinks}>
                    {(material.material_resources ?? []).slice().sort((a, b) => a.sort_order - b.sort_order).map((resource, index) => (
                      <a key={resource.id} className={styles.link} href={resource.external_url} target="_blank" rel="noopener noreferrer" aria-label={t("materialsFeature.openNamedResource", { title: getMaterialResourceLabel(resource, index, t) })}>
                        {getMaterialResourceLabel(resource, index, t)} ↗
                      </a>
                    ))}
                  </div>

                  <div className={styles.shareRow}>
                    <select
                      value={shareStudentByMaterial[material.id] || ""}
                      onChange={(event) =>
                        setShareStudentByMaterial((current) => ({
                          ...current,
                          [material.id]: event.target.value,
                        }))
                      }
                    >
                      <option value="">{t("teacherMaterials.selectStudent")}</option>
                      {students.map((student) => (
                        <option
                          key={student.id}
                          value={student.id}
                          disabled={sharedIds.has(student.id)}
                        >
                          {student.full_name || student.email}
                          {sharedIds.has(student.id)
                            ? ` — ${t("teacherMaterials.alreadyShared")}`
                            : ""}
                        </option>
                      ))}
                    </select>

                    <Button
                      variant="primary"
                      onClick={() => handleShare(material)}
                      disabled={
                        !shareStudentByMaterial[material.id] ||
                        processingId === material.id
                      }
                    >
                      {t("teacherMaterials.share")}
                    </Button>
                  </div>

                  <div className={styles.accessList}>
                    {(material.student_materials ?? []).map((assignment) => {
                      const student = students.find((row) => row.id === assignment.student_id);
                      return <div key={assignment.student_id} className={styles.accessRow}>
                        <span>{student?.full_name || student?.email || assignment.student_id}</span>
                        <Button disabled={processingId === material.id} onClick={() => handleAccess(material, assignment.student_id, !assignment.revoked_at)}>
                          {assignment.revoked_at ? t("materialsFeature.restore") : t("materialsFeature.revoke")}
                        </Button>
                      </div>;
                    })}
                  </div>
                  <div className={styles.cardActions}>
                    <Button onClick={() => handleEdit(material)}>
                      {t("teacherMaterials.edit")}
                    </Button>
                    <Button
                      variant="danger"
                      onClick={() => handleDelete(material)}
                      disabled={processingId === material.id}
                    >
                      {t("teacherMaterials.delete")}
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
        <PaginationControls page={page} pageSize={pageSize} total={null} hasMore={hasMore}
          disabled={loading} onPageChange={setPage}
          previousLabel={t("commonPagination.previous")} nextLabel={t("commonPagination.next")}
          summary={t("studentMaterials.pageSummary", { page: page + 1 })} />
      </section>
    </section>
  );
};

export default TeacherMaterials;
