import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  getSession,
  onAuthStateChange,
  signOut as signOutUser,
} from "../features/auth/api/authApi";
import { getProfileById } from "../features/profiles/api/profilesApi";
import SessionInactivityGuard from "../features/auth/components/SessionInactivityGuard";
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

  // Requests from an earlier Auth UUID must never overwrite a later session.
  const authRevision = useRef(0);
  const currentUserId = useRef(null);

  useEffect(() => {
    let mounted = true;
    let revision = 0;

    const applySession = (nextSession) => {
      if (!mounted) return;
      const request = ++revision;
      authRevision.current = request;
      const userId = nextSession?.user?.id ?? null;
      currentUserId.current = userId;
      setSession(nextSession);
      setProfile(null);
      if (!userId) {
        setLoading(false);
        return;
      }
      setLoading(true);
      // Avoid awaiting Supabase queries inside onAuthStateChange (Auth lock).
      setTimeout(async () => {
        const nextProfile = await loadProfile(userId);
        if (mounted && request === revision && currentUserId.current === userId) {
          setProfile(nextProfile?.id === userId ? nextProfile : null);
          setLoading(false);
        }
      }, 0);
    };

    // Subscribe before reading session; a later Auth event wins any race.
    const { data: { subscription } } = onAuthStateChange((_event, nextSession) => {
      applySession(nextSession);
    });
    getSession().then(({ data, error }) => {
      if (!mounted || revision !== 0) return;
      if (error) console.error("Помилка ініціалізації авторизації:", error);
      applySession(error ? null : data?.session);
    }).catch((error) => {
      if (!mounted || revision !== 0) return;
      console.error("Помилка ініціалізації авторизації:", error);
      applySession(null);
    });

    return () => {
      mounted = false;
      revision += 1;
      authRevision.current = revision;
      currentUserId.current = null;
      subscription.unsubscribe();
    };
  }, []);

  const refreshProfile = useCallback(async () => {
    const userId = session?.user?.id;
    if (!userId || currentUserId.current !== userId) return null;
    const request = authRevision.current;
    const nextProfile = await loadProfile(userId);
    if (authRevision.current !== request || currentUserId.current !== userId) {
      return null;
    }
    setProfile(nextProfile?.id === userId ? nextProfile : null);
    return nextProfile?.id === userId ? nextProfile : null;
  }, [session?.user?.id]);

  const signOut = useCallback(async (options) => {
    const { error } = await signOutUser(options);

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

  return (
    <AuthContext.Provider value={value}>
      {session?.user && profile?.id === session.user.id &&
        ["teacher", "student"].includes(profile.role) && (
          <SessionInactivityGuard
            key={`${session.user.id}:${session.user.last_sign_in_at ?? "initial"}`}
            userId={session.user.id}
            sessionMarker={session.user.last_sign_in_at ?? session.user.created_at ?? "initial"}
            role={profile.role}
            signOut={signOut}
          />
        )}
      {children}
    </AuthContext.Provider>
  );
};

export default AuthProvider;
