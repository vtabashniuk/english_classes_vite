// Shared with Node regression tests; this module has no Deno or network dependencies.
// Omission means the existing email invitation flow. Invalid supplied values
// fail closed, preventing an accidental email when Google was intended.
export const EMAIL_PASSWORD = "email_password";
export const GOOGLE_NO_EMAIL = "google_no_email";

export function resolveInvitationMethod(value) {
  if (value === undefined) return EMAIL_PASSWORD;
  if (value === EMAIL_PASSWORD || value === GOOGLE_NO_EMAIL) return value;
  throw new TypeError("UNSUPPORTED_INVITATION_METHOD");
}
