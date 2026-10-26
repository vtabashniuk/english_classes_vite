// Gate 4.4-A: pure routing/identity helpers; server checks remain authoritative.
export const hasGoogleIdentity = (user) =>
  Boolean(user?.identities?.some((identity) => identity.provider === "google"));

export const getGooglePostLoginRoute = ({ profile, hasTeacherLink }) => {
  if (!profile?.is_active) return null;
  if (profile.role === "teacher") return "/teacher-dashboard";
  if (profile.role !== "student") return null;
  if (!hasTeacherLink) return "/google/accept-invitation";
  // Pending invitations cannot override an established student-teacher link.
  return "/student-area";
};

export const GOOGLE_OAUTH_STATE_KEY = "crm:google-oauth-start:v1";
export const GOOGLE_OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

export const isRecentGoogleOAuthStart = (value, now = Date.now()) =>
  Number.isFinite(value) && value > 0 && value <= now &&
  now - value <= GOOGLE_OAUTH_STATE_TTL_MS;

// Route guards must not rely on profile role alone for unlinked Google users.
export const needsGoogleInvitationConsent = ({ user, profile, hasTeacherLink }) =>
  Boolean(user?.id && profile?.id === user.id && profile.role === "student" &&
    profile.is_active && hasGoogleIdentity(user) && !hasTeacherLink);
