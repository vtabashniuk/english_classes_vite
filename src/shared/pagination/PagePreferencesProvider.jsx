import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../context/useAuth";
import { loadPagePreferences, storePagePreferences } from "../../features/settings/api/userPagePreferencesApi";
import { DEFAULT_PAGE_PREFERENCES, normalizePagePreferences } from "./pagePreferences";
import PagePreferencesContext from "./pagePreferencesContext";

export default function PagePreferencesProvider({ children }) {
  const { user } = useAuth();
  const [state, setState] = useState({ userId: null, preferences: DEFAULT_PAGE_PREFERENCES, ready: false });
  const userId = user?.id ?? null;

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!userId) return;
      const { data, error } = await loadPagePreferences(userId);
      if (error) console.warn("Page preferences load:", error);
      if (!cancelled) {
        setState({ userId, preferences: normalizePagePreferences(error ? null : data?.preferences), ready: true });
      }
    };
    load();
    return () => { cancelled = true; };
  }, [userId]);

  const save = useCallback(async (changes) => {
    if (!userId) throw new Error("Authentication required");
    const base = state.userId === userId ? state.preferences : DEFAULT_PAGE_PREFERENCES;
    const next = normalizePagePreferences({ ...base, ...changes });
    const { error } = await storePagePreferences(userId, next);
    if (error) throw error;
    setState({ userId, preferences: next, ready: true });
  }, [state, userId]);

  const value = useMemo(() => ({
    sizes: state.userId === userId ? state.preferences : DEFAULT_PAGE_PREFERENCES,
    ready: !userId || (state.userId === userId && state.ready),
    save,
  }), [state, userId, save]);
  return <PagePreferencesContext.Provider value={value}>{children}</PagePreferencesContext.Provider>;
}
