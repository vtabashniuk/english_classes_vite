import { createBrowserRouter } from "react-router-dom";

import PublicLayout from "./Layouts/PublicLayout/PublicLayout";
import MainLayout from "./Layouts/MainLayout";
import HeaderLayout from "./Layouts/HeaderLayout";
import DashboardLayout from "./Layouts/DashboardLayout/DashboardLayout";

import HomePage from "./pages/HomePage/HomePage";
import AboutMePage from "./pages/AboutMePage";
import LoginPage from "./pages/LoginPage/LoginPage";

import StudentDashboard from "./pages/StudentDashboard/StudentDashboard";
import StudentSchedule from "./pages/StudentSchedule/StudentSchedule";
import StudentProfile from "./pages/StudentProfile/StudentProfile";

import TeacherDashboard from "./pages/TeacherDashboard/TeacherDashboard";
import TeacherSchedule from "./pages/TeacherSchedule/TeacherSchedule";
import TeacherStudents from "./pages/TeacherStudents/TeacherStudents";
import TeacherStudentDetails from "./pages/TeacherStudentDetails/TeacherStudentDetails";

import AuthCallback from "./pages/AuthCallback";
import NotFoundPage from "./pages/NotFoundPage";
import SetPasswordPage from "./pages/SetPasswordPage/SetPasswordPage";

import ProtectedRoute from "./components/auth/ProtectedRoute";

const router = createBrowserRouter([
  {
    element: <PublicLayout />,
    children: [
      {
        path: "/",
        element: <MainLayout />,
        children: [
          {
            index: true,
            element: <HomePage />,
          },
        ],
      },
      {
        path: "/about-me",
        element: <HeaderLayout />,
        children: [
          {
            index: true,
            element: <AboutMePage />,
          },
        ],
      },
      {
        path: "/login",
        element: <LoginPage />,
      },
    ],
  },
  {
    path: "/student-area",
    element: (
      <ProtectedRoute allowedRoles={["student"]}>
        <DashboardLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <StudentDashboard />,
      },
      {
        path: "schedule",
        element: <StudentSchedule />,
      },
      {
        path: "profile",
        element: <StudentProfile />,
      },
    ],
  },
  {
    path: "/teacher-dashboard",
    element: (
      <ProtectedRoute allowedRoles={["teacher"]}>
        <DashboardLayout />
      </ProtectedRoute>
    ),
    children: [
      {
        index: true,
        element: <TeacherDashboard />,
      },
      {
        path: "schedule",
        element: <TeacherSchedule />,
      },
      {
        path: "students",
        element: <TeacherStudents />,
      },
      {
        path: "students/:studentId",
        element: <TeacherStudentDetails />,
      },
    ],
  },
  {
    path: "/auth/callback",
    element: <AuthCallback />,
  },
  {
    path: "/set-password",
    element: <SetPasswordPage />,
  },
  {
    path: "*",
    element: <NotFoundPage />,
  },
]);

export default router;
