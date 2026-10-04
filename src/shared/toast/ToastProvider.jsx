import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import ToastContainer from "./ToastContainer";
import ToastContext from "./toastContext";

const DEFAULT_DURATION_MS = {
  success: 3000,
  info: 3000,
  warning: 5000,
  error: 5000,
};

const MAX_VISIBLE_TOASTS = 3;

const ToastProvider = ({ children }) => {
  const [toasts, setToasts] = useState([]);
  const toastsRef = useRef([]);
  const timersRef = useRef(new Map());
  const nextIdRef = useRef(0);

  const syncToasts = useCallback((nextToasts) => {
    toastsRef.current = nextToasts;
    setToasts(nextToasts);
  }, []);

  const dismiss = useCallback(
    (id) => {
      const timerId = timersRef.current.get(id);
      if (timerId) {
        window.clearTimeout(timerId);
        timersRef.current.delete(id);
      }

      syncToasts(toastsRef.current.filter((toast) => toast.id !== id));
    },
    [syncToasts],
  );

  const show = useCallback(
    ({ type = "info", message, duration } = {}) => {
      const normalizedMessage = String(message ?? "").trim();
      if (!normalizedMessage) return null;

      const normalizedType = DEFAULT_DURATION_MS[type] ? type : "info";

      const duplicate = toastsRef.current.find(
        (toast) =>
          toast.type === normalizedType && toast.message === normalizedMessage,
      );
      if (duplicate) return duplicate.id;

      nextIdRef.current += 1;
      const id = nextIdRef.current;
      const toast = {
        id,
        type: normalizedType,
        message: normalizedMessage,
      };

      const nextToasts = [...toastsRef.current, toast];
      while (nextToasts.length > MAX_VISIBLE_TOASTS) {
        const removed = nextToasts.shift();
        const removedTimer = timersRef.current.get(removed.id);
        if (removedTimer) {
          window.clearTimeout(removedTimer);
          timersRef.current.delete(removed.id);
        }
      }

      syncToasts(nextToasts);

      const timeoutMs =
        duration === 0
          ? 0
          : Number.isFinite(duration) && duration > 0
            ? duration
            : DEFAULT_DURATION_MS[normalizedType];

      if (timeoutMs > 0) {
        const timerId = window.setTimeout(() => dismiss(id), timeoutMs);
        timersRef.current.set(id, timerId);
      }

      return id;
    },
    [dismiss, syncToasts],
  );

  const api = useMemo(
    () => ({
      show,
      success: (message, options = {}) =>
        show({ ...options, type: "success", message }),
      error: (message, options = {}) =>
        show({ ...options, type: "error", message }),
      warning: (message, options = {}) =>
        show({ ...options, type: "warning", message }),
      info: (message, options = {}) =>
        show({ ...options, type: "info", message }),
      dismiss,
    }),
    [dismiss, show],
  );

  useEffect(() => {
    const timers = timersRef.current;

    return () => {
      timers.forEach((timerId) => window.clearTimeout(timerId));
      timers.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastContainer toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
};

export default ToastProvider;
