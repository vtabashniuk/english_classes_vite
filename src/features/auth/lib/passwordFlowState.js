import {
  hasValidPasswordFlowGrant,
  isVerifiedImplicitInvitation,
} from "./passwordFlowAccess.js";

const STORAGE_KEY = "crm:password-flow:v1";
const listeners = new Set();

// Evaluated during initial module loading, before Supabase processes a link.
const initialLocation = typeof window !== "undefined"
  ? { hash: window.location.hash, pathname: window.location.pathname }
  : { hash: "", pathname: "" };

const notify = () => listeners.forEach((listener) => listener());
const safeStorage = () => {
  try { return window.sessionStorage; } catch { return null; }
};

const readGrant = () => {
  try {
    const value = safeStorage()?.getItem(STORAGE_KEY);
    return value ? JSON.parse(value) : null;
  } catch { return null; }
};

export const clearPasswordFlow = () => {
  safeStorage()?.removeItem(STORAGE_KEY);
  notify();
};

export const grantPasswordFlow = (kind, userId) => {
  if (!["invite", "recovery"].includes(kind) || !userId) return;
  safeStorage()?.setItem(STORAGE_KEY, JSON.stringify({
    kind, userId, issuedAt: Date.now(),
  }));
  notify();
};

export const canUsePasswordFlow = (kind, userId) =>
  hasValidPasswordFlowGrant(readGrant(), { kind, userId, now: Date.now() });

export const subscribePasswordFlow = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/**
 * Listen to Supabase events (not merely the presence of a saved session).
 * The invitation is verified by SDK's successful implicit callback handling.
 */
export const recordPasswordAuthEvent = (event, session) => {
  if (event === "SIGNED_OUT") {
    clearPasswordFlow();
  } else if (event === "PASSWORD_RECOVERY" && session?.user?.id) {
    grantPasswordFlow("recovery", session.user.id);
  } else if (
    event === "SIGNED_IN" &&
    isVerifiedImplicitInvitation(initialLocation.hash, session, initialLocation.pathname)
  ) {
    grantPasswordFlow("invite", session.user.id);
  }
};
