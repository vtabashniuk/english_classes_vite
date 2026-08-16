import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import styles from "./QuickActions.module.css";

const actionItems = [
  {
    id: "studentArea",
    icon: "/assets/person.svg",
    path: "/login",
    titleKey: "home.quickActions.studentArea.title",
    descriptionKey: "home.quickActions.studentArea.description",
    buttonKey: "home.quickActions.studentArea.button",
  },
  {
    id: "aboutTeacher",
    icon: "/assets/info.svg",
    path: "/about-me",
    titleKey: "home.quickActions.aboutTeacher.title",
    descriptionKey: "home.quickActions.aboutTeacher.description",
    buttonKey: "home.quickActions.aboutTeacher.button",
  },
];

const QuickActions = () => {
  const { t } = useTranslation();

  return (
    <section
      className={styles.section}
      aria-labelledby="quick-actions-title"
    >
      <div className={styles.heading}>
        <h2 id="quick-actions-title">{t("home.quickActions.title")}</h2>
        <p>{t("home.quickActions.description")}</p>
      </div>

      <div className={styles.grid}>
        {actionItems.map((item) => (
          <article key={item.id} className={styles.card}>
            <img
              className={styles.icon}
              src={item.icon}
              alt=""
              aria-hidden="true"
            />

            <h3>{t(item.titleKey)}</h3>
            <p>{t(item.descriptionKey)}</p>

            <Link to={item.path} className={styles.button}>
              {t(item.buttonKey)}
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
};

export default QuickActions;
