import { useCallback, useEffect, useMemo, useState } from "react";

import {
  getSession,
  onAuthStateChange,
  signOut as signOutUser,
} from "../features/auth/api/authApi";
import { getProfileById } from "../features/profiles/api/profilesApi";
import { AuthContext } from "./authContext";

const loadProfile = async (userId) => {
  const { data, error } = await getProfileById(userId);

  if (error) {
    console.error("Не вдалося завантажити профіль:", error);
    return null;
  }

  return data;
};

export const AuthProvider = ({ children }) => {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let isMounted = true;

    const initializeAuth = async () => {
      try {
        const {
          data: { session: currentSession },
          error,
        } = await getSession();

        if (error) {
          throw error;
        }

        if (!isMounted) {
          return;
        }

        setSession(currentSession);

        if (currentSession?.user) {
          const currentProfile = await loadProfile(currentSession.user.id);

          if (isMounted) {
            setProfile(currentProfile);
          }
        } else {
          setProfile(null);
        }
      } catch (error) {
        console.error("Помилка ініціалізації авторизації:", error);

        if (isMounted) {
          setSession(null);
          setProfile(null);
        }
      } finally {
        if (isMounted) {
          setLoading(false);
        }
      }
    };

    initializeAuth();

    const {
      data: { subscription },
    } = onAuthStateChange((_event, newSession) => {
      setSession(newSession);

      if (!newSession?.user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      setLoading(true);

      setTimeout(async () => {
        const currentProfile = await loadProfile(newSession.user.id);

        if (isMounted) {
          setProfile(currentProfile);
          setLoading(false);
        }
      }, 0);
    });

    return () => {
      isMounted = false;
      subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    if (!session?.user) {
      setProfile(null);
      return null;
    }

    const currentProfile = await loadProfile(session.user.id);
    setProfile(currentProfile);

    return currentProfile;
  }, [session]);

  const signOut = useCallback(async () => {
    const { error } = await signOutUser();

    if (error) {
      throw error;
    }
  }, []);

  const value = useMemo(
    () => ({
      session,
      user: session?.user ?? null,
      profile,
      loading,
      refreshProfile,
      signOut,
    }),
    [session, profile, loading, refreshProfile, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

export default AuthProvider;
