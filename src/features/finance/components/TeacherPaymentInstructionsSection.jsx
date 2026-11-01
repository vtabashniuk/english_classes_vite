import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../../../context/useAuth";
import {
  getMyTeacherPaymentInstructions,
  saveTeacherPaymentInstructions,
} from "../api/paymentInstructionsApi";
import styles from "./TeacherPaymentInstructionsSection.module.css";

const CURRENCIES = ["UAH", "USD", "EUR"];
const blank = (currency) => ({
  currency, recipientName: "", iban: "", bankName: "", paymentPurpose: "",
  notes: "", paymentUrl: "", qrImageUrl: "", isPublished: false,
});
const fromRow = (item) => ({
  currency: item.currency, recipientName: item.recipient_name ?? "",
  iban: item.iban ?? "", bankName: item.bank_name ?? "",
  paymentPurpose: item.payment_purpose ?? "", notes: item.notes ?? "",
  paymentUrl: item.payment_url ?? "", qrImageUrl: item.qr_image_url ?? "",
  isPublished: Boolean(item.is_published),
});
const validHttps = (value) => !value || /^https:\/\/[^\s/]+(?:\/[^\s]*)?$/i.test(value);

const TeacherPaymentInstructionsSection = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [currency, setCurrency] = useState("UAH");
  const [items, setItems] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    getMyTeacherPaymentInstructions(user.id).then(({ data, error: loadError }) => {
      if (!active) return;
      if (loadError) setError(t("paymentInstructions.loadError"));
      else setItems(Object.fromEntries((data ?? []).map((row) => [row.currency, fromRow(row)])));
    }).catch((cause) => {
      console.error("Payment instructions load error:", cause);
      if (active) setError(t("paymentInstructions.loadError"));
    }).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [user?.id, t]);

  const item = items[currency] ?? blank(currency);
  const edit = (key, value) => {
    setNotice("");
    setItems((current) => ({ ...current, [currency]: { ...(current[currency] ?? blank(currency)), [key]: value } }));
  };
  const save = async (event) => {
    event.preventDefault();
    setError(""); setNotice("");
    if (!validHttps(item.paymentUrl.trim()) || !validHttps(item.qrImageUrl.trim())) {
      setError(t("paymentInstructions.invalidUrl")); return;
    }
    try {
      setSaving(true);
      const { error: saveError } = await saveTeacherPaymentInstructions(user.id, item);
      if (saveError) throw saveError;
      setNotice(t("paymentInstructions.saved"));
    } catch (cause) {
      console.error("Payment instructions save error:", cause);
      setError(t("paymentInstructions.saveError"));
    } finally { setSaving(false); }
  };

  const fields = [
    ["recipientName", "recipient"], ["iban", "iban"],
    ["bankName", "bank"], ["paymentPurpose", "purpose"],
    ["paymentUrl", "paymentUrl"], ["qrImageUrl", "qrImageUrl"],
  ];

  return (
    <section id="payment-instructions" className={styles.card}>
      <h2>{t("paymentInstructions.title")}</h2>
      <p className={styles.hint}>{t("paymentInstructions.description")}</p>
      {loading ? <p>{t("common.loading")}</p> : (
        <form onSubmit={save} className={styles.form}>
          <label>{t("paymentInstructions.currency")}
            <select value={currency} disabled={saving} onChange={(event) => { setCurrency(event.target.value); setError(""); setNotice(""); }}>
              {CURRENCIES.map((code) => <option key={code} value={code}>{code}</option>)}
            </select>
          </label>
          {fields.map(([key, label]) => (
            <label key={key}>{t(`paymentInstructions.${label}`)}
              <input type={key.endsWith("Url") ? "url" : "text"} maxLength={key === "paymentPurpose" ? 250 : key.endsWith("Url") ? 1000 : 200}
                value={item[key]} disabled={saving} onChange={(event) => edit(key, event.target.value)} />
            </label>
          ))}
          <label>{t("paymentInstructions.notes")}
            <textarea rows={3} maxLength={1000} value={item.notes} disabled={saving} onChange={(event) => edit("notes", event.target.value)} />
          </label>
          <label className={styles.checkbox}>
            <input type="checkbox" checked={item.isPublished} disabled={saving} onChange={(event) => edit("isPublished", event.target.checked)} />
            {t("paymentInstructions.publish")}
          </label>
          <p className={styles.hint}>{t("paymentInstructions.qrHelp")}</p>
          {error && <p role="alert" className={styles.error}>{error}</p>}
          {notice && <p role="status" className={styles.notice}>{notice}</p>}
          <button type="submit" disabled={saving}>{saving ? t("paymentInstructions.saving") : t("paymentInstructions.save")}</button>
        </form>
      )}
    </section>
  );
};

export default TeacherPaymentInstructionsSection;
