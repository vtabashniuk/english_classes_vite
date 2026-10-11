import { useState } from "react";
import { useTranslation } from "react-i18next";
import styles from "./TagPicker.module.css";

const keyOf = (name) => name.trim().replace(/\s+/g, " ").toLocaleLowerCase();

// Tags are selected chips; new names are registered atomically when the material is saved.
const TagPicker = ({ value, onChange, catalog = [] }) => {
  const { t } = useTranslation();
  const [draft, setDraft] = useState("");
  const selected = new Set(value.map(keyOf));
  const choices = catalog.filter(({ name }) => !selected.has(keyOf(name)) &&
    name.toLocaleLowerCase().includes(draft.trim().toLocaleLowerCase())).slice(0, 12);
  const add = (name) => {
    const clean = name.trim().replace(/^#/, "").replace(/\s+/g, " ").trim();
    if (clean && clean.length <= 60 && value.length < 30 && !selected.has(keyOf(clean))) {
      onChange([...value, catalog.find((tag) => keyOf(tag.name) === keyOf(clean))?.name ?? clean]);
    }
    setDraft("");
  };
  return (
    <div className={styles.picker}>
      <div className={styles.chips}>{value.map((name) => (
        <button key={keyOf(name)} type="button" className={styles.chip}
          aria-label={t("materialsCatalog.removeTag", { name })}
          onClick={() => onChange(value.filter((item) => keyOf(item) !== keyOf(name)))}>
          #{name} ×
        </button>
      ))}</div>
      <input value={draft} maxLength={60} placeholder={t("materialsCatalog.tagInput")}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") { e.preventDefault(); if (draft.trim()) add(draft); }
        }} />
      {draft.trim() && !selected.has(keyOf(draft)) && (
        <button type="button" className={styles.suggestion} onClick={() => add(draft)}>
          + {t("materialsCatalog.addTag", { name: draft.trim() })}
        </button>
      )}
      {choices.map(({ id, name }) => (
        <button key={id} type="button" className={styles.suggestion} onClick={() => add(name)}>#{name}</button>
      ))}
      <small>{t("materialsCatalog.tagHelp")}</small>
    </div>
  );
};
export default TagPicker;
