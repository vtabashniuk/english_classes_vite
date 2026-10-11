import { useState } from "react";
import { useTranslation } from "react-i18next";
import useToast from "../toast/useToast";
import usePagePreferences from "./usePagePreferences";
import { PAGE_SIZE_OPTIONS, STUDENT_PAGE_KEYS, TEACHER_PAGE_KEYS } from "./pagePreferences";
import styles from "./PagePreferencesSettings.module.css";

export default function PagePreferencesSettings({ role, financeHistorySize, onFinanceSave }) {
  const { t } = useTranslation();
  const toast = useToast();
  const { sizes, ready, save } = usePagePreferences();
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [financeDraft, setFinanceDraft] = useState(null);
  const keys = role === "teacher" ? TEACHER_PAGE_KEYS : STUDENT_PAGE_KEYS;
  const current = draft ?? sizes;


  const submit = async (event) => {
    event.preventDefault();
    try {
      setBusy(true);
      if (draft) await save(Object.fromEntries(keys.map((key) => [key, current[key]])));
      if (role === "teacher" && financeDraft !== null) await onFinanceSave(financeDraft);
      setDraft(null);
      setFinanceDraft(null);
      toast.success(t("pagePreferences.saved"));
    } catch (error) {
      console.error("Save pagination preferences:", error);
      toast.error(t("pagePreferences.error"));
    } finally { setBusy(false); }
  };
  return (
    <form id="pagination-preferences" className={styles.card} onSubmit={submit}>
      <h2>{t("pagePreferences.title")}</h2>
      <p className={styles.help}>{t("pagePreferences.description")}</p>
      <div className={styles.fields}>
        {keys.map((key) => (
          <label className={styles.field} key={key}>
            <span>{t(`pagePreferences.labels.${key}`)}</span>
            <select value={current[key]} disabled={!ready || busy}
              onChange={(event) => setDraft({ ...current, [key]: Number(event.target.value) })}>
              {PAGE_SIZE_OPTIONS.map((size) => <option key={size} value={size}>{size}</option>)}
            </select>
          </label>
        ))}
        {role === "teacher" && <label className={styles.field}>
          <span>{t("pagePreferences.financeHistory")}</span>
          <select value={financeDraft ?? financeHistorySize ?? 20} disabled={!ready || busy}
            onChange={(event) => setFinanceDraft(Number(event.target.value))}>
            {[10,20,50,100].map((size) => <option value={size} key={size}>{size}</option>)}
          </select>
        </label>}
      </div>
      <button className={styles.save} type="submit" disabled={!ready || busy || (!draft && financeDraft === null)}>
        {busy ? t("pagePreferences.saving") : t("pagePreferences.save")}
      </button>
    </form>
  );
}
