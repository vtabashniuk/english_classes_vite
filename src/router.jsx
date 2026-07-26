import { createBrowserRouter } from "react-router-dom";
import MainLayout from "./Layout/MainLayout";
import HeaderLayout from "./Layout/HeaderLayout";
import HomePage from "./pages/HomePage";
import AboutMePage from "./pages/AboutMePage";
import StudentDashboard from "./pages/StudentDashboard";
import TeacherDashboard from "./pages/TeacherDashboard";
import AuthCallback from "./pages/AuthCallback";
import NotFoundPage from "./pages/NotFoundPage";
import RootLayout from "./Layout/RootLayout";

const router = createBrowserRouter([
  {
    element: <RootLayout />,
    children: [
      {
        path: "/",
        element: <MainLayout />,
        children: [{ index: true, element: <HomePage /> }],
      },
      {
        path: "/about-me",
        element: <HeaderLayout />,
        children: [{ index: true, element: <AboutMePage /> }],
      },
      {
        path: "student-area",
        element: <HeaderLayout />,
        children: [{ index: true, element: <StudentDashboard /> }],
      },
      {
        path: "teacher-dashboard",
        element: <TeacherDashboard />,
      },
      { path: "auth/callback", element: <AuthCallback /> },
      {
        path: "*",
        element: <NotFoundPage />,
      },
    ],
  },
]);

export default router;
