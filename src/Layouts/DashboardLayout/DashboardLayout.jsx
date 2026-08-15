import { Outlet } from "react-router-dom";

import DashboardSidebar from "../../components/dashboard/DashboardSidebar/DashboardSidebar";
import DashboardHeader from "../../components/dashboard/DashboardHeader/DashboardHeader";

import styles from "./DashboardLayout.module.css";

const DashboardLayout = () => {
  return (
    <div className={styles.layout}>
      <DashboardSidebar />

      <div className={styles.main}>
        <DashboardHeader />

        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;