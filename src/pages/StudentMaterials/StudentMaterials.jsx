import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../../lib/supabase";
import styles from "./StudentMaterials.module.css";

const StudentMaterials = () => {
  const { t } = useTranslation();
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from("student_materials")
          .select("id, assigned_at, materials(id, title, description, url, category)")
          .order("assigned_at", { ascending: false });
        if (error) throw error;
        setItems(data ?? []);
      } catch (error) {
        console.error("Student materials load error:", error);
        setErrorMessage(t("studentMaterials.errors.load"));
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [t]);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return items;
    return items.filter(({ materials }) =>
      [materials?.title, materials?.description, materials?.category]
        .filter(Boolean)
        .some((value) => value.toLowerCase().includes(needle)),
    );
  }, [items, query]);

  if (loading) return <section className={styles.page}><div className={styles.state}>{t("studentMaterials.loading")}</div></section>;

  return (
    <section className={styles.page}>
      <header className={styles.header}><h1>{t("studentMaterials.title")}</h1><p>{t("studentMaterials.description")}</p></header>
      {errorMessage && <p className={styles.error}>{errorMessage}</p>}
      <input className={styles.search} type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={t("studentMaterials.search")} />
      {filtered.length === 0 ? <div className={styles.empty}>{t(items.length ? "studentMaterials.noResults" : "studentMaterials.empty")}</div> : (
        <div className={styles.list}>{filtered.map(({ id, materials }) => materials && (
          <article key={id} className={styles.card}>
            {materials.category && <span className={styles.category}>{materials.category}</span>}
            <h2>{materials.title}</h2>
            {materials.description && <p>{materials.description}</p>}
            <a href={materials.url} target="_blank" rel="noreferrer">{t("studentMaterials.open")}</a>
          </article>
        ))}</div>
      )}
    </section>
  );
};
export default StudentMaterials;
