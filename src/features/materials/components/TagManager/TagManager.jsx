import { useState } from "react";
import { useTranslation } from "react-i18next";
import { createMaterialTag, renameMaterialTag, deleteMaterialTag } from "../../api/materialsApi";
import useToast from "../../../../shared/toast/useToast";
import styles from "./TagManager.module.css";

const TagManager = ({ tags, onChanged }) => {
  const { t } = useTranslation();
  const toast = useToast();
  const [draft, setDraft] = useState("");
  const [editing, setEditing] = useState(null);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async (fn, successKey) => {
    setBusy(true);
    try {
      const { error } = await fn();
      if (error) throw error;
      await onChanged();
      setDraft(""); setEditing(null); toast.success(t(successKey));
    } catch (error) { console.error("Tag operation:", error); toast.error(t("materialsCatalog.operationFailed")); }
    finally { setBusy(false); }
  };
  return (
    <div className={styles.manager}>
      <div className={styles.create}>
        <input value={draft} maxLength={60} placeholder={t("materialsCatalog.newTag")}
          onChange={(e) => setDraft(e.target.value)} />
        <button type="button" disabled={busy || !draft.trim()} onClick={() => submit(() => createMaterialTag(draft), "materialsCatalog.tagSaved")}>
          {t("materialsCatalog.add")}
        </button>
      </div>
      <p className={styles.tip}>{t("materialsCatalog.mergeHint")}</p>
      <div className={styles.list}>{tags.map((tag) => (
        <div key={tag.id} className={styles.row}>
          {editing === tag.id ? <>
            <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
            <button type="button" disabled={busy || !name.trim()} onClick={() => submit(() => renameMaterialTag(tag.id, name), "materialsCatalog.tagSaved")}>{t("materialsCatalog.save")}</button>
            <button type="button" onClick={() => setEditing(null)}>{t("materialsCatalog.cancel")}</button>
          </> : <>
            <span className={styles.tagName}>#{tag.name}</span>
            <span className={styles.count}>{tag.material_tag_links?.length ?? 0}</span>
            <button type="button" disabled={busy} onClick={() => { setEditing(tag.id); setName(tag.name); }}>{t("materialsCatalog.rename")}</button>
            <button type="button" disabled={busy} onClick={() => {
              if (window.confirm(t("materialsCatalog.deleteTagConfirm", { name: tag.name })))
                submit(() => deleteMaterialTag(tag.id), "materialsCatalog.tagDeleted");
            }}>{t("materialsCatalog.delete")}</button>
          </>}
        </div>
      ))}</div>
    </div>
  );
};
export default TagManager;
