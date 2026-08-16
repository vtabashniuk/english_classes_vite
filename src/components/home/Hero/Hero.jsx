import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import styles from "./Hero.module.css";

const Hero = () => {
  const { t } = useTranslation();

  return (
    <section
      className={styles.hero}
      itemScope
      itemType="https://schema.org/EducationalOccupationalSkill"
    >
      <div className={styles.content}>
        <h1
          itemProp="name"
          dangerouslySetInnerHTML={{
            __html: t("home.hero.title"),
          }}
        />

        <p className={styles.description}>
          {t("home.hero.description")}
        </p>

        <div className={styles.actions}>
          <Link to="/login" className={styles.primaryButton}>
            <img
              className={styles.buttonIcon}
              src="/assets/person.svg"
              alt=""
              aria-hidden="true"
            />

            <span>{t("home.hero.buttons.studentArea")}</span>
          </Link>

          <Link to="/about-me" className={styles.secondaryButton}>
            <img
              className={styles.buttonIcon}
              src="/assets/info.svg"
              alt=""
              aria-hidden="true"
            />

            <span>{t("home.hero.buttons.meetTeacher")}</span>
          </Link>
        </div>
      </div>

      <div className={styles.imageWrapper}>
        <img
          src="/assets/desk-books-1200.webp"
          alt={t("home.hero.imageAlt")}
          decoding="async"
          className={styles.image}
        />
      </div>
    </section>
  );
};

export default Hero;
