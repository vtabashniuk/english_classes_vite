import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import Button from "../../components/common/ui/Button/Button";
import { useAuth } from "../../context/AuthContext";
import { supabase } from "../../lib/supabase";

import styles from "./TeacherMaterials.module.css";

const EMPTY_FORM = { title: "", description: "", url: "", category: "" };

const TeacherMaterials = () => {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const [materials, setMaterials] = useState([]);
  const [students, setStudents] = useState([]);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState(null);
  const [shareStudentByMaterial, setShareStudentByMaterial] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [processingId, setProcessingId] = useState(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [successMessage, setSuccessMessage] = useState("");

  const sortedMaterials = useMemo(
    () => [...materials].sort((a, b) => a.title.localeCompare(b.title)),
    [materials],
  );

  const loadData = async () => {
    const [
      { data: materialRows, error: materialsError },
      { data: studentRows, error: studentsError },
    ] = await Promise.all([
      supabase
        .from("materials")
        .select(
          "id, title, description, url, category, created_at, student_materials(student_id)",
        )
        .order("created_at", { ascending: false }),
      supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "student")
        .eq("is_active", true)
        .order("full_name"),
    ]);

    if (materialsError) throw materialsError;
    if (studentsError) throw studentsError;

    setMaterials(materialRows ?? []);
    setStudents(studentRows ?? []);
  };

  useEffect(() => {
    const initialize = async () => {
      try {
        setLoading(true);
        await loadData();
      } catch (error) {
        console.error("Teacher materials load error:", error);
        setErrorMessage(t("teacherMaterials.errors.load"));
      } finally {
        setLoading(false);
      }
    };

    initialize();
  }, [profile?.id, t]);

  const updateForm = (field, value) => {
    setForm((current) => ({ ...current, [field]: value }));
  };

  const resetForm = () => {
    setForm(EMPTY_FORM);
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
      document.getElementById("material-form")?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  const handleSubmit = async (event) => {
    event.preventDefault();

    if (!form.title.trim() || !form.url.trim()) {
      return;
    }

    try {
      setSaving(true);
      setErrorMessage("");
      setSuccessMessage("");

      const payload = {
        title: form.title.trim(),
        description: form.description.trim() || null,
        url: form.url.trim(),
        category: form.category.trim() || null,
      };

      const { error } = editingId
        ? await supabase
            .from("materials")
            .update({ ...payload, updated_at: new Date().toISOString() })
            .eq("id", editingId)
        : await supabase
            .from("materials")
            .insert({ ...payload, teacher_id: profile.id });

      if (error) {
        throw error;
      }

      const wasEditing = Boolean(editingId);

      closeForm();
      setSuccessMessage(
        t(
          wasEditing
            ? "teacherMaterials.messages.updated"
            : "teacherMaterials.messages.created",
        ),
      );
      await loadData();
    } catch (error) {
      console.error("Save material error:", error);
      setErrorMessage(t("teacherMaterials.errors.save"));
    } finally {
      setSaving(false);
    }
  };

  const handleEdit = (material) => {
    setEditingId(material.id);
    setForm({
      title: material.title || "",
      description: material.description || "",
      url: material.url || "",
      category: material.category || "",
    });
    setErrorMessage("");
    setSuccessMessage("");
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
      setErrorMessage("");
      setSuccessMessage("");

      const { error } = await supabase.from("materials").delete().eq("id", material.id);

      if (error) {
        throw error;
      }

      if (editingId === material.id) {
        closeForm();
      }

      setSuccessMessage(t("teacherMaterials.messages.deleted"));
      await loadData();
    } catch (error) {
      console.error("Delete material error:", error);
      setErrorMessage(t("teacherMaterials.errors.delete"));
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
      setErrorMessage("");
      setSuccessMessage("");

      const { error } = await supabase.rpc("share_material_with_student", {
        p_material_id: material.id,
        p_student_id: studentId,
      });

      if (error) {
        throw error;
      }

      setSuccessMessage(t("teacherMaterials.messages.shared"));
      setShareStudentByMaterial((current) => ({
        ...current,
        [material.id]: "",
      }));
      await loadData();
    } catch (error) {
      console.error("Share material error:", error);
      setErrorMessage(t("teacherMaterials.errors.share"));
    } finally {
      setProcessingId(null);
    }
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
            <div className={styles.formRow}>
              <label className={styles.field}>
                <span>{t("teacherMaterials.form.title")}</span>
                <input
                  value={form.title}
                  onChange={(event) => updateForm("title", event.target.value)}
                  required
                />
              </label>

              <label className={styles.field}>
                <span>{t("teacherMaterials.form.category")}</span>
                <input
                  value={form.category}
                  onChange={(event) => updateForm("category", event.target.value)}
                />
              </label>
            </div>

            <label className={styles.field}>
              <span>{t("teacherMaterials.form.url")}</span>
              <input
                type="url"
                value={form.url}
                onChange={(event) => updateForm("url", event.target.value)}
                placeholder="https://..."
                required
              />
            </label>

            <label className={styles.field}>
              <span>{t("teacherMaterials.form.description")}</span>
              <textarea
                value={form.description}
                onChange={(event) => updateForm("description", event.target.value)}
                rows="3"
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

      {errorMessage && <p className={styles.error}>{errorMessage}</p>}
      {successMessage && <p className={styles.success}>{successMessage}</p>}

      <section className={styles.listSection}>
        <h2>{t("teacherMaterials.libraryTitle")}</h2>

        {sortedMaterials.length === 0 ? (
          <div className={styles.empty}>{t("teacherMaterials.empty")}</div>
        ) : (
          <div className={styles.list}>
            {sortedMaterials.map((material) => {
              const sharedIds = new Set(
                (material.student_materials ?? []).map((row) => row.student_id),
              );

              return (
                <article key={material.id} className={styles.card}>
                  <div className={styles.cardTop}>
                    <div>
                      {material.category && (
                        <span className={styles.category}>{material.category}</span>
                      )}
                      <h3>{material.title}</h3>
                      {material.description && <p>{material.description}</p>}
                    </div>

                    <span className={styles.sharedCount}>
                      {t("teacherMaterials.sharedCount", { count: sharedIds.size })}
                    </span>
                  </div>

                  <a
                    className={styles.link}
                    href={material.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {t("teacherMaterials.open")}
                  </a>

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
      </section>
    </section>
  );
};

export default TeacherMaterials;
