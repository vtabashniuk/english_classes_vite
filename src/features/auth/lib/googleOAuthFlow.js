import { GOOGLE_OAUTH_STATE_KEY, isRecentGoogleOAuthStart } from "./googleOAuthPolicy";

export const rememberGoogleOAuthStart = () => {
  window.sessionStorage.setItem(GOOGLE_OAUTH_STATE_KEY, String(Date.now()));
};

export const hasRecentGoogleOAuthStart = () => {
  try {
    const raw = window.sessionStorage.getItem(GOOGLE_OAUTH_STATE_KEY);
    return isRecentGoogleOAuthStart(Number(raw));
  } catch {
    return false;
  }
};

export const clearGoogleOAuthStart = () => {
  try { window.sessionStorage.removeItem(GOOGLE_OAUTH_STATE_KEY); } catch { /* ignore */ }
};
