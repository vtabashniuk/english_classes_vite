import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import { useAuth } from "../../../context/AuthContext";

import styles from "./DashboardSidebar.module.css";

const DashboardSidebar = () => {
  const { t } = useTranslation();
  const { profile } = useAuth();

  const isTeacher = profile?.role === "teacher";

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
      to: "/teacher-dashboard/messages",
      labelKey: "dashboardNav.messages",
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
      to: "/student-area/messages",
      labelKey: "dashboardNav.messages",
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
    <aside className={styles.sidebar}>
      <div className={styles.logo}>English with Olga</div>

      <nav className={styles.nav} aria-label={t("dashboardNav.ariaLabel")}>
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              `${styles.link} ${isActive ? styles.active : ""}`
            }
          >
            {t(link.labelKey)}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
};

export default DashboardSidebar;
