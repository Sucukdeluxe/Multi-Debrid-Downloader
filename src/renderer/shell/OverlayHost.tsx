import type { ReactElement, ReactNode } from "react";

export interface OverlayHostProps {
  confirm?: ReactNode;
  backupPassphrase?: ReactNode;
  onlineBackup?: ReactNode;
  diagnostics?: ReactNode;
  deleteConfirmation?: ReactNode;
  conflict?: ReactNode;
  accountCreate?: ReactNode;
  accountEdit?: ReactNode;
  keyStats?: ReactNode;
  linkPopup?: ReactNode;
  update?: ReactNode;
  toast?: ReactNode;
  accountContextMenu?: ReactNode;
  downloadContextMenu?: ReactNode;
  columnContextMenu?: ReactNode;
  historyContextMenu?: ReactNode;
  dropOverlay?: ReactNode;
}

export function OverlayHost({
  confirm,
  backupPassphrase,
  onlineBackup,
  diagnostics,
  deleteConfirmation,
  conflict,
  accountCreate,
  accountEdit,
  keyStats,
  linkPopup,
  update,
  toast,
  accountContextMenu,
  downloadContextMenu,
  columnContextMenu,
  historyContextMenu,
  dropOverlay
}: OverlayHostProps): ReactElement {
  return (
    <div className="md-overlay-host" id="md-overlay-host">
      {confirm}
      {backupPassphrase}
      {onlineBackup}
      {diagnostics}
      {deleteConfirmation}
      {conflict}
      {accountCreate}
      {accountEdit}
      {keyStats}
      {linkPopup}
      {update}
      {toast}
      {accountContextMenu}
      {downloadContextMenu}
      {columnContextMenu}
      {historyContextMenu}
      {dropOverlay}
    </div>
  );
}
