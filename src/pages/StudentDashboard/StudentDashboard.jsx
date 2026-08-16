import { useTranslation } from "react-i18next";

const StudentDashboard = () => {
  const { t } = useTranslation();

  return (
    <section>
      <h1>{t("student.title")}</h1>
    </section>
  );
};

export default StudentDashboard;
