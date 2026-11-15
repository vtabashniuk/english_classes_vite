import ConfirmDialog from "../dialog/ConfirmDialog";

/** Specialized confirmation; uses the same accessible frame as other dialogs. */
export default function UnsavedChangesDialog({ open, onStay, onLeave, title, description, stayLabel, leaveLabel }) {
  return (
    <ConfirmDialog
      open={open}
      title={title}
      description={description}
      cancelLabel={stayLabel}
      confirmLabel={leaveLabel}
      onCancel={onStay}
      onConfirm={onLeave}
      variant="danger"
    />
  );
}
