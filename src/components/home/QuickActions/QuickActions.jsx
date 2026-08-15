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
    defaultTitle: "Student Area",
    defaultDescription:
      "Access your schedule, learning materials and balance.",
    defaultButton: "Sign in",
  },
  {
    id: "aboutTeacher",
    icon: "/assets/info.svg",
    path: "/about-me",
    titleKey: "home.quickActions.aboutTeacher.title",
    descriptionKey: "home.quickActions.aboutTeacher.description",
    buttonKey: "home.quickActions.aboutTeacher.button",
    defaultTitle: "About the Teacher",
    defaultDescription:
      "Learn more about teaching experience and lesson format.",
    defaultButton: "Learn more",
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
        <h2 id="quick-actions-title">
          {t("home.quickActions.title", {
            defaultValue: "What would you like to do?",
          })}
        </h2>

        <p>
          {t("home.quickActions.description", {
            defaultValue: "Choose an option below to get started.",
          })}
        </p>
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

            <h3>
              {t(item.titleKey, {
                defaultValue: item.defaultTitle,
              })}
            </h3>

            <p>
              {t(item.descriptionKey, {
                defaultValue: item.defaultDescription,
              })}
            </p>

            <Link to={item.path} className={styles.button}>
              {t(item.buttonKey, {
                defaultValue: item.defaultButton,
              })}
            </Link>
          </article>
        ))}
      </div>
    </section>
  );
};

export default QuickActions;