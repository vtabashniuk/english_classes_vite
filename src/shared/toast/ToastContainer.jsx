import { useTranslation } from "react-i18next";

import styles from "./ToastContainer.module.css";

const TYPE_META = {
  success: { icon: "✓" },
  error: { icon: "!" },
  warning: { icon: "!" },
  info: { icon: "i" },
};

const ToastContainer = ({ toasts, onDismiss }) => {
  const { t } = useTranslation();

  if (toasts.length === 0) return null;

  return (
    <div className={styles.container} aria-live="polite" aria-relevant="additions removals">
      {toasts.map((toast) => {
        const meta = TYPE_META[toast.type] ?? TYPE_META.info;

        return (
          <div
            key={toast.id}
            className={`${styles.toast} ${styles[toast.type] ?? styles.info}`}
            role={toast.type === "error" ? "alert" : "status"}
            aria-atomic="true"
          >
            <span className={styles.icon} aria-hidden="true">
              {meta.icon}
            </span>
            <span className={styles.message}>{toast.message}</span>
            <button
              type="button"
              className={styles.closeButton}
              onClick={() => onDismiss(toast.id)}
              aria-label={t("common.close")}
              title={t("common.close")}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default ToastContainer;
