import { Outlet } from "react-router-dom";
import LanguageSwitcher from "../components/common/LanguageSwitcher/LanguageSwitcher";
import Footer from "../components/common/Footer";

const RootLayout = () => {
  return (
    <>
      <LanguageSwitcher />
      <Outlet />
      <Footer />
    </>
  );
};

export default RootLayout;
