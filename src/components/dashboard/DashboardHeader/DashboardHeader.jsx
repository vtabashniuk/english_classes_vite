import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router-dom";

import { useAuth } from "../../../context/AuthContext";
import LanguageSwitcher from "../../common/LanguageSwitcher/LanguageSwitcher";

import styles from "./DashboardHeader.module.css";

const DashboardHeader = ({ onMenuOpen }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { profile, signOut } = useAuth();

  const handleSignOut = async () => {
    try {
      await signOut();
      navigate("/login", { replace: true });
    } catch (error) {
      console.error("Sign out error:", error);
    }
  };

  const roleLabel =
    profile?.role === "teacher"
      ? t("common.teacher")
      : t("common.student");

  return (
    <header className={styles.header}>
      <div className={styles.leftSide}>
        <button
          type="button"
          className={styles.menuButton}
          onClick={onMenuOpen}
          aria-label={t("dashboardNav.openMenu")}
          aria-haspopup="dialog"
        >
          <span />
          <span />
          <span />
        </button>

        <div>
          <p className={styles.name}>
            {profile?.full_name || profile?.email}
          </p>

          <span className={styles.role}>{roleLabel}</span>
        </div>
      </div>

      <div className={styles.actions}>
        <LanguageSwitcher />

        <button
          type="button"
          className={styles.logout}
          onClick={handleSignOut}
        >
          {t("common.signOut")}
        </button>
      </div>
    </header>
  );
};

export default DashboardHeader;
