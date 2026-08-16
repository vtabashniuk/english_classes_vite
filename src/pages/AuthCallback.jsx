import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

import { supabase } from "../lib/supabase";

const AuthCallback = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const handleCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");

      if (!code) {
        navigate("/login", { replace: true });
        return;
      }

      const { error } = await supabase.auth.exchangeCodeForSession(code);

      if (error) {
        console.error("Auth callback error:", error);
        navigate("/login", { replace: true });
        return;
      }

      navigate("/set-password", { replace: true });
    };

    handleCallback();
  }, [navigate]);

  return (
    <section>
      <p>Завершення авторизації...</p>
    </section>
  );
};

export default AuthCallback;
