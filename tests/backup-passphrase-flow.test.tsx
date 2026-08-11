import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { decryptBackup, encryptBackup } from "../src/main/backup-crypto";
import {
  LocalBackupApi,
  runLocalBackupExport,
  runLocalBackupImport,
  validateBackupPassphrase
} from "../src/renderer/backup-flow";
import { BackupPassphraseDialog } from "../src/renderer/ui/BackupPassphraseDialog";

function createApi(overrides: Partial<LocalBackupApi> = {}): LocalBackupApi {
  return {
    exportBackup: vi.fn(async () => ({ saved: true })),
    selectBackupImport: vi.fn(async () => ({ selected: true, requiresPassphrase: true })),
    importBackup: vi.fn(async () => ({ restored: true, relaunch: false, message: "Einstellungen wiederhergestellt" })),
    cancelBackupImport: vi.fn(async () => undefined),
    ...overrides
  };
}

describe("local backup passphrase flow", () => {
  it("rejects an export confirmation mismatch before IPC", () => {
    expect(validateBackupPassphrase("export", "first test phrase", "second test phrase")).toBe("Die Passphrasen stimmen nicht überein");
  });

  it("cancels export without invoking the backup API", async () => {
    const api = createApi();
    const result = await runLocalBackupExport(api, async () => null);

    expect(result).toEqual({ saved: false });
    expect(api.exportBackup).not.toHaveBeenCalled();
  });

  it("cancels a selected MDD2 import and clears the pending main operation", async () => {
    const api = createApi();
    const result = await runLocalBackupImport(api, async () => null);

    expect(result).toEqual({ restored: false, relaunch: false, message: "Abgebrochen" });
    expect(api.cancelBackupImport).toHaveBeenCalledOnce();
    expect(api.importBackup).not.toHaveBeenCalled();
  });

  it("leaves import untouched when file selection is cancelled", async () => {
    const requestPassphrase = vi.fn(async () => "unused");
    const api = createApi({
      selectBackupImport: vi.fn(async () => ({ selected: false, requiresPassphrase: false, message: "Abgebrochen" }))
    });
    const result = await runLocalBackupImport(api, requestPassphrase);

    expect(result).toEqual({ restored: false, relaunch: false, message: "Abgebrochen" });
    expect(requestPassphrase).not.toHaveBeenCalled();
    expect(api.importBackup).not.toHaveBeenCalled();
    expect(api.cancelBackupImport).not.toHaveBeenCalled();
  });

  it("imports MDD1 without requesting a passphrase", async () => {
    const requestPassphrase = vi.fn(async () => "unused");
    const api = createApi({
      selectBackupImport: vi.fn(async () => ({ selected: true, requiresPassphrase: false }))
    });

    await runLocalBackupImport(api, requestPassphrase);

    expect(requestPassphrase).not.toHaveBeenCalled();
    expect(api.importBackup).toHaveBeenCalledWith(undefined);
  });

  it("completes an export and import round-trip without returning the passphrase", async () => {
    let backup: Buffer | undefined;
    let restored = "";
    const api = createApi({
      exportBackup: vi.fn(async (passphrase) => {
        backup = encryptBackup("round-trip payload", passphrase);
        return { saved: true };
      }),
      selectBackupImport: vi.fn(async () => ({ selected: true, requiresPassphrase: true })),
      importBackup: vi.fn(async (passphrase) => {
        if (!backup) {
          throw new Error("Backup missing");
        }
        restored = decryptBackup(backup, passphrase);
        return { restored: true, relaunch: false, message: "Einstellungen wiederhergestellt" };
      })
    });

    const exported = await runLocalBackupExport(api, async () => "one-operation test phrase");
    const imported = await runLocalBackupImport(api, async () => "one-operation test phrase");

    expect(exported).toEqual({ saved: true });
    expect(imported).toEqual({ restored: true, relaunch: false, message: "Einstellungen wiederhergestellt" });
    expect(restored).toBe("round-trip payload");
    expect(JSON.stringify([exported, imported])).not.toContain("one-operation test phrase");
  });

  it("renders two password fields for export and one for import", () => {
    const exportHtml = renderToStaticMarkup(
      <BackupPassphraseDialog mode="export" onCancel={() => {}} onSubmit={() => {}} />
    );
    const importHtml = renderToStaticMarkup(
      <BackupPassphraseDialog mode="import" onCancel={() => {}} onSubmit={() => {}} />
    );

    expect(exportHtml.match(/type="password"/g)).toHaveLength(2);
    expect(importHtml.match(/type="password"/g)).toHaveLength(1);
    expect(exportHtml).toContain("Passphrase bestätigen");
    expect(importHtml).not.toContain("Passphrase bestätigen");
  });
});
