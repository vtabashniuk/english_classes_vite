import { useTranslation } from "react-i18next";

const Footer = () => {
  const { t } = useTranslation();

  return <div>{t("common.footer")}</div>;
};

export default Footer;
