import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { NavLink, useLocation } from "react-router-dom";

import { useAuth } from "../../../context/AuthContext";
import { supabase } from "../../../lib/supabase";

import styles from "./DashboardSidebar.module.css";

const DashboardSidebar = ({ isOpen = false, onClose = () => {} }) => {
  const { t } = useTranslation();
  const { profile } = useAuth();
  const location = useLocation();

  const [hasUnreadNotifications, setHasUnreadNotifications] = useState(false);
  const [hasPendingRequests, setHasPendingRequests] = useState(false);

  const isTeacher = profile?.role === "teacher";

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    const previousOverflow = document.body.style.overflow;

    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);


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

  const teacherLinks = [
    {
      to: "/teacher-dashboard",
      labelKey: "dashboardNav.overview",
      end: true,
    },
    {
      to: "/teacher-dashboard/schedule",
      labelKey: "dashboardNav.schedule",
    },
    {
      to: "/teacher-dashboard/students",
      labelKey: "dashboardNav.students",
    },
    {
      to: "/teacher-dashboard/requests",
      labelKey: "dashboardNav.requests",
    },
    {
      to: "/teacher-dashboard/notifications",
      labelKey: "dashboardNav.notifications",
    },
    {
      to: "/teacher-dashboard/assignments",
      labelKey: "dashboardNav.assignments",
    },
    {
      to: "/teacher-dashboard/materials",
      labelKey: "dashboardNav.materials",
    },
    {
      to: "/teacher-dashboard/finance",
      labelKey: "dashboardNav.finance",
    },
    {
      to: "/teacher-dashboard/settings",
      labelKey: "dashboardNav.settings",
    },
  ];

  const studentLinks = [
    {
      to: "/student-area",
      labelKey: "dashboardNav.overview",
      end: true,
    },
    {
      to: "/student-area/profile",
      labelKey: "dashboardNav.profile",
    },
    {
      to: "/student-area/schedule",
      labelKey: "dashboardNav.schedule",
    },
    {
      to: "/student-area/notifications",
      labelKey: "dashboardNav.notifications",
    },
    {
      to: "/student-area/assignments",
      labelKey: "dashboardNav.assignments",
    },
    {
      to: "/student-area/materials",
      labelKey: "dashboardNav.materials",
    },
    {
      to: "/student-area/balance",
      labelKey: "dashboardNav.balance",
    },
  ];

  const links = isTeacher ? teacherLinks : studentLinks;

  return (
    <>
      <button
        type="button"
        className={styles.overlay}
        data-open={isOpen ? "true" : "false"}
        onClick={onClose}
        aria-label={t("dashboardNav.closeMenu")}
        tabIndex={isOpen ? 0 : -1}
      />

      <aside
        className={styles.sidebar}
        data-open={isOpen ? "true" : "false"}
        aria-label={t("dashboardNav.ariaLabel")}
      >
        <div className={styles.topRow}>
          <div className={styles.logo}>English with Olga</div>

          <button
            type="button"
            className={styles.closeButton}
            onClick={onClose}
            aria-label={t("dashboardNav.closeMenu")}
          >
            ×
          </button>
        </div>

        <nav className={styles.nav}>
          {links.map((link) => (
            <NavLink
              key={link.to}
              to={link.to}
              end={link.end}
              onClick={onClose}
              className={({ isActive }) =>
                `${styles.link} ${isActive ? styles.active : ""}`
              }
            >
              <span className={styles.linkLabel}>{t(link.labelKey)}</span>

              {link.labelKey === "dashboardNav.notifications" &&
                hasUnreadNotifications && (
                  <span
                    className={styles.notificationDot}
                    title={t("dashboardNav.unreadNotifications")}
                    aria-label={t("dashboardNav.unreadNotifications")}
                  />
                )}

              {isTeacher &&
                link.labelKey === "dashboardNav.requests" &&
                hasPendingRequests && (
                  <span
                    className={styles.notificationDot}
                    title={t("dashboardNav.pendingRequests", {
                      defaultValue: "Є запити, що очікують рішення",
                    })}
                    aria-label={t("dashboardNav.pendingRequests", {
                      defaultValue: "Є запити, що очікують рішення",
                    })}
                  />
                )}
            </NavLink>
          ))}
        </nav>
      </aside>
    </>
  );
};

export default DashboardSidebar;
