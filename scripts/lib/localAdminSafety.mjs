/**
 * Guardrails for the *local test-only* Supabase Auth admin reset helper.
 * No remote / cloud endpoint is accepted, even when a confirmation flag is set.
 */
export const LOCAL_SUPABASE_API_PORT = "54321";
export const RESET_CONFIRMATION_FLAG = "--confirm-local-reset";

export function assertLocalSupabaseUrl(rawUrl) {
  if (typeof rawUrl !== "string" || !rawUrl.trim()) {
    throw new Error("SUPABASE_URL is required and must point to the local Supabase API.");
  }

  let url;
  try {
    url = new URL(rawUrl.trim());
  } catch {
    throw new Error("Invalid SUPABASE_URL. Only the local Supabase API is allowed.");
  }

  const isLoopback = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  const isLocalEndpoint =
    url.protocol === "http:" &&
    isLoopback &&
    url.port === LOCAL_SUPABASE_API_PORT &&
    (url.pathname === "/" || url.pathname === "") &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash;

  if (!isLocalEndpoint) {
    throw new Error(
      "Refusing admin password reset: this helper supports only http://127.0.0.1:54321 (local Supabase). Cloud/Production URLs are never allowed.",
    );
  }

  return url.origin;
}

export function assertLocalAdminResetConfig(env, args) {
  // Block remote targets *before* reading a key or importing Supabase SDK.
  const supabaseUrl = assertLocalSupabaseUrl(env.SUPABASE_URL);

  if (args.length !== 1 || args[0] !== RESET_CONFIRMATION_FLAG) {
    throw new Error(`Explicit confirmation required: ${RESET_CONFIRMATION_FLAG}`);
  }

  const requiredNames = [
    "SUPABASE_SERVICE_ROLE_KEY",
    "TEST_USER_ID",
    "TEST_USER_EMAIL",
    "TEST_USER_PASSWORD",
  ];
  const missing = requiredNames.filter((name) => !env[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Missing required environment variables: ${missing.join(", ")}.`);
  }

  const userId = env.TEST_USER_ID.trim();
  if (!/^[\da-f]{8}-[\da-f]{4}-[1-8][\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i.test(userId)) {
    throw new Error("TEST_USER_ID must be a valid UUID.");
  }

  const expectedEmail = env.TEST_USER_EMAIL.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(expectedEmail)) {
    throw new Error("TEST_USER_EMAIL must contain the expected local test user's email.");
  }

  if (env.TEST_USER_PASSWORD.length < 8) {
    throw new Error("TEST_USER_PASSWORD must contain at least eight characters.");
  }

  return {
    supabaseUrl,
    serviceRoleKey: env.SUPABASE_SERVICE_ROLE_KEY,
    userId,
    expectedEmail,
    newPassword: env.TEST_USER_PASSWORD,
  };
}

export function assertUserMatchesExpectedEmail(actualEmail, expectedEmail) {
  if (typeof actualEmail !== "string" || actualEmail.trim().toLowerCase() !== expectedEmail) {
    throw new Error("Local test user email does not match TEST_USER_EMAIL. Password not changed.");
  }
}
