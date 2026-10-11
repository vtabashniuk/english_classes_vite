// Validation keys are translated by the shared ChangePasswordForm.
export const validatePasswordChange = ({ currentPassword, newPassword, confirmPassword }) => {
  if (!currentPassword) return "currentRequired";
  if (newPassword.length < 8) return "tooShort";
  if (newPassword !== confirmPassword) return "mismatch";
  if (currentPassword === newPassword) return "samePassword";
  return null;
};

export const getPasswordChangeErrorKey = (error) => {
  const code = String(error?.code ?? "").toLowerCase();
  if (["current_password_mismatch", "current_password_required"].includes(code)) {
    return "currentIncorrect";
  }
  if (code === "same_password") return "samePassword";
  if (code === "weak_password") return "tooWeak";
  if (code === "reauthentication_needed") return "reauthRequired";

  // Compatibility with older GoTrue errors that lacked stable error codes.
  const message = String(error?.message ?? "").toLowerCase();
  if (message.includes("current password") || message.includes("password is incorrect")) {
    return "currentIncorrect";
  }
  return "saveError";
};
