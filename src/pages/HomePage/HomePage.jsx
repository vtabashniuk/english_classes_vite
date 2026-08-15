import Hero from "../../components/home/Hero/Hero";
import Benefits from "../../components/home/Benefits/Benefits";
import QuickActions from "../../components/home/QuickActions/QuickActions";
import LessonCta from "../../components/home/LessonCta/LessonCta";

import styles from "./HomePage.module.css";

const HomePage = () => {
  return (
    <main className={styles.page}>
      <Hero />
      <Benefits />
      <QuickActions />
      <LessonCta />
    </main>
  );
};

export default HomePage;