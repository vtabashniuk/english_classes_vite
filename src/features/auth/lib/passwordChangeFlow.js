/**
 * Changes the signed-in user's password through the existing Supabase session.
 * The Supabase Auth server MUST enforce "Require current password when updating".
 * Browser-side checks are for UX only and cannot substitute for server policy.
 * Dependencies are injected for isolated tests (without live credentials).
 */
export const changePasswordWithServerPolicy = async (
  { currentPassword, newPassword },
  { getAuthenticatedUser, updatePassword },
) => {
  if (typeof currentPassword !== "string" || !currentPassword) {
    return { error: { code: "current_password_required" } };
  }
  if (typeof newPassword !== "string" || newPassword.length < 8) {
    return { error: { code: "weak_password" } };
  }
  if (currentPassword === newPassword) {
    return { error: { code: "same_password" } };
  }

  const { data: before, error: initialError } = await getAuthenticatedUser();
  if (initialError) return { error: initialError };

  const userId = before?.user?.id;
  if (!userId) return { error: { code: "auth_required" } };

  // Detect an account switch in another tab before making the update request.
  const { data: after, error: confirmationError } = await getAuthenticatedUser();
  if (confirmationError) return { error: confirmationError };
  if (after?.user?.id !== userId) {
    return { error: { code: "auth_identity_mismatch" } };
  }

  // The server verifies current_password and rejects an incorrect value.
  // The official supabase-js field is snake_case (v2.102.0+).
  return updatePassword({ current_password: currentPassword, password: newPassword });
};
