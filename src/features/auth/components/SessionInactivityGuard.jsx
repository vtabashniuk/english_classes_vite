import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import {
  formatIdleCountdown,
  getIdleActivityStorageKey,
  getIdleSnapshot,
  parseStoredIdleActivity,
  serializeIdleActivity,
} from "../lib/sessionIdlePolicy";
import styles from "./SessionInactivityGuard.module.css";

const READ_INTERVAL_MS = 1000;
const ACTIVITY_WRITE_INTERVAL_MS = 1000;

const getStorage = () => {
  try { return window.localStorage; } catch { return null; }
};

const getStoredActivity = (storage, key, marker, now) => {
  try {
    return parseStoredIdleActivity(storage?.getItem(key), marker, now);
  } catch {
    return null;
  }
};

const storeActivity = (storage, key, marker, at) => {
  try {
    storage?.setItem(key, serializeIdleActivity(marker, at));
  } catch {
    // Some browsers disable localStorage. The current tab still uses its own clock.
  }
};

const initialClock = (key, marker, role) => {
  const now = Date.now();
  const lastActiveAt = getStoredActivity(getStorage(), key, marker, now) ?? now;
  return { lastActiveAt, view: getIdleSnapshot({ role, lastActiveAt, now }) };
};

/**
 * Rendered only for an authenticated user with a known role. Other tabs share
 * the latest *human* activity, not automatic network requests or token refresh.
 */
const SessionInactivityGuard = ({ userId, sessionMarker, role, signOut }) => {
  const { t } = useTranslation();
  const key = getIdleActivityStorageKey(userId);
  const [initial] = useState(() => initialClock(key, sessionMarker, role));
  const lastActivityRef = useRef(initial.lastActiveAt);
  const lastWriteRef = useRef(0);
  const signingOutRef = useRef(false);
  const logoutFailedRef = useRef(false);
  const dialogButtonRef = useRef(null);
  const expiredRef = useRef(initial.view.status === "expired");
  const [view, setView] = useState(initial.view);
  const [logoutError, setLogoutError] = useState(false);

  const readLatest = useCallback((now) => {
    const stored = getStoredActivity(getStorage(), key, sessionMarker, now);
    if (stored !== null && stored > lastActivityRef.current) {
      lastActivityRef.current = stored;
    }
    return lastActivityRef.current;
  }, [key, sessionMarker]);

  const performLogout = useCallback(async (retry = false) => {
    if (signingOutRef.current || (logoutFailedRef.current && !retry)) return;
    signingOutRef.current = true;
    logoutFailedRef.current = false;
    setLogoutError(false);
    try {
      // Only the current browser session, not sessions on other devices.
      await signOut({ scope: "local" });
    } catch (error) {
      console.error("Automatic logout failed:", error);
      // Keep an un-dismissable lock over the CRM until logout succeeds.
      setLogoutError(true);
      logoutFailedRef.current = true;
      signingOutRef.current = false;
    }
  }, [signOut]);

  const checkDeadline = useCallback(() => {
    const now = Date.now();
    const lastActiveAt = readLatest(now);
    const next = getIdleSnapshot({ role, lastActiveAt, now });

    if (expiredRef.current || next.status === "expired") {
      expiredRef.current = true;
      setView((current) => current.status === "expired" ? current : next);
      void performLogout();
      return;
    }

    setView((current) => {
      if (next.status === "active" && current.status === "active") return current;
      if (
        next.status === current.status &&
        Math.ceil(next.remainingMs / 1000) === Math.ceil(current.remainingMs / 1000)
      ) return current;
      return next;
    });
  }, [performLogout, readLatest, role]);

  const recordHumanActivity = useCallback((event) => {
    if (event.isTrusted === false || document.hidden || expiredRef.current) return;
    const now = Date.now();
    const lastActiveAt = readLatest(now);
    const current = getIdleSnapshot({ role, lastActiveAt, now });
    // Once a warning is displayed, require an explicit confirmation button.
    if (current.status !== "active") {
      checkDeadline();
      return;
    }

    lastActivityRef.current = now;
    if (now - lastWriteRef.current >= ACTIVITY_WRITE_INTERVAL_MS) {
      storeActivity(getStorage(), key, sessionMarker, now);
      lastWriteRef.current = now;
    }
  }, [checkDeadline, key, readLatest, role, sessionMarker]);

  const continueSession = () => {
    if (expiredRef.current) return;
    const now = Date.now();
    const lastActiveAt = readLatest(now);
    if (getIdleSnapshot({ role, lastActiveAt, now }).status === "expired") {
      checkDeadline();
      return;
    }
    lastActivityRef.current = now;
    lastWriteRef.current = now;
    storeActivity(getStorage(), key, sessionMarker, now);
    setView(getIdleSnapshot({ role, lastActiveAt: now, now }));
  };

  useEffect(() => {
    // Initialize a clock for a new login, but never overwrite another tab's
    // existing activity record for the same login.
    const storage = getStorage();
    const now = Date.now();
    const stored = getStoredActivity(storage, key, sessionMarker, now);
    if (stored === null) {
      storeActivity(storage, key, sessionMarker, lastActivityRef.current);
    } else if (stored > lastActivityRef.current) {
      lastActivityRef.current = stored;
    }

    const events = ["pointerdown", "keydown", "touchstart", "wheel"];
    events.forEach((event) => document.addEventListener(event, recordHumanActivity, { passive: true, capture: true }));

    const onVisibilityChange = () => { if (!document.hidden) checkDeadline(); };
    const onStorage = (event) => { if (event.key === key) checkDeadline(); };
    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("storage", onStorage);
    window.addEventListener("focus", checkDeadline);
    window.addEventListener("pageshow", checkDeadline);
    const interval = window.setInterval(checkDeadline, READ_INTERVAL_MS);
    // Check pre-existing sessions immediately, even before the first interval.
    const initialCheck = window.setTimeout(checkDeadline, 0);

    return () => {
      events.forEach((event) => document.removeEventListener(event, recordHumanActivity, true));
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("focus", checkDeadline);
      window.removeEventListener("pageshow", checkDeadline);
      window.clearInterval(interval);
      window.clearTimeout(initialCheck);
    };
  }, [checkDeadline, key, recordHumanActivity, sessionMarker]);

  if (view.status !== "warning" && view.status !== "expired") return null;

  return (
    <div className={styles.backdrop}>
      <section
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="session-idle-title"
        aria-describedby="session-idle-description"
        className={styles.dialog}
        onKeyDown={(event) => {
          if (event.key === "Tab") {
            event.preventDefault();
            dialogButtonRef.current?.focus();
          }
        }}
      >
        <h2 id="session-idle-title">
          {t(view.status === "expired" ? "auth.sessionIdle.expiredTitle" : "auth.sessionIdle.warningTitle")}
        </h2>
        <p id="session-idle-description">
          {t(view.status === "expired" ? "auth.sessionIdle.expiredDescription" : "auth.sessionIdle.warningDescription")}
        </p>
        {view.status === "warning" ? (
          <>
            <p className={styles.countdown} aria-label={t("auth.sessionIdle.timeRemaining")}>
              {formatIdleCountdown(view.remainingMs)}
            </p>
            <button ref={dialogButtonRef} type="button" className={styles.button} onClick={continueSession} autoFocus>
              {t("auth.sessionIdle.continue")}
            </button>
          </>
        ) : (
          <>
            {logoutError && (
              <p className={styles.error} role="status">{t("auth.sessionIdle.logoutError")}</p>
            )}
            <button
              ref={dialogButtonRef}
              type="button"
              className={styles.button}
              onClick={() => void performLogout(true)}
              disabled={!logoutError}
              autoFocus
            >
              {t(logoutError ? "auth.sessionIdle.retryLogout" : "auth.sessionIdle.loggingOut")}
            </button>
          </>
        )}
      </section>
    </div>
  );
};

export default SessionInactivityGuard;
