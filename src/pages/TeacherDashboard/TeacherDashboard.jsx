import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import styles from "./TeacherDashboard.module.css";

const TeacherDashboard = () => {
  const { t } = useTranslation();

  const actions = [
    {
      to: "/teacher-dashboard/schedule",
      titleKey: "teacherDashboard.actions.schedule.title",
      descriptionKey: "teacherDashboard.actions.schedule.description",
    },
    {
      to: "/teacher-dashboard/students",
      titleKey: "teacherDashboard.actions.students.title",
      descriptionKey: "teacherDashboard.actions.students.description",
    },
    {
      to: "/teacher-dashboard/settings",
      titleKey: "teacherDashboard.actions.settings.title",
      descriptionKey: "teacherDashboard.actions.settings.description",
    },
  ];

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <h1>{t("teacherDashboard.title")}</h1>
        <p>{t("teacherDashboard.description")}</p>
      </header>

      <div className={styles.grid}>
        {actions.map((action) => (
          <Link key={action.to} to={action.to} className={styles.card}>
            <div>
              <h2>{t(action.titleKey)}</h2>
              <p>{t(action.descriptionKey)}</p>
            </div>

            <span className={styles.arrow} aria-hidden="true">
              →
            </span>
          </Link>
        ))}
      </div>
    </section>
  );
};

export default TeacherDashboard;
