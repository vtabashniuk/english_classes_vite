import { useTranslation } from "react-i18next";

const TeacherDashboard = () => {
  const { t } = useTranslation();

  return (
    <section>
      <h1>{t("teacherDashboard.title")}</h1>
      <p>{t("teacherDashboard.description")}</p>
    </section>
  );
};

export default TeacherDashboard;
