import { Outlet } from "react-router-dom";

import LanguageSwitcher from "../../components/common/LanguageSwitcher/LanguageSwitcher";
import Footer from "../../components/common/Footer";

import styles from "./PublicLayout.module.css";

const PublicLayout = () => {
  return (
    <div className={styles.layout}>
      <div className={styles.languageBar}>
        <LanguageSwitcher />
      </div>

      <Outlet />

      <Footer />
    </div>
  );
};

export default PublicLayout;