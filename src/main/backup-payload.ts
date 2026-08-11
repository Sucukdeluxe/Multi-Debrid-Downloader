import type { AppSettings, SessionState, HistoryEntry } from "../shared/types";

export type BackupKind = "full" | "settings-only";

export interface BackupRemoteDiagnostics {
  allowlist?: string[];
  port?: number;
  hostMode?: "local" | "network";
}

export interface BackupPayload {
  version: 2;
  kind: BackupKind;
  appVersion: string;
  exportedAt: string;
  settings: AppSettings;
  session?: SessionState;
  history?: HistoryEntry[];
  remoteDiagnostics?: BackupRemoteDiagnostics;
}

export interface BuildBackupInput {
  settings: AppSettings;
  appVersion: string;
  exportedAt: string;
  /** Only bundled when includeDownloads is true. */
  session: SessionState;
  history: HistoryEntry[];
  remoteDiagnostics?: BackupRemoteDiagnostics;
}

/**
 * Build the backup payload. By default ("Download-Liste mitsichern" off) the
 * payload contains ONLY settings — no session, no history. The download list is
 * bundled solely when settings.backupIncludeDownloads is true. An explicit kind
 * marker makes the import side unambiguous and survives hand-edited files.
 */
export function buildBackupPayload(input: BuildBackupInput): BackupPayload {
  const includeDownloads = Boolean(input.settings.backupIncludeDownloads);
  const base: BackupPayload = {
    version: 2,
    kind: includeDownloads ? "full" : "settings-only",
    appVersion: input.appVersion,
    exportedAt: input.exportedAt,
    settings: input.settings
  };
  if (includeDownloads) {
    base.session = input.session;
    base.history = input.history;
  }
  if (Boolean(input.settings.backupIncludeRemoteDiagnostics) && input.remoteDiagnostics) {
    base.remoteDiagnostics = sanitizeBackupRemoteDiagnostics(input.remoteDiagnostics);
  }
  return base;
}

export interface RemoteDiagnosticsRestore {
  host?: "127.0.0.1";
  port?: number;
  allowlist?: string[];
}

function sanitizeAllowlist(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim())
    : [];
}

function sanitizeBackupRemoteDiagnostics(section: BackupRemoteDiagnostics): BackupRemoteDiagnostics {
  return {
    allowlist: sanitizeAllowlist(section.allowlist)
  };
}

export function resolveRemoteDiagnosticsRestore(section: unknown): RemoteDiagnosticsRestore | null {
  if (!section || typeof section !== "object") {
    return null;
  }
  const s = section as { allowlist?: unknown };
  return {
    host: "127.0.0.1",
    allowlist: sanitizeAllowlist(s.allowlist)
  };
}

export interface ImportPlan {
  valid: boolean;
  /** Restore the download list (session + history) and relaunch. */
  restoreDownloads: boolean;
  message: string;
}

/**
 * Decide how to apply an imported backup based on what the FILE physically
 * contains — NOT the local toggle. A backup without a session restores settings
 * only (no queue wipe, no relaunch); a full backup (with session) restores the
 * queue too. This way an old full backup still restores fully even if the local
 * toggle is currently off, and a settings-only backup never disturbs a running
 * queue.
 */
export function planBackupImport(parsed: unknown): ImportPlan {
  if (!parsed || typeof parsed !== "object") {
    return { valid: false, restoreDownloads: false, message: "Kein gültiges Backup (settings fehlen)" };
  }
  const record = parsed as Record<string, unknown>;
  if (!record.settings || typeof record.settings !== "object") {
    return { valid: false, restoreDownloads: false, message: "Kein gültiges Backup (settings fehlen)" };
  }
  const hasSession = Boolean(record.session) && typeof record.session === "object";
  return {
    valid: true,
    restoreDownloads: hasSession,
    message: hasSession
      ? "Backup wiederhergestellt – App startet automatisch neu…"
      : "Einstellungen wiederhergestellt"
  };
}
