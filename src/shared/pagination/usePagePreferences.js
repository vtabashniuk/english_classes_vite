import { useContext } from "react";
import PagePreferencesContext from "./pagePreferencesContext";

export default function usePagePreferences() {
  const value = useContext(PagePreferencesContext);
  if (!value) throw new Error("PagePreferencesProvider is missing");
  return value;
}
