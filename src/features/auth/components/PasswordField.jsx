import styles from "./ChangePasswordForm.module.css";

// Also reusable by invitation and reset pages in the next security substage.
const PasswordField = ({ label, value, onChange, autoComplete, disabled, name }) => (
  <label className={styles.field}>
    <span>{label}</span>
    <input
      name={name}
      type="password"
      value={value}
      onChange={(event) => onChange(event.target.value)}
      autoComplete={autoComplete}
      disabled={disabled}
      required
    />
  </label>
);

export default PasswordField;
