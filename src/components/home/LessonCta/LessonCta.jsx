import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import styles from "./LessonCta.module.css";

const LessonCta = () => {
  const { t } = useTranslation();

  return (
    <section className={styles.section}>
      <div className={styles.card}>
        <h2>
          {t("home.lessonCta.title", {
            defaultValue: "Ready for today's lesson?",
          })}
        </h2>

        <p>
          {t("home.lessonCta.description", {
            defaultValue:
              "Continue your learning journey with personalized lessons and practical exercises.",
          })}
        </p>

        <Link to="/login" className={styles.button}>
          {t("home.lessonCta.button", {
            defaultValue: "Go to your lesson",
          })}
        </Link>
      </div>
    </section>
  );
};

export default LessonCta;