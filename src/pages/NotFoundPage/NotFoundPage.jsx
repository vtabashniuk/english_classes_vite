import { useTranslation } from "react-i18next";
import { Link, useLocation } from "react-router-dom";

import styles from "./NotFoundPage.module.css";

const NotFoundPage = () => {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const dashboardPath = pathname.startsWith("/teacher-dashboard/")
    ? "/teacher-dashboard"
    : pathname.startsWith("/student-area/")
      ? "/student-area"
      : null;

  return (
    <div className={styles.container}>
      <section className={styles.card} aria-labelledby="not-found-heading">
        <span className={styles.code} aria-hidden="true">404</span>
        <h1 id="not-found-heading" className={styles.title}>
          {t("notFound.title")}
        </h1>
        <p className={styles.description}>{t("notFound.description")}</p>
        <Link className={styles.link} to={dashboardPath ?? "/"}>
          {dashboardPath ? t("notFound.backDashboard") : t("notFound.backHome")}
        </Link>
      </section>
    </div>
  );
};

export default NotFoundPage;
