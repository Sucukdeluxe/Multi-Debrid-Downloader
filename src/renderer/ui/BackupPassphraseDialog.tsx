import { FormEvent, ReactElement, useState } from "react";
import { BackupPassphraseMode, validateBackupPassphrase } from "../backup-flow";
import { Dialog } from "./Dialog";

export interface BackupPassphraseDialogProps {
  mode: BackupPassphraseMode;
  onCancel: () => void;
  onSubmit: (passphrase: string) => void;
}

export function BackupPassphraseDialog({ mode, onCancel, onSubmit }: BackupPassphraseDialogProps): ReactElement {
  const [passphrase, setPassphrase] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");

  const clear = (): void => {
    setPassphrase("");
    setConfirmation("");
    setError("");
  };

  const cancel = (): void => {
    clear();
    onCancel();
  };

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    const validationError = validateBackupPassphrase(mode, passphrase, confirmation);
    if (validationError) {
      setError(validationError);
      return;
    }
    const submittedPassphrase = passphrase;
    clear();
    onSubmit(submittedPassphrase);
  };

  return (
    <Dialog actions={null} className="backup-passphrase-modal" onClose={cancel} open title={mode === "export" ? "Sicherung schützen" : "Sicherung entsperren"}>
      <p>{mode === "export" ? "Lege eine Passphrase für diese Sicherung fest. Sie wird nicht gespeichert und wird beim Import erneut benötigt." : "Diese Sicherung ist mit einer Passphrase geschützt."}</p>
      <form className="backup-passphrase-form" onSubmit={submit}>
        <div className="backup-passphrase-fields">
          <label>
            Passphrase
            <input
              aria-label="Backup-Passphrase"
              autoComplete="off"
              autoFocus
              onChange={(event) => { setPassphrase(event.target.value); setError(""); }}
              spellCheck={false}
              type="password"
              value={passphrase}
            />
          </label>
          {mode === "export" && (
            <label>
              Passphrase bestätigen
              <input
                aria-label="Backup-Passphrase bestätigen"
                autoComplete="off"
                onChange={(event) => { setConfirmation(event.target.value); setError(""); }}
                spellCheck={false}
                type="password"
                value={confirmation}
              />
            </label>
          )}
        </div>
        {error && <div className="backup-passphrase-error" role="alert">{error}</div>}
        <div className="modal-actions">
          <button className="btn" onClick={cancel} type="button">Abbrechen</button>
          <button className="btn primary" type="submit">{mode === "export" ? "Sicherung exportieren" : "Sicherung importieren"}</button>
        </div>
      </form>
    </Dialog>
  );
}
