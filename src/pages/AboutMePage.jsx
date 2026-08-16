import { useTranslation } from "react-i18next";

const AboutMePage = () => {
  const { t } = useTranslation();

  return (
    <section>
      <h1>{t("about.title")}</h1>
    </section>
  );
};

export default AboutMePage;
