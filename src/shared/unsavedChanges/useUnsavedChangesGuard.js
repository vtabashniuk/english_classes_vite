import { useCallback, useEffect, useState } from "react";
import { useBlocker } from "react-router-dom";
import { hasUnsavedChanges, updateDirtyForm } from "./dirtyForms";

/**
 * For use within a data router. A page registers each independent form with
 * setFormDirty(formId, boolean). Never pass sensitive values (e.g. passwords).
 * The router blocks both page navigation and URL-tab navigation.
 */
export default function useUnsavedChangesGuard() {
  const [dirtyForms, setDirtyForms] = useState({});
  const setFormDirty = useCallback((id, dirty) => {
    setDirtyForms((current) => updateDirtyForm(current, id, dirty));
  }, []);
  const isDirty = hasUnsavedChanges(dirtyForms);
  const blocker = useBlocker(isDirty);

  useEffect(() => {
    if (!isDirty) return undefined;
    const beforeUnload = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [isDirty]);

  const stay = useCallback(() => {
    if (blocker.state === "blocked") blocker.reset();
  }, [blocker]);
  const leave = useCallback(() => {
    if (blocker.state === "blocked") blocker.proceed();
  }, [blocker]);

  return { isDirty, dirtyForms, setFormDirty, isPromptOpen: blocker.state === "blocked", stay, leave };
}
