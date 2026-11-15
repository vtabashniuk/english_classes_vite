import { useContext } from "react";
import { DialogContext } from "./dialogContext";

/** Promise<boolean> confirmation. This hook must be called under DialogProvider. */
export default function useConfirmDialog() {
  const context = useContext(DialogContext);
  if (!context) throw new Error("useConfirmDialog requires DialogProvider");
  return context.confirm;
}
