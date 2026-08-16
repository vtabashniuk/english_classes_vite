import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import styles from "./LessonCta.module.css";

const LessonCta = () => {
  const { t } = useTranslation();

  return (
    <section className={styles.section}>
      <div className={styles.card}>
        <h2>{t("home.lessonCta.title")}</h2>
        <p>{t("home.lessonCta.description")}</p>

        <Link to="/login" className={styles.button}>
          {t("home.lessonCta.button")}
        </Link>
      </div>
    </section>
  );
};

export default LessonCta;
