import { useTranslation } from "react-i18next";

const RouteLoading = () => {
  const { t } = useTranslation();
  return <p role="status" aria-live="polite">{t("common.loading")}</p>;
};

export default RouteLoading;
