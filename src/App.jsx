import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "./context/AuthProvider";
import router from "./router";
import ToastProvider from "./shared/toast/ToastProvider";
import PagePreferencesProvider from "./shared/pagination/PagePreferencesProvider";

const App = () => {
  return (
    <ToastProvider>
      <AuthProvider>
        <PagePreferencesProvider>
          <RouterProvider router={router} />
        </PagePreferencesProvider>
      </AuthProvider>
    </ToastProvider>
  );
};

export default App;
