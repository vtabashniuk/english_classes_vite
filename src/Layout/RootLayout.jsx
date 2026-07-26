import { Outlet } from "react-router-dom";
import LanguageSwitcher from "../components/LanguageSwitcher/LanguageSwitcher";
import Footer from "../components/Footer";

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
