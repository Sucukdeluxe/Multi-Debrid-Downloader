export interface BackupSelectionResult {
  selected: boolean;
  requiresPassphrase: boolean;
  message?: string;
}

export interface BackupImportResult {
  restored: boolean;
  relaunch: boolean;
  message: string;
}

export interface LocalBackupApi {
  exportBackup: (passphrase: string) => Promise<{ saved: boolean }>;
  selectBackupImport: () => Promise<BackupSelectionResult>;
  importBackup: (passphrase?: string) => Promise<BackupImportResult>;
  cancelBackupImport: () => Promise<void>;
}

export type BackupPassphraseMode = "export" | "import";
export type BackupPassphraseRequest = (mode: BackupPassphraseMode) => Promise<string | null>;

export function validateBackupPassphrase(
  mode: BackupPassphraseMode,
  passphrase: string,
  confirmation: string
): string | null {
  if (passphrase.trim().length === 0) {
    return "Bitte eine Passphrase eingeben";
  }
  if (mode === "export" && passphrase !== confirmation) {
    return "Die Passphrasen stimmen nicht überein";
  }
  return null;
}

export async function runLocalBackupExport(
  api: LocalBackupApi,
  requestPassphrase: BackupPassphraseRequest
): Promise<{ saved: boolean }> {
  const passphrase = await requestPassphrase("export");
  if (passphrase === null) {
    return { saved: false };
  }
  return api.exportBackup(passphrase);
}

export async function runLocalBackupImport(
  api: LocalBackupApi,
  requestPassphrase: BackupPassphraseRequest
): Promise<BackupImportResult> {
  const selection = await api.selectBackupImport();
  if (!selection.selected) {
    return { restored: false, relaunch: false, message: selection.message || "Abgebrochen" };
  }
  let passphrase: string | undefined;
  if (selection.requiresPassphrase) {
    const requested = await requestPassphrase("import");
    if (requested === null) {
      await api.cancelBackupImport();
      return { restored: false, relaunch: false, message: "Abgebrochen" };
    }
    passphrase = requested;
  }
  return api.importBackup(passphrase);
}
