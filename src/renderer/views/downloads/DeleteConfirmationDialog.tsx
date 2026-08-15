import type { ReactElement } from "react";
import { Dialog } from "../../ui/Dialog";

interface DeleteConfirmationDialogProps {
  dontAsk: boolean;
  parts: string[];
  totalRemaining: number;
  onCancel: () => void;
  onConfirm: () => void;
  onDontAskChange: (checked: boolean) => void;
}

export function DeleteConfirmationDialog({
  dontAsk,
  parts,
  totalRemaining,
  onCancel,
  onConfirm,
  onDontAskChange
}: DeleteConfirmationDialogProps): ReactElement {
  return (
    <Dialog actions={null} danger onClose={onCancel} open title="Bist Du Dir sicher?">
      <p>Möchtest Du wirklich diese Aufräumaktion(en) durchführen?<br />Ausgewählte Links löschen</p>
      <p><strong>Zu erledigende Aufgaben:</strong><br />{parts.join(" + ")} löschen ? {totalRemaining} Link(s) verbleiben!</p>
      <div className="delete-confirm-footer">
        <div className="modal-actions">
          <button className="btn" onClick={onCancel}>Abbrechen</button>
          <button className="btn danger" onClick={onConfirm}>Fortfahren</button>
        </div>
        <label className="toggle-line delete-confirm-dont-ask">
          <input type="checkbox" checked={dontAsk} onChange={(event) => onDontAskChange(event.target.checked)} />
          Nicht mehr anzeigen
        </label>
      </div>
    </Dialog>
  );
}
