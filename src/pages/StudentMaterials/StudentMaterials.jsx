import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { searchStudentCatalog } from "../../features/materials/api/materialsApi";
import { getMaterialResourceLabel } from "../../features/materials/lib/materialValidation";
import PaginationControls from "../../shared/pagination/PaginationControls";
import usePagePreferences from "../../shared/pagination/usePagePreferences";
import styles from "./StudentMaterials.module.css";



const StudentMaterials = () => {
  const { t } = useTranslation();
  const { sizes } = usePagePreferences();
  const pageSize = sizes.studentMaterials;
  const [items, setItems] = useState([]);
  const [query, setQuery] = useState("");
  const [level, setLevel] = useState("");
  const [loading, setLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState("");
  const [page, setPage] = useState(0);
  const [hasMore, setHasMore] = useState(false);

  useEffect(() => {
    let alive = true;
    const request = setTimeout(async () => {
      try {
        if (alive) { setLoading(true); setErrorMessage(""); }
        const { data, error } = await searchStudentCatalog({
          query, level, limit: pageSize + 1, offset: page * pageSize,
        });
        if (error) throw error;
        if (!alive) return;
        setItems((data ?? []).slice(0, pageSize));
        setHasMore((data ?? []).length > pageSize);
      } catch (error) {
        console.error("Student material search error:", error);
        if (alive) setErrorMessage(t("studentMaterials.errors.load"));
      } finally { if (alive) setLoading(false); }
    }, 250);
    return () => { alive = false; clearTimeout(request); };
  }, [query, level, page, pageSize, t]);

  const filtered = items;

  return (
    <section className={styles.page}>
      <header className={styles.header}><h1>{t("studentMaterials.title")}</h1><p>{t("studentMaterials.description")}</p></header>
      {errorMessage && <p className={styles.error}>{errorMessage}</p>}
      <input className={styles.search} type="search" value={query} onChange={(e) => { setQuery(e.target.value); setPage(0); }} placeholder={t("studentMaterials.search")} />
      <div className={styles.filters}>
        <label className={styles.levelFilter}>{t("materialsFeature.level")}
          <select value={level} onChange={(event) => { setLevel(event.target.value); setPage(0); }}>
            {["", "A1", "A2", "B1", "B2", "C1", "C2"].map((value) => <option key={value} value={value}>{value || t("materialsFeature.allLevels")}</option>)}
          </select>
        </label>
      </div>
      {loading ? <div className={styles.state}>{t("studentMaterials.loading")}</div> : filtered.length === 0 ? (
        <div className={styles.empty}>{t(query || level ? "studentMaterials.noResults" : "studentMaterials.empty")}</div>
      ) : <div className={styles.list}>{filtered.map((material) => (
        <article key={material.id} className={styles.card}>
          <h2>{material.title}</h2>
          <p>{material.description}</p>
          <div className={styles.tags}>{(material.tags ?? []).map((tag) => <span className={styles.tag} key={tag}>#{tag}</span>)}</div>
          <div className={styles.resourceLinks}>
            {(material.resources?.length ? material.resources : [{ id: "legacy", external_url: material.url, title: material.title }])
              .filter((resource) => resource.external_url)
              .map((resource, index) => (
                <a key={resource.id} href={resource.external_url} target="_blank" rel="noopener noreferrer" aria-label={t("materialsFeature.openNamedResource", { title: getMaterialResourceLabel(resource, index, t) })}>
                  {getMaterialResourceLabel(resource, index, t)} ↗
                </a>
              ))}
          </div>
        </article>
      ))}</div>}
      <PaginationControls page={page} pageSize={pageSize} total={null} hasMore={hasMore}
        disabled={loading} onPageChange={setPage}
        previousLabel={t("commonPagination.previous")} nextLabel={t("commonPagination.next")}
        summary={t("studentMaterials.pageSummary", { page: page + 1 })} />
    </section>
  );
};
export default StudentMaterials;
