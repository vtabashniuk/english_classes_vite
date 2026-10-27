import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import styles from "./Footer.module.css";

const Footer = () => {
  const { t } = useTranslation();

  return (
    <footer className={styles.footer}>
      <span>© {new Date().getFullYear()} English Classes CRM</span>
      <nav className={styles.links} aria-label={t("publicInfo.navigationLabel")}>
        <Link to="/about">{t("publicInfo.navigation.about")}</Link>
        <Link to="/privacy">{t("publicInfo.navigation.privacy")}</Link>
        <Link to="/terms">{t("publicInfo.navigation.terms")}</Link>
      </nav>
    </footer>
  );
};

export default Footer;
