import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import styles from "./Hero.module.css"; // Модульний CSS для Hero

const Hero = () => {
  const { t } = useTranslation();

  return (
    <section
      itemScope
      itemType="https://schema.org/EducationalOccupationalSkill"
      className={styles.hero}
    >
      <div className={styles.heroContent}>
        <h1
          itemProp="name"
          dangerouslySetInnerHTML={{ __html: t("home.hero.title") }}
        />
        <p>
          {t("home.hero.description", {
            defaultValue:
              "Improve your English skills with personalized one-on-one lessons designed to help you achieve your language goals.",
          })}
        </p>
        {/* Кнопки CTA */}
        <div className={styles.heroButtons}>
          <Link to="/student-area" className={styles.button}>
            <div className={styles.buttonContainer}>
              <img
                className={styles.icon}
                src="/assets/person.svg"
                alt="Enter to the cabinet"
              />
              {t("home.hero.buttons.studentArea", {
                defaultValue: "Go to Student Area",
              })}
            </div>
          </Link>
          <Link
            to="/about-me"
            className={`${styles.button} ${styles.inverted}`}
          >
            <div className={styles.buttonContainer}>
              <img
                className={styles.icon}
                src="/assets/info.svg"
                alt="Information"
              />
              {t("home.hero.buttons.meetTeacher", {
                defaultValue: "Meet Your Teacher",
              })}
            </div>
          </Link>
        </div>

        {/* Картки користі */}
        <div className={styles.benefitsGrid}>
          <div className={styles.benefitCard}>
            <img className={styles.icon} src="/assets/star.svg" alt="Star" />
            <h3>
              {t("home.hero.benefits.personalized", {
                defaultValue: "Personalized Learning",
              })}
            </h3>
            <p>
              {t("home.hero.benefits.personalizedDesc", {
                defaultValue: "Tailored lessons for your specific goals",
              })}
            </p>
          </div>
          <div className={styles.benefitCard}>
            <img className={styles.icon} src="/assets/clock.svg" alt="Clock" />
            <h3>
              {t("home.hero.benefits.flexible", {
                defaultValue: "Flexible Schedule",
              })}
            </h3>
            <p>
              {t("home.hero.benefits.flexibleDesc", {
                defaultValue: "Book lessons that fit your lifestyle",
              })}
            </p>
          </div>
          <div className={styles.benefitCard}>
            <img
              className={styles.icon}
              src="/assets/diploma.svg"
              alt="Diploma"
            />
            <h3>
              {t("home.hero.benefits.proven", {
                defaultValue: "Proven Results",
              })}
            </h3>
            <p>
              {t("home.hero.benefits.provenDesc", {
                defaultValue: "Effective methods with measurable success",
              })}
            </p>
          </div>
        </div>
      </div>

      {/* Зображення */}
      <div className={styles.heroImage}>
        <img
          src="/assets/desk-books-1200.webp"
          alt={t("home.hero.imageAlt", {
            defaultValue:
              "Desk with English learning materials and notebook: Do You Speak English?",
          })}
          loading="lazy"
          decoding="async"
          className={styles.heroImg}
        />
      </div>
    </section>
  );
};

export default Hero;
