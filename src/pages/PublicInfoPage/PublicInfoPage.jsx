import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import styles from "./PublicInfoPage.module.css";

const pageByPath = {
  "/about": "about",
  "/privacy": "privacy",
  "/terms": "terms",
};

// Keep the public contact aligned with Google OAuth Branding's support email.
const SUPPORT_EMAIL = "vtabashniuk@gmail.com";

const PublicInfoPage = () => {
  const { pathname } = useLocation();
  const { t, i18n } = useTranslation();
  const page = pageByPath[pathname.replace(/\/$/, "")] ?? "about";
  const prefix = `publicInfo.${page}`;
  const sections = t(`${prefix}.sections`, { returnObjects: true });

  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${t(`${prefix}.title`)} | English Classes CRM`;
    return () => { document.title = previousTitle; };
  }, [i18n.resolvedLanguage, prefix, t]);

  return (
    <main className={styles.page} id="main-content">
      <article className={styles.paper}>
        <header className={styles.heading}>
          <p className={styles.eyebrow}>English Classes CRM</p>
          <h1>{t(`${prefix}.title`)}</h1>
          <p className={styles.lead}>{t(`${prefix}.lead`)}</p>
          <p className={styles.updated}>{t("publicInfo.updated")}</p>
        </header>

        {Array.isArray(sections) && sections.map((section, index) => (
          <section className={styles.section} key={`${page}-${index}`}>
            <h2>{section.title}</h2>
            {section.paragraphs?.map((paragraph, paragraphIndex) => (
              <p key={paragraphIndex}>{paragraph}</p>
            ))}
            {section.bullets?.length > 0 && (
              <ul>
                {section.bullets.map((bullet, bulletIndex) => (
                  <li key={bulletIndex}>{bullet}</li>
                ))}
              </ul>
            )}
          </section>
        ))}

        {page !== "about" && (
          <section className={styles.contact} aria-labelledby="public-contact-title">
            <h2 id="public-contact-title">{t("publicInfo.contactTitle")}</h2>
            <p>{t("publicInfo.contactText")}</p>
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </section>
        )}

        <nav className={styles.links} aria-label={t("publicInfo.navigationLabel")}>
          <Link to="/about">{t("publicInfo.navigation.about")}</Link>
          <Link to="/privacy">{t("publicInfo.navigation.privacy")}</Link>
          <Link to="/terms">{t("publicInfo.navigation.terms")}</Link>
          <Link to="/login">{t("publicInfo.navigation.signIn")}</Link>
        </nav>
      </article>
    </main>
  );
};

export default PublicInfoPage;
