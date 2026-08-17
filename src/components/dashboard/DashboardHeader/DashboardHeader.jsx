import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation, useNavigate } from "react-router-dom";

import { useAuth } from "../../../context/AuthContext";
import { supabase } from "../../../lib/supabase";
import LanguageSwitcher from "../../common/LanguageSwitcher/LanguageSwitcher";

import styles from "./DashboardHeader.module.css";

const DashboardHeader = ({ onMenuOpen }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { profile, signOut } = useAuth();

  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const [hasPendingRequests, setHasPendingRequests] = useState(false);

  const isTeacher = profile?.role === "teacher";

  useEffect(() => {
    if (!profile?.id) {
      setHasUnreadNotifications(false);
      return undefined;
    }

    let cancelled = false;

    const loadUnreadState = async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id")
        .eq("is_read", false)
        .limit(1);

      if (!cancelled && !error) {
        setHasUnreadNotifications((data?.length ?? 0) > 0);
      }
    };

    const handleNotificationsChanged = () => {
      loadUnreadState();
    };

    loadUnreadState();
    window.addEventListener("notifications-changed", handleNotificationsChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(
        "notifications-changed",
        handleNotificationsChanged,
      );
    };
  }, [profile?.id, location.pathname]);

  useEffect(() => {
    if (!profile?.id || !isTeacher) {
      setHasPendingRequests(false);
      return undefined;
    }

    let cancelled = false;

    const loadPendingRequestsState = async () => {
      const { data, error } = await supabase
        .from("lesson_requests")
        .select("id")
        .eq("teacher_id", profile.id)
        .eq("status", "pending")
        .limit(1);

      if (!cancelled && !error) {
        setHasPendingRequests((data?.length ?? 0) > 0);
      }
    };

    const handleRequestsChanged = () => {
      loadPendingRequestsState();
    };

    loadPendingRequestsState();
    window.addEventListener("lesson-requests-changed", handleRequestsChanged);

    return () => {
      cancelled = true;
      window.removeEventListener(
        "lesson-requests-changed",
        handleRequestsChanged,
      );
    };
  }, [profile?.id, isTeacher, location.pathname]);

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
