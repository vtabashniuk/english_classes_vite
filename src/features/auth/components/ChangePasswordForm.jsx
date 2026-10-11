import { useTranslation } from "react-i18next";

import useToast from "../../../shared/toast/useToast";
import { useChangePassword } from "../hooks/useChangePassword";
import PasswordField from "./PasswordField";

import styles from "./ChangePasswordForm.module.css";

const KEY = "security.password";

/** One shared self-service form for both teacher and student. */
const ChangePasswordForm = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const form = useChangePassword({ onSuccess: () => toast.success(t(`${KEY}.saved`)) });

  return (
    <form className={styles.form} onSubmit={form.submit} autoComplete="on">
      <PasswordField
        name="current-password"
        label={t(`${KEY}.current`)}
        value={form.currentPassword}
        onChange={(value) => { form.setCurrentPassword(value); form.clearError(); }}
        autoComplete="current-password"
        disabled={form.isSaving}
      />
      <PasswordField
        name="new-password"
        label={t(`${KEY}.new`)}
        value={form.newPassword}
        onChange={(value) => { form.setNewPassword(value); form.clearError(); }}
        autoComplete="new-password"
        disabled={form.isSaving}
      />
      <PasswordField
        name="confirm-password"
        label={t(`${KEY}.confirm`)}
        value={form.confirmPassword}
        onChange={(value) => { form.setConfirmPassword(value); form.clearError(); }}
        autoComplete="new-password"
        disabled={form.isSaving}
      />
      {form.errorKey && (
        <p className={styles.error} role="alert">{t(`${KEY}.${form.errorKey}`)}</p>
      )}
      <button type="submit" className={styles.button} disabled={form.isSaving}>
        {form.isSaving ? t(`${KEY}.saving`) : t(`${KEY}.submit`)}
      </button>
    </form>
  );
};

export default ChangePasswordForm;
