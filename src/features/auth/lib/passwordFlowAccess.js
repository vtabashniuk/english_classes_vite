/**
 * UI authorization for email-link password flows. This is NOT an Auth server
 * authorization mechanism: Supabase must still validate tokens/password rules.
 */
export const PASSWORD_FLOW_TTL_MS = 15 * 60 * 1000;

export const hasValidPasswordFlowGrant = (grant, { kind, userId, now }) =>
  Boolean(
    grant &&
      (kind === "recovery" || kind === "invite") &&
      grant.kind === kind &&
      typeof userId === "string" &&
      userId.length > 0 &&
      grant.userId === userId &&
      Number.isFinite(grant.issuedAt) &&
      grant.issuedAt <= now &&
      now - grant.issuedAt < PASSWORD_FLOW_TTL_MS,
  );

export const validateNewPassword = (password, confirmation) => {
  if (typeof password !== "string" || password.length < 8) return "tooShort";
  if (password !== confirmation) return "mismatch";
  return null;
};

/**
 * Invitation implicit-flow events are accepted only for a URL containing
 * an actual access-token callback whose token matches the session delivered
 * by the Supabase SDK. URL query flags alone must never grant permission.
 */
export const isVerifiedImplicitInvitation = (hash, session, pathname) => {
  if (pathname !== "/set-password" && pathname !== "/auth/callback") return false;
  const params = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
  return (
    params.get("type") === "invite" &&
    Boolean(params.get("access_token")) &&
    Boolean(params.get("refresh_token")) &&
    params.get("access_token") === session?.access_token &&
    Boolean(session?.user?.id)
  );
};
