
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../../context/useAuth";
import { useDashboardIndicators } from "../../../features/dashboard/hooks/useDashboardIndicators";
import LanguageSwitcher from "../../common/LanguageSwitcher/LanguageSwitcher";

import styles from "./DashboardHeader.module.css";

const DashboardHeader = ({ onMenuOpen }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, signOut } = useAuth();

  const { isTeacher, hasUnreadNotifications, hasPendingRequests } =
    useDashboardIndicators({
      profile,
      pathname: location.pathname,
    });

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

  const hasMobileIndicators =
    hasUnreadNotifications || (isTeacher && hasPendingRequests);

  return (
    <header className={styles.header}>
      <div className={styles.leftSide}>
        <button
          type="button"
          className={styles.menuButton}
          onClick={onMenuOpen}
          aria-label={
            hasMobileIndicators
              ? t("dashboardNav.openMenuWithUpdates")
              : t("dashboardNav.openMenu")
          }
          aria-haspopup="dialog"
        >
          <span />
          <span />
          <span />

          {hasMobileIndicators && (
            <span className={styles.mobileIndicators} aria-hidden="true">
              {hasUnreadNotifications && (
                <i className={styles.mobileIndicatorDot} />
              )}
              {isTeacher && hasPendingRequests && (
                <i className={styles.mobileIndicatorDot} />
              )}
            </span>
          )}
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
