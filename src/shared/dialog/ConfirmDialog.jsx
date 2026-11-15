import { useRef } from "react";
import Dialog from "./Dialog";
import styles from "./Dialog.module.css";

/** Synchronous confirmation UI. The action itself remains owned by its caller. */
export default function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  variant = "default",
  busy = false,
}) {
  const cancelRef = useRef(null);
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      variant={variant}
      initialFocusRef={cancelRef}
      onEscape={busy ? undefined : onCancel}
    >
      <div className={styles.actions}>
        <button ref={cancelRef} type="button" className={`${styles.button} ${styles.cancel}`} onClick={onCancel} disabled={busy}>{cancelLabel}</button>
        <button type="button" className={`${styles.button} ${variant === "danger" ? styles.dangerButton : styles.confirm}`} onClick={onConfirm} disabled={busy}>{confirmLabel}</button>
      </div>
    </Dialog>
  );
}
