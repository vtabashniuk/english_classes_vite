import { RouterProvider } from "react-router-dom";
import { AuthProvider } from "./context/AuthProvider";
import router from "./router";
import ToastProvider from "./shared/toast/ToastProvider";

const App = () => {
  return (
    <ToastProvider>
      <AuthProvider>
        <RouterProvider router={router} />
      </AuthProvider>
    </ToastProvider>
  );
};

export default App;
