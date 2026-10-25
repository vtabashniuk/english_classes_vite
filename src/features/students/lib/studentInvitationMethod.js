// Browser-side contract of invite-student Edge Function. Validation is kept
// strict: a mistyped Google mode must never silently send an email instead.
export const EMAIL_PASSWORD = "email_password";
export const GOOGLE_NO_EMAIL = "google_no_email";

export function buildStudentInvitationBody({ email, fullName, invitationMethod = EMAIL_PASSWORD }) {
  if (invitationMethod !== EMAIL_PASSWORD && invitationMethod !== GOOGLE_NO_EMAIL) {
    throw new TypeError("UNSUPPORTED_INVITATION_METHOD");
  }
  return {
    email,
    fullName,
    ...(invitationMethod === GOOGLE_NO_EMAIL ? { invitationMethod } : {}),
  };
}

export function isPendingGoogleInviteResult(data) {
  return data?.success === true &&
    typeof data.invitationId === "string" && data.invitationId.length > 0 &&
    data?.invitationMethod === GOOGLE_NO_EMAIL &&
    data?.pendingActivation === true &&
    data?.emailSent === false;
}
