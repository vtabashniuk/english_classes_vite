import { useState } from "react";
import { Outlet } from "react-router-dom";

import DashboardSidebar from "../../components/dashboard/DashboardSidebar/DashboardSidebar";
import DashboardHeader from "../../components/dashboard/DashboardHeader/DashboardHeader";

import styles from "./DashboardLayout.module.css";

const DashboardLayout = () => {
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  const openSidebar = () => {
    setIsSidebarOpen((current) => !current);
  };

  const closeSidebar = () => {
    setIsSidebarOpen(false);
  };

  return (
    <div className={styles.layout}>
      <DashboardSidebar isOpen={isSidebarOpen} onClose={closeSidebar} />

      <div className={styles.main}>
        <DashboardHeader onMenuOpen={openSidebar} />

        <main className={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default DashboardLayout;
