import { useTranslation } from "react-i18next";

const Header = () => {
  const { t } = useTranslation();

  return <div>{t("common.header")}</div>;
};

export default Header;
