import { useTranslation } from "react-i18next";

import styles from "./Benefits.module.css";

const benefitItems = [
  {
    id: "personalized",
    icon: "/assets/star.svg",
    titleKey: "home.benefits.personalized.title",
    descriptionKey: "home.benefits.personalized.description",
    defaultTitle: "Personalized Learning",
    defaultDescription: "Tailored lessons for your specific goals",
  },
  {
    id: "flexible",
    icon: "/assets/clock.svg",
    titleKey: "home.benefits.flexible.title",
    descriptionKey: "home.benefits.flexible.description",
    defaultTitle: "Flexible Schedule",
    defaultDescription: "Book lessons that fit your lifestyle",
  },
  {
    id: "proven",
    icon: "/assets/diploma.svg",
    titleKey: "home.benefits.proven.title",
    descriptionKey: "home.benefits.proven.description",
    defaultTitle: "Proven Results",
    defaultDescription: "Effective methods with measurable success",
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
        {t("home.benefits.title", {
          defaultValue: "Benefits of learning",
        })}
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
          </article>
        ))}
      </div>
    </section>
  );
};

export default Benefits;