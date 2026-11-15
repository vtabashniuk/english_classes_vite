import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import styles from "./Dialog.module.css";

/**
 * Shared accessible modal frame. No backdrop click dismissal: decisions must
 * be explicit. The caller supplies action buttons and optional initialFocusRef.
 */
export default function Dialog({
  open,
  title,
  description,
  children,
  onEscape,
  initialFocusRef,
  variant = "default",
  role = "alertdialog",
}) {
  const titleId = useId();
  const descriptionId = useId();
  const panelRef = useRef(null);
  const previousFocusRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    previousFocusRef.current = document.activeElement;
    const panel = panelRef.current;
    const initial = initialFocusRef?.current ?? panel?.querySelector("button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])");
    (initial ?? panel)?.focus();
    return () => {
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
    };
  }, [open, initialFocusRef]);

  if (!open) return null;

  const onKeyDown = (event) => {
    if (event.key === "Escape" && onEscape) {
      event.preventDefault();
      event.stopPropagation();
      onEscape();
      return;
    }
    if (event.key !== "Tab") return;
    const panel = panelRef.current;
    const focusables = Array.from(panel?.querySelectorAll("button:not(:disabled), [href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex]:not([tabindex='-1'])") ?? [])
      .filter((element) => element.getClientRects().length > 0);
    if (!focusables.length) {
      event.preventDefault();
      panel?.focus();
      return;
    }
    const first = focusables[0];
    const last = focusables[focusables.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === panel)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === panel)) {
      event.preventDefault();
      first.focus();
    }
  };

  return createPortal(
    <div className={styles.backdrop}>
      <section
        ref={panelRef}
        className={`${styles.panel} ${variant === "danger" ? styles.danger : ""}`}
        role={role}
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descriptionId : undefined}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId} className={styles.title}>{title}</h2>
        {description && <p id={descriptionId} className={styles.description}>{description}</p>}
        {children}
      </section>
    </div>,
    document.body,
  );
}
