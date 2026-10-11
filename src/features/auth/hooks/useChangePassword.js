import { useState } from "react";

import { getPasswordChangeErrorKey, validatePasswordChange } from "../lib/passwordValidation";
import { changeOwnPassword } from "../services/passwordService";

export const useChangePassword = ({ onSuccess }) => {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [errorKey, setErrorKey] = useState(null);

  const clearError = () => setErrorKey(null);

  const submit = async (event) => {
    event.preventDefault();
    if (isSaving) return;
    setErrorKey(null);

    const validationError = validatePasswordChange({
      currentPassword,
      newPassword,
      confirmPassword,
    });
    if (validationError) {
      setErrorKey(validationError);
      return;
    }

    setIsSaving(true);
    try {
      const { error } = await changeOwnPassword({ currentPassword, newPassword });
      if (error) throw error;

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      onSuccess?.();
    } catch (error) {
      // Intentionally never log credentials or raw server responses.
      setErrorKey(getPasswordChangeErrorKey(error));
    } finally {
      setIsSaving(false);
    }
  };

  return {
    currentPassword, setCurrentPassword,
    newPassword, setNewPassword,
    confirmPassword, setConfirmPassword,
    isSaving, errorKey, clearError, submit,
  };
};
