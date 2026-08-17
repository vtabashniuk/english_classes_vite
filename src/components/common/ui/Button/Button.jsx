import styles from "./Button.module.css";

const Button = ({
  children,
  variant = "secondary",
  size = "medium",
  type = "button",
  disabled = false,
  className = "",
  ...props
}) => {
  const variantClass = styles[variant] || styles.secondary;
  const sizeClass = styles[size] || styles.medium;

  return (
    <button
      type={type}
      disabled={disabled}
      className={`${styles.button} ${sizeClass} ${variantClass} ${className}`.trim()}
      {...props}
    >
      {children}
    </button>
  );
};

export default Button;
