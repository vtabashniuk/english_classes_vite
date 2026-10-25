import { lazy, Suspense } from "react";
import { createBrowserRouter } from "react-router-dom";

import PublicLayout from "./Layouts/PublicLayout/PublicLayout";
import MainLayout from "./Layouts/MainLayout";
import HeaderLayout from "./Layouts/HeaderLayout";
import DashboardLayout from "./Layouts/DashboardLayout/DashboardLayout";
import ProtectedRoute from "./components/auth/ProtectedRoute";
import RouteLoading from "./components/common/RouteLoading";

// Page components are loaded only when their route is visited.
// Keep auth providers, layouts, and protected-route checks eager.
const HomePage = lazy(() => import("./pages/HomePage/HomePage"));
const AboutMePage = lazy(() => import("./pages/AboutMePage/AboutMePage"));
const LoginPage = lazy(() => import("./pages/LoginPage/LoginPage"));
const ForgotPasswordPage = lazy(() => import("./pages/ForgotPasswordPage/ForgotPasswordPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage/ResetPasswordPage"));
const StudentDashboard = lazy(() => import("./pages/StudentDashboard/StudentDashboard"));
const StudentSchedule = lazy(() => import("./pages/StudentSchedule/StudentSchedule"));
const StudentProfile = lazy(() => import("./pages/StudentProfile/StudentProfile"));
const StudentAssignments = lazy(() => import("./pages/StudentAssignments/StudentAssignments"));
const StudentMaterials = lazy(() => import("./pages/StudentMaterials/StudentMaterials"));
const TeacherDashboard = lazy(() => import("./pages/TeacherDashboard/TeacherDashboard"));
const TeacherSettings = lazy(() => import("./pages/TeacherSettings/TeacherSettings"));
const TeacherFinance = lazy(() => import("./pages/TeacherFinance/TeacherFinance"));
const TeacherSchedule = lazy(() => import("./pages/TeacherSchedule/TeacherSchedule"));
const TeacherStudents = lazy(() => import("./pages/TeacherStudents/TeacherStudents"));
const TeacherStudentDetails = lazy(() => import("./pages/TeacherStudentDetails/TeacherStudentDetails"));
const TeacherRequests = lazy(() => import("./pages/TeacherRequests/TeacherRequests"));
const TeacherMaterials = lazy(() => import("./pages/TeacherMaterials/TeacherMaterials"));
const Notifications = lazy(() => import("./pages/Notifications/Notifications"));
const AuthCallback = lazy(() => import("./pages/AuthCallback/AuthCallback"));
const GoogleAuthCallback = lazy(() => import("./pages/GoogleAuthCallback/GoogleAuthCallback"));
const GoogleInvitationAcceptance = lazy(() => import("./pages/GoogleInvitationAcceptance/GoogleInvitationAcceptance"));
const NotFoundPage = lazy(() => import("./pages/NotFoundPage/NotFoundPage"));
const SetPasswordPage = lazy(() => import("./pages/SetPasswordPage/SetPasswordPage"));

const showPage = (Component) => (
  <Suspense fallback={<RouteLoading />}>
    <Component />
  </Suspense>
);

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
            element: showPage(HomePage),
          },
        ],
      },
      {
        path: "/about-me",
        element: <HeaderLayout />,
        children: [
          {
            index: true,
            element: showPage(AboutMePage),
          },
        ],
      },
      {
        path: "/login",
        element: showPage(LoginPage),
      },
      {
        path: "/forgot-password",
        element: showPage(ForgotPasswordPage),
      },
      {
        path: "/reset-password",
        element: showPage(ResetPasswordPage),
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
        element: showPage(StudentDashboard),
      },
      {
        path: "schedule",
        element: showPage(StudentSchedule),
      },
      {
        path: "profile",
        element: showPage(StudentProfile),
      },
      {
        path: "notifications",
        element: showPage(Notifications),
      },
      {
        path: "assignments",
        element: showPage(StudentAssignments),
      },
      {
        path: "materials",
        element: showPage(StudentMaterials),
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
        element: showPage(TeacherDashboard),
      },
      {
        path: "settings",
        element: showPage(TeacherSettings),
      },
      {
        path: "schedule",
        element: showPage(TeacherSchedule),
      },
      {
        path: "students",
        element: showPage(TeacherStudents),
      },
      {
        path: "students/:studentId",
        element: showPage(TeacherStudentDetails),
      },
      {
        path: "requests",
        element: showPage(TeacherRequests),
      },
      {
        path: "notifications",
        element: showPage(Notifications),
      },
      {
        path: "materials",
        element: showPage(TeacherMaterials),
      },
      {
        path: "finance",
        element: showPage(TeacherFinance),
      },
    ],
  },
  {
    path: "/auth/google/callback",
    element: showPage(GoogleAuthCallback),
  },
  {
    path: "/google/accept-invitation",
    element: showPage(GoogleInvitationAcceptance),
  },
  {
    path: "/auth/callback",
    element: showPage(AuthCallback),
  },
  {
    path: "/set-password",
    element: showPage(SetPasswordPage),
  },
  {
    path: "*",
    element: showPage(NotFoundPage),
  },
]);

export default router;
