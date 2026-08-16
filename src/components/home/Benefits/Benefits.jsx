import { useTranslation } from "react-i18next";

import styles from "./Benefits.module.css";

const benefitItems = [
  {
    id: "personalized",
    icon: "/assets/star.svg",
    titleKey: "home.benefits.personalized.title",
    descriptionKey: "home.benefits.personalized.description",
  },
  {
    id: "flexible",
    icon: "/assets/clock.svg",
    titleKey: "home.benefits.flexible.title",
    descriptionKey: "home.benefits.flexible.description",
  },
  {
    id: "proven",
    icon: "/assets/diploma.svg",
    titleKey: "home.benefits.proven.title",
    descriptionKey: "home.benefits.proven.description",
  },
];

const Benefits = () => {
  const { t } = useTranslation();

  return (
    <section
      className={styles.section}
      aria-labelledby="benefits-title"
    >
      <h2 id="benefits-title" className={styles.visuallyHidden}>
        {t("home.benefits.title")}
      </h2>

      <div className={styles.grid}>
        {benefitItems.map((item) => (
          <article key={item.id} className={styles.card}>
            <img
              className={styles.icon}
              src={item.icon}
              alt=""
              aria-hidden="true"
            />

            <h3>{t(item.titleKey)}</h3>
            <p>{t(item.descriptionKey)}</p>
          </article>
        ))}
      </div>
    </section>
  );
};

export default Benefits;
