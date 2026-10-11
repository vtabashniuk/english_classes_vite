import { getAuthenticatedUser, updateCurrentUser } from "../api/authApi";
import { changePasswordWithServerPolicy } from "../lib/passwordChangeFlow";

/**
 * Shared self-service password change for teachers and students.
 * Requires "Require current password when updating" in Supabase Auth.
 * Do not authenticate the old password with a second temporary session.
 */
export const changeOwnPassword = ({ currentPassword, newPassword }) =>
  changePasswordWithServerPolicy(
    { currentPassword, newPassword },
    { getAuthenticatedUser, updatePassword: updateCurrentUser },
  );
