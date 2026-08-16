import { NavLink } from "react-router-dom";

import { useAuth } from "../../../context/AuthContext";

import styles from "./DashboardSidebar.module.css";

const DashboardSidebar = () => {
  const { profile } = useAuth();

  const isTeacher = profile?.role === "teacher";

  const teacherLinks = [
    {
      to: "/teacher-dashboard",
      label: "Огляд",
      end: true,
    },
    {
      to: "/teacher-dashboard/schedule",
      label: "Розклад",
    },
    {
      to: "/teacher-dashboard/students",
      label: "Учні",
    },
    {
      to: "/teacher-dashboard/requests",
      label: "Запити",
    },
    {
      to: "/teacher-dashboard/messages",
      label: "Повідомлення",
    },
    {
      to: "/teacher-dashboard/assignments",
      label: "Завдання",
    },
    {
      to: "/teacher-dashboard/materials",
      label: "Матеріали",
    },
    {
      to: "/teacher-dashboard/finance",
      label: "Фінанси",
    },
  ];

  const studentLinks = [
    {
      to: "/student-area",
      label: "Огляд",
      end: true,
    },
    {
      to: "/student-area/profile",
      label: "Профіль",
    },
    {
      to: "/student-area/schedule",
      label: "Розклад",
    },
    {
      to: "/student-area/messages",
      label: "Повідомлення",
    },
    {
      to: "/student-area/assignments",
      label: "Завдання",
    },
    {
      to: "/student-area/materials",
      label: "Матеріали",
    },
    {
      to: "/student-area/balance",
      label: "Баланс",
    },
  ];

  const links = isTeacher ? teacherLinks : studentLinks;

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logo}>English with Olga</div>

      <nav className={styles.nav}>
        {links.map((link) => (
          <NavLink
            key={link.to}
            to={link.to}
            end={link.end}
            className={({ isActive }) =>
              `${styles.link} ${isActive ? styles.active : ""}`
            }
          >
            {link.label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
};

export default DashboardSidebar;
