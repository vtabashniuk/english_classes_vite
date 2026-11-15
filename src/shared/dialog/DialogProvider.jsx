import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ConfirmDialog from "./ConfirmDialog";
import { DialogContext } from "./dialogContext";

/**
 * Application-level confirmation service. Calls are queued; every promise
 * resolves false when the provider unmounts rather than remaining pending.
 * Callers must pass translated, user-visible strings.
 */
export default function DialogProvider({ children }) {
  const [active, setActive] = useState(null);
  const queueRef = useRef([]);
  const activeRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (activeRef.current) activeRef.current.resolve(false);
      queueRef.current.forEach((request) => request.resolve(false));
      queueRef.current = [];
      activeRef.current = null;
    };
  }, []);

  const confirm = useCallback((options) => new Promise((resolve) => {
    if (!mountedRef.current) { resolve(false); return; }
    if (!options?.title || !options?.confirmLabel || !options?.cancelLabel) {
      resolve(false);
      return;
    }
    const request = { ...options, resolve };
    if (!activeRef.current) {
      activeRef.current = request;
      setActive(request);
    } else {
      queueRef.current.push(request);
    }
  }), []);

  const settle = useCallback((result) => {
    const request = activeRef.current;
    if (!request) return;
    request.resolve(result);
    const next = queueRef.current.shift() ?? null;
    activeRef.current = next;
    setActive(next);
  }, []);

  const value = useMemo(() => ({ confirm }), [confirm]);
  return (
    <DialogContext.Provider value={value}>
      {children}
      <ConfirmDialog
        open={Boolean(active)}
        title={active?.title}
        description={active?.description}
        confirmLabel={active?.confirmLabel}
        cancelLabel={active?.cancelLabel}
        variant={active?.variant}
        onConfirm={() => settle(true)}
        onCancel={() => settle(false)}
      />
    </DialogContext.Provider>
  );
}
