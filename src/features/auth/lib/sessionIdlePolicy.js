/**
 * Client-side inactivity policy. This is a usability/privacy safeguard;
 * it does not replace server-enforced Supabase session expiry or JWT revocation.
 */
export const IDLE_LIMIT_MS = Object.freeze({
  teacher: 90 * 60 * 1000,
  student: 60 * 60 * 1000,
});

export const IDLE_WARNING_MS = 2 * 60 * 1000;
export const IDLE_ACTIVITY_KEY_PREFIX = "crm:auth-idle:v1:";

export const getIdleActivityStorageKey = (userId) =>
  `${IDLE_ACTIVITY_KEY_PREFIX}${userId}`;

export const getIdleSnapshot = ({ role, lastActiveAt, now }) => {
  const timeout = IDLE_LIMIT_MS[role];
  if (!timeout || !Number.isFinite(lastActiveAt) || !Number.isFinite(now)) {
    return { status: "disabled", remainingMs: 0 };
  }

  // Keep remaining time bounded even if the device clock temporarily changes.
  const elapsed = Math.max(0, now - lastActiveAt);
  const remainingMs = Math.max(0, timeout - elapsed);
  return {
    status: remainingMs === 0
      ? "expired"
      : remainingMs <= IDLE_WARNING_MS
        ? "warning"
        : "active",
    remainingMs,
  };
};

/** A fresh Supabase login gets a fresh idle clock; token refresh does not. */
export const parseStoredIdleActivity = (raw, sessionMarker, now) => {
  if (!raw || !sessionMarker) return null;
  try {
    const parsed = JSON.parse(raw);
    if (
      parsed.sessionMarker !== sessionMarker ||
      !Number.isFinite(parsed.lastActiveAt) ||
      parsed.lastActiveAt < 0 ||
      parsed.lastActiveAt > now
    ) return null;
    return parsed.lastActiveAt;
  } catch {
    return null;
  }
};

export const serializeIdleActivity = (sessionMarker, lastActiveAt) =>
  JSON.stringify({ sessionMarker, lastActiveAt });

export const formatIdleCountdown = (milliseconds) => {
  const seconds = Math.ceil(Math.max(0, milliseconds) / 1000);
  return `${String(Math.floor(seconds / 60)).padStart(2, "0")}:${String(seconds % 60).padStart(2, "0")}`;
};
