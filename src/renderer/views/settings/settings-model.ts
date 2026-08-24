import type { RendererSettings } from "../../../shared/types";
import type { AccountService } from "../../account-edit";
import { ACCOUNT_SERVICE_ICONS } from "../../account-service-icons";

export type SettingsSection = "allgemein" | "accounts" | "extract" | "speed" | "cleanup" | "updates";
export type SettingsSaveState = "clean" | "dirty" | "saving" | "saved" | "error";

export const SETTINGS_SECTIONS: readonly { id: SettingsSection; label: string }[] = [
  { id: "allgemein", label: "Allgemein" },
  { id: "accounts", label: "Accounts" },
  { id: "extract", label: "Entpacken" },
  { id: "speed", label: "Geschwindigkeit" },
  { id: "cleanup", label: "Bereinigung" },
  { id: "updates", label: "Updates" }
];

export const ACCOUNT_COLUMNS = [
  "Hoster",
  "Status",
  "Download-Traffic übrig",
  "Benutzername",
  "E-Mail",
  "Verfallsdatum",
  "Passwort/Zugang"
] as const;

export const ACCOUNT_TABLE_COLUMN_IDS = [
  "hoster",
  "status",
  "traffic",
  "username",
  "email",
  "expires",
  "credential"
] as const;

export type AccountTableColumnId = typeof ACCOUNT_TABLE_COLUMN_IDS[number];
export type AccountTableColumnWidths = Record<AccountTableColumnId, number>;

const ACCOUNT_TABLE_COLUMN_LIMITS: Record<AccountTableColumnId, { initial: number; min: number; max: number }> = {
  hoster: { initial: 210, min: 140, max: 520 },
  status: { initial: 250, min: 120, max: 520 },
  traffic: { initial: 210, min: 150, max: 420 },
  username: { initial: 170, min: 120, max: 420 },
  email: { initial: 200, min: 140, max: 480 },
  expires: { initial: 150, min: 120, max: 280 },
  credential: { initial: 170, min: 130, max: 320 }
};

export function createAccountTableColumnWidths(value?: unknown): AccountTableColumnWidths {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return Object.fromEntries(ACCOUNT_TABLE_COLUMN_IDS.map((id) => {
    const limits = ACCOUNT_TABLE_COLUMN_LIMITS[id];
    const candidate = typeof raw[id] === "number" && Number.isFinite(raw[id]) ? Math.round(raw[id]) : limits.initial;
    return [id, Math.max(limits.min, Math.min(limits.max, candidate))];
  })) as AccountTableColumnWidths;
}

export function resizeAccountTableColumn(
  widths: AccountTableColumnWidths,
  column: AccountTableColumnId,
  delta: number
): AccountTableColumnWidths {
  return createAccountTableColumnWidths({ ...widths, [column]: widths[column] + delta });
}

export function getAccountTableGridTemplate(widths: AccountTableColumnWidths): string {
  return `42px ${ACCOUNT_TABLE_COLUMN_IDS.map((id) => `${widths[id]}px`).join(" ")} minmax(64px, 1fr)`;
}

export function getAccountTableMinWidth(widths: AccountTableColumnWidths): number {
  return 42 + 64 + ACCOUNT_TABLE_COLUMN_IDS.reduce((sum, id) => sum + widths[id], 0);
}

export function formatAccountContextHeading(hoster: string, mode: string): string {
  return `${hoster} | ${mode}`;
}

export function getSettingsSaveLabel(state: SettingsSaveState): string {
  switch (state) {
    case "dirty":
      return "Ungespeicherte Änderungen";
    case "saving":
      return "Wird gespeichert…";
    case "error":
      return "Speichern fehlgeschlagen";
    case "clean":
    case "saved":
      return "Gespeichert";
  }
}

export function getSettingsSelectNavigationIndex(currentIndex: number, optionCount: number, key: string): number {
  if (optionCount <= 0) return -1;
  const current = Math.max(0, Math.min(optionCount - 1, currentIndex));
  if (key === "Home") return 0;
  if (key === "End") return optionCount - 1;
  if (key === "ArrowDown") return (current + 1) % optionCount;
  if (key === "ArrowUp") return (current - 1 + optionCount) % optionCount;
  return current;
}

export function resolveHistoryRetentionSelection(
  currentMode: RendererSettings["historyRetentionMode"],
  currentMaxEntries: number,
  value: string
): Pick<RendererSettings, "historyRetentionMode" | "historyMaxEntries"> {
  const preset = /^permanent-(100|250)$/.exec(value);
  if (preset) {
    return {
      historyRetentionMode: "permanent",
      historyMaxEntries: Number(preset[1])
    };
  }
  if (value === "permanent") {
    return {
      historyRetentionMode: "permanent",
      historyMaxEntries: currentMode === "permanent" && (currentMaxEntries === 100 || currentMaxEntries === 250)
        ? 500
        : currentMaxEntries
    };
  }
  return {
    historyRetentionMode: value as RendererSettings["historyRetentionMode"],
    historyMaxEntries: currentMaxEntries
  };
}

export type AccountStatusSourceState = "premium" | "free" | "invalid" | "checking" | "unchecked" | "disabled";
export type AccountStatusTone = "ok" | "free" | "invalid" | "unknown" | "disabled";

export interface AccountRowSource {
  identityId: string;
  service: AccountService;
  hoster: string;
  mode: string;
  icon?: string;
  enabled: boolean;
  status: {
    state: AccountStatusSourceState;
    message: string;
    premiumUntilMs: number | null;
    checkedAt?: number;
    username?: string;
    email?: string;
  };
  dailyLimitBytes?: number;
  dailyUsageBytes?: number;
  totalUsageBytes?: number;
  username: string;
  credentialKind: "password" | "api-key" | "protected";
  canCheck: boolean;
}

export interface AccountRowViewModel {
  id: string;
  service: AccountService;
  hoster: string;
  mode: string;
  icon: string;
  enabled: boolean;
  selected: boolean;
  status: {
    tone: AccountStatusTone;
    text: string;
    checkedAgo: string;
  };
  traffic: string;
  username: string;
  email: string;
  expires: string;
  credential: string;
  canCheck: boolean;
  problem: boolean;
  premiumUntilMs: number | null;
}

export type AccountAddFilter = "all" | "api" | "web";

export interface AccountAddOption {
  id: string;
  service: AccountService;
  title: string;
  mode: string;
  description: string;
  functionLabel: string;
  filter: Exclude<AccountAddFilter, "all">;
  multi: boolean;
  icon?: string;
}

export interface AccountAddDraft {
  selectedId: string | null;
  login: string;
  password: string;
  token: string;
  dailyLimitGb: string;
}

export interface TargetedAccountCheck {
  service: "megadebrid-api" | "debridlink";
  expectedStatusId: string;
}

export interface SettingsFieldBase {
  id: string;
  label: string;
  help?: string;
  disabled?: boolean;
}

export interface SettingsTextFieldViewModel extends SettingsFieldBase {
  kind: "text" | "path" | "number" | "textarea";
  value: string;
  placeholder?: string;
  inputMode?: "decimal" | "numeric" | "text" | "url";
  min?: number;
  max?: number;
  step?: number;
  actionLabel?: string;
  commitOnBlur?: boolean;
}

export interface SettingsSelectFieldViewModel extends SettingsFieldBase {
  kind: "select";
  value: string;
  options: readonly { value: string; label: string }[];
}

export interface SettingsSwitchFieldViewModel extends SettingsFieldBase {
  kind: "switch";
  value: boolean;
}

export interface SettingsThemeFieldViewModel extends SettingsFieldBase {
  kind: "theme";
  value: string;
  options: readonly { value: string; label: string }[];
}

export interface SettingsActionFieldViewModel extends SettingsFieldBase {
  kind: "action";
  actionLabel: string;
}

export type SettingsFieldViewModel =
  | SettingsTextFieldViewModel
  | SettingsSelectFieldViewModel
  | SettingsSwitchFieldViewModel
  | SettingsThemeFieldViewModel
  | SettingsActionFieldViewModel;

export interface SettingsFormGroupViewModel {
  id: string;
  title: string;
  description?: string;
  fields: readonly SettingsFieldViewModel[];
}

export interface SettingsFormViewModel {
  title: string;
  description: string;
  groups: readonly SettingsFormGroupViewModel[];
}

export interface SettingsFormProjectionInput {
  settings: RendererSettings & { archivePasswordList: string; notifyUrl: string };
  section: SettingsSection;
  speedLimitInput: string;
  scheduleSpeedInputs: Readonly<Record<string, string>>;
  themeChoice?: "light" | "dark" | "system";
}

const NOTIFICATION_NUMBER_LIMITS = {
  notifyRemainingThresholdGb: { min: 1, max: 100000, fallback: 50 },
  notifyStallAfterSeconds: { min: 60, max: 3600, fallback: 90 },
  notifyStallCooldownMinutes: { min: 5, max: 1440, fallback: 10 }
} as const;

export function normalizeNotificationNumberField(fieldId: string, value: unknown): number | undefined {
  const limits = NOTIFICATION_NUMBER_LIMITS[fieldId as keyof typeof NOTIFICATION_NUMBER_LIMITS];
  if (!limits) {
    return undefined;
  }
  const parsed = Number(value);
  const normalized = Number.isFinite(parsed) ? Math.floor(parsed) : limits.fallback;
  return Math.max(limits.min, Math.min(limits.max, normalized));
}

export function buildSettingsFormViewModel({
  settings,
  section,
  speedLimitInput,
  scheduleSpeedInputs,
  themeChoice = settings.theme
}: SettingsFormProjectionInput): SettingsFormViewModel {
  if (section === "extract") {
    return {
      title: "Entpacken",
      description: "Ablauf, Ziel, Tonspur, Ablageform und Leistung.",
      groups: [
        {
          id: "extract-target",
          title: "Ziel und Ablauf",
          fields: [
            { id: "extractDir", kind: "path", label: "Entpacken nach", value: settings.extractDir, actionLabel: "Wählen", help: "Zielordner für entpackte Dateien." },
            { id: "autoExtract", kind: "switch", label: "Automatisch entpacken", value: settings.autoExtract },
            { id: "autoSkipExtracted", kind: "switch", label: "Bereits Entpacktes überspringen", value: settings.autoSkipExtracted },
            { id: "hideExtractedItems", kind: "switch", label: "Entpackte Einträge ausblenden", value: settings.hideExtractedItems },
            { id: "autoExtractWhenStopped", kind: "switch", label: "Entpacken auch ohne laufende Sitzung", value: settings.autoExtractWhenStopped }
          ]
        },
        {
          id: "extract-audio",
          title: "Deutsche Tonspur",
          fields: [
            { id: "keepGermanAudioOnly", kind: "switch", label: "Nur deutsche Tonspur behalten", value: settings.keepGermanAudioOnly, help: "Benötigt ffmpeg." },
            {
              id: "germanAudioMode",
              kind: "select",
              label: "Welche Tonspur behalten",
              value: settings.germanAudioMode,
              disabled: !settings.keepGermanAudioOnly,
              options: [
                { value: "tag", label: "Deutsche Spur per Sprach-Tag" },
                { value: "first", label: "Immer erste Tonspur" }
              ]
            }
          ]
        },
        {
          id: "extract-layout",
          title: "Ablageform",
          fields: [
            { id: "autoRename4sf4sj", kind: "switch", label: "Automatisch umbenennen", value: settings.autoRename4sf4sj },
            { id: "createExtractSubfolder", kind: "switch", label: "In Paket-Unterordner ablegen", value: settings.createExtractSubfolder },
            { id: "collectMkvToLibrary", kind: "switch", label: "Videos in Sammelordner verschieben", value: settings.collectMkvToLibrary },
            { id: "mkvLibraryDir", kind: "path", label: "Video-Sammelordner", value: settings.mkvLibraryDir, disabled: !settings.collectMkvToLibrary, actionLabel: "Wählen" }
          ]
        },
        {
          id: "extract-performance",
          title: "Leistung",
          fields: [
            { id: "hybridExtract", kind: "switch", label: "Hybrid-Entpacken", value: settings.hybridExtract },
            { id: "maxParallelExtract", kind: "number", label: "Gleichzeitige Entpackungen", value: String(settings.maxParallelExtract), min: 1, max: 8 },
            {
              id: "extractCpuPriority",
              kind: "select",
              label: "CPU-Priorität beim Entpacken",
              value: settings.extractCpuPriority,
              options: [
                { value: "high", label: "Hoch (80% CPU)" },
                { value: "middle", label: "Mittel (50% CPU)" },
                { value: "low", label: "Niedrig (25% CPU)" }
              ]
            }
          ]
        },
        {
          id: "extract-passwords",
          title: "Passwörter",
          fields: [
            { id: "archivePasswordList", kind: "textarea", label: "Passwortliste für Archive", value: settings.archivePasswordList, placeholder: settings.archivePasswordListConfigured ? "Gespeichert; leer lassen zum Beibehalten" : "Ein Passwort pro Zeile" }
          ]
        }
      ]
    };
  }
  if (section === "speed") {
    const scheduleGroups: SettingsFormGroupViewModel[] = (settings.bandwidthSchedules || []).map((schedule, index) => {
      const scheduleKey = schedule.id || `schedule-${index}`;
      return {
        id: `schedule:${index}`,
        title: `Zeitregel ${index + 1}`,
        fields: [
          { id: `schedule:${index}:startHour`, kind: "number", label: "Von (Stunde)", value: String(schedule.startHour), min: 0, max: 23 },
          { id: `schedule:${index}:endHour`, kind: "number", label: "Bis (Stunde)", value: String(schedule.endHour), min: 0, max: 23 },
          {
            id: `schedule:${index}:speedLimitMbps`,
            kind: "number",
            label: "Limit (MB/s)",
            value: scheduleSpeedInputs[scheduleKey] ?? String(schedule.speedLimitKbps / 1024),
            min: 0,
            step: 0.1,
            commitOnBlur: true
          },
          { id: `schedule:${index}:enabled`, kind: "switch", label: "Zeitregel aktiviert", value: schedule.enabled },
          { id: `schedule:${index}:remove`, kind: "action", label: "Zeitregel entfernen", actionLabel: "Entfernen" }
        ]
      };
    });
    return {
      title: "Geschwindigkeit",
      description: "Tempo, Wiederverbindung und zeitgesteuerte Bandbreitenregeln.",
      groups: [
        {
          id: "speed-limit",
          title: "Tempo-Begrenzung",
          fields: [
            { id: "speedLimitEnabled", kind: "switch", label: "Geschwindigkeit begrenzen", value: settings.speedLimitEnabled },
            { id: "speedLimitInput", kind: "number", label: "Höchstgeschwindigkeit (MB/s)", value: speedLimitInput, min: 0, step: 0.1, disabled: !settings.speedLimitEnabled, commitOnBlur: true },
            {
              id: "speedLimitMode",
              kind: "select",
              label: "Limit gilt für",
              value: settings.speedLimitMode,
              disabled: !settings.speedLimitEnabled,
              options: [
                { value: "global", label: "Global" },
                { value: "per_download", label: "Pro Download" }
              ]
            }
          ]
        },
        {
          id: "speed-connection",
          title: "Verbindung",
          fields: [
            { id: "autoReconnect", kind: "switch", label: "Automatisch neu verbinden", value: settings.autoReconnect },
            { id: "reconnectWaitSeconds", kind: "number", label: "Wartezeit vor neuem Versuch (Sek.)", value: String(settings.reconnectWaitSeconds), min: 10, max: 600 }
          ]
        },
        ...scheduleGroups,
        {
          id: "speed-schedule-add",
          title: "Bandbreitenplanung",
          description: "Jede Regel legt für ein Zeitfenster ein eigenes Limit fest.",
          fields: [{ id: "schedule:add", kind: "action", label: "Weitere Zeitregel", actionLabel: "Zeitregel hinzufügen" }]
        }
      ]
    };
  }
  if (section === "cleanup") {
    return {
      title: "Bereinigung",
      description: "Integritätsprüfung und Aufräumen nach Downloads und Entpacken.",
      groups: [
        {
          id: "cleanup-check",
          title: "Prüfung",
          fields: [{ id: "enableIntegrityCheck", kind: "switch", label: "Dateien auf Fehler prüfen", value: settings.enableIntegrityCheck }]
        },
        {
          id: "cleanup-extract",
          title: "Nach dem Entpacken",
          fields: [
            { id: "removeLinkFilesAfterExtract", kind: "switch", label: "Link-Dateien danach entfernen", value: settings.removeLinkFilesAfterExtract },
            { id: "removeSamplesAfterExtract", kind: "switch", label: "Vorschau-Dateien danach entfernen", value: settings.removeSamplesAfterExtract },
            {
              id: "cleanupMode",
              kind: "select",
              label: "Archive nach dem Entpacken",
              value: settings.cleanupMode,
              options: [
                { value: "none", label: "Keine Archive löschen" },
                { value: "trash", label: "Archive in Papierkorb" },
                { value: "delete", label: "Archive löschen" }
              ]
            }
          ]
        },
        {
          id: "cleanup-finished",
          title: "Fertige Downloads und Konflikte",
          fields: [
            {
              id: "completedCleanupPolicy",
              kind: "select",
              label: "Fertige Downloads aus der Liste",
              value: settings.completedCleanupPolicy,
              options: [
                { value: "never", label: "Nie" },
                { value: "immediate", label: "Sofort" },
                { value: "on_start", label: "Beim App-Start" },
                { value: "package_done", label: "Sobald Paket fertig ist" }
              ]
            },
            {
              id: "extractConflictMode",
              kind: "select",
              label: "Bei gleichnamigen Dateien",
              value: settings.extractConflictMode,
              options: [
                { value: "overwrite", label: "Überschreiben" },
                { value: "skip", label: "Überspringen" },
                { value: "rename", label: "Umbenennen" },
                { value: "ask", label: "Nachfragen" }
              ]
            }
          ]
        }
      ]
    };
  }
  if (section === "updates") {
    return {
      title: "Updates",
      description: "Quelle und Zeitpunkt der Update-Prüfung.",
      groups: [
        {
          id: "updates-main",
          title: "Aktualisierung",
          fields: [
            { id: "autoUpdateCheck", kind: "switch", label: "Beim Start nach Updates suchen", value: settings.autoUpdateCheck },
            { id: "updateRepo", kind: "text", label: "Update-Quelle", value: settings.updateRepo, help: "Quelle im Format Benutzer/Repository." },
            { id: "update:check", kind: "action", label: "Jetzt nach einer neuen Version suchen", actionLabel: "Nach Updates suchen" }
          ]
        }
      ]
    };
  }
  if (section === "accounts") {
    return { title: "Accounts", description: "Accounts und Verwendungsregeln.", groups: [] };
  }
  return {
    title: "Allgemein",
    description: "Speicherort, Download-Verhalten, Verlauf, Oberfläche und Benachrichtigungen.",
    groups: [
      {
        id: "general-language",
        title: "Sprache",
        fields: [
          {
            id: "language",
            kind: "select",
            label: "Sprache",
            value: settings.language,
            options: [
              { value: "en", label: "English" },
              { value: "de", label: "Deutsch" }
            ]
          }
        ]
      },
      {
        id: "general-storage",
        title: "Speicherort",
        fields: [
          { id: "outputDir", kind: "path", label: "Download-Ordner", value: settings.outputDir, actionLabel: "Wählen", help: "Zielordner für heruntergeladene Dateien." },
          { id: "packageName", kind: "text", label: "Paketname (optional)", value: settings.packageName },
          {
            id: "logStorageLocation",
            kind: "select",
            label: "Log-Speicherort",
            value: settings.logStorageLocation,
            options: [
              { value: "appdata", label: "AppData (empfohlen)" },
              { value: "desktop", label: "Desktop / Downloader Log" }
            ],
            help: "Beim Wechsel werden vorhandene Log-Dateien übernommen. Zugangsdaten und App-Konfiguration bleiben in AppData."
          },
          { id: "logStorageDirectory", kind: "action", label: "Log-Ordner", actionLabel: "Ordner öffnen" }
        ]
      },
      {
        id: "general-downloads",
        title: "Download-Verhalten",
        fields: [
          { id: "maxParallel", kind: "number", label: "Max. gleichzeitige Downloads", value: String(settings.maxParallel), min: 1, max: 50 },
          { id: "retryLimit", kind: "number", label: "Automatische Wiederholungen", value: String(settings.retryLimit), min: 0, max: 99 },
          { id: "autoResumeOnStart", kind: "switch", label: "Beim Start automatisch fortsetzen", value: settings.autoResumeOnStart },
          { id: "clipboardWatch", kind: "switch", label: "Zwischenablage überwachen", value: settings.clipboardWatch }
        ]
      },
      {
        id: "general-history",
        title: "Verlauf",
        fields: [
          {
            id: "historyRetentionMode",
            kind: "select",
            label: "Verlauf speichern",
            value: settings.historyRetentionMode === "permanent" && (settings.historyMaxEntries === 100 || settings.historyMaxEntries === 250)
              ? `permanent-${settings.historyMaxEntries}`
              : settings.historyRetentionMode,
            options: [
              { value: "never", label: "Nie" },
              { value: "session", label: "Nur aktuelle Session" },
              { value: "permanent-100", label: "Nur letzte 100 Einträge" },
              { value: "permanent-250", label: "Nur letzte 250 Einträge" },
              { value: "permanent", label: "Dauerhaft" }
            ]
          },
          { id: "historyMaxEntries", kind: "number", label: "Maximale Verlauf-Einträge", value: String(settings.historyMaxEntries), min: 50, max: 100000, disabled: settings.historyRetentionMode !== "permanent" },
          { id: "historyMaxAgeDays", kind: "number", label: "Einträge löschen älter als (Tage)", value: String(settings.historyMaxAgeDays), min: 0, max: 3650, disabled: settings.historyRetentionMode !== "permanent" }
        ]
      },
      {
        id: "general-interface",
        title: "Oberfläche und Bedienung",
        fields: [
          { id: "collapseNewPackages", kind: "switch", label: "Neue Pakete eingeklappt zeigen", value: settings.collapseNewPackages },
          { id: "animatePackageDisclosure", kind: "switch", label: "Animationen", value: settings.animatePackageDisclosure },
          { id: "minimizeToTray", kind: "switch", label: "In den Infobereich minimieren", value: settings.minimizeToTray },
          { id: "confirmDeleteSelection", kind: "switch", label: "Vor dem Löschen nachfragen", value: settings.confirmDeleteSelection },
          { id: "backupIncludeDownloads", kind: "switch", label: "Download-Liste mitsichern", value: settings.backupIncludeDownloads },
          { id: "backupIncludeRemoteDiagnostics", kind: "switch", label: "Ferndiagnose-Einstellungen mitsichern", value: settings.backupIncludeRemoteDiagnostics },
          {
            id: "theme",
            kind: "theme",
            label: "Theme",
            value: themeChoice,
            options: [
              { value: "light", label: "Light" },
              { value: "dark", label: "Dark" },
              { value: "system", label: "System" }
            ]
          }
        ]
      },
      {
        id: "general-notifications",
        title: "Discord-Benachrichtigungen",
        fields: [
          { id: "notifyUrl", kind: "text", label: "Webhook-Adresse", value: settings.notifyUrl, placeholder: settings.notifyUrlConfigured ? "Gespeichert; leer lassen zum Beibehalten" : "https://discord.com/api/webhooks/…", actionLabel: "Testen" },
          { id: "notifyMention", kind: "text", label: "Discord-Erwähnung (optional)", value: settings.notifyMention },
          { id: "notifyOnPackageCompleted", kind: "switch", label: "Melden, wenn ein Paket fertig ist", value: settings.notifyOnPackageCompleted },
          { id: "notifyOnPackageFailed", kind: "switch", label: "Melden, wenn ein Paket fehlschlägt", value: settings.notifyOnPackageFailed },
          {
            id: "notifyPackageSuccessMode",
            kind: "select",
            label: "Erfolgsmeldungen senden",
            value: settings.notifyPackageSuccessMode,
            disabled: !settings.notifyOnPackageCompleted,
            options: [
              { value: "digest", label: "Gesammelt (alle 2 Minuten)" },
              { value: "individual", label: "Jedes Paket einzeln" }
            ]
          },
          { id: "notifyOnRunFinished", kind: "switch", label: "Melden, wenn der gesamte Lauf fertig ist", value: settings.notifyOnRunFinished },
          { id: "notifyOnRemainingBelow", kind: "switch", label: "Melden, wenn die Restmenge unterschritten wird", value: settings.notifyOnRemainingBelow },
          { id: "notifyRemainingThresholdGb", kind: "number", label: "Restmengenschwelle (GB)", value: String(settings.notifyRemainingThresholdGb), min: 1, max: 100000, disabled: !settings.notifyOnRemainingBelow },
          { id: "notifyOnDownloadStall", kind: "switch", label: "Melden, wenn Downloads stillstehen", value: settings.notifyOnDownloadStall },
          { id: "notifyStallAfterSeconds", kind: "number", label: "Stillstand bestätigen nach (Sek.)", value: String(settings.notifyStallAfterSeconds), min: 60, max: 3600, disabled: !settings.notifyOnDownloadStall },
          { id: "notifyStallCooldownMinutes", kind: "number", label: "Frühestens erneut melden nach (Min.)", value: String(settings.notifyStallCooldownMinutes), min: 5, max: 1440, disabled: !settings.notifyOnDownloadStall },
          { id: "notifyOnDownloadRecovery", kind: "switch", label: "Melden, wenn Downloads wieder laufen", value: settings.notifyOnDownloadRecovery, disabled: !settings.notifyOnDownloadStall }
        ]
      }
    ]
  };
}

export function buildAccountRowId(service: AccountService, mode: string, identityId: string): string {
  return [service, mode, identityId].map((part) => encodeURIComponent(part)).join("::");
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** unitIndex);
  return `${new Intl.NumberFormat("de-DE", { maximumFractionDigits: value >= 100 ? 0 : value >= 10 ? 1 : 2 }).format(value)} ${units[unitIndex]}`;
}

function formatTraffic(limitBytes?: number, usageBytes?: number, totalUsageBytes?: number): string {
  const total = Number.isFinite(totalUsageBytes) && totalUsageBytes && totalUsageBytes > 0
    ? ` · Gesamt ${formatBytes(totalUsageBytes)}`
    : "";
  if (!Number.isFinite(limitBytes) || !limitBytes || limitBytes <= 0) {
    return `Unbeschränkt${total}`;
  }
  const safeUsage = Number.isFinite(usageBytes) && usageBytes && usageBytes > 0 ? usageBytes : 0;
  return `${formatBytes(Math.max(0, limitBytes - safeUsage))} von ${formatBytes(limitBytes)} übrig${total}`;
}

function formatExpiry(premiumUntilMs: number | null): string {
  if (!premiumUntilMs || !Number.isFinite(premiumUntilMs) || premiumUntilMs <= 0) {
    return "—";
  }
  return new Intl.DateTimeFormat("de-DE").format(new Date(premiumUntilMs));
}

function formatCheckedAgo(checkedAt: number | undefined, nowMs: number): string {
  if (!checkedAt || !Number.isFinite(checkedAt) || checkedAt <= 0) {
    return "";
  }
  const deltaMs = Math.max(0, nowMs - checkedAt);
  const minutes = Math.floor(deltaMs / 60_000);
  if (minutes < 1) {
    return "gerade eben";
  }
  if (minutes < 60) {
    return `vor ${minutes} Min`;
  }
  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    return `vor ${hours} Std`;
  }
  const days = Math.floor(hours / 24);
  return `vor ${days} Tag${days === 1 ? "" : "en"}`;
}

function projectStatus(source: AccountRowSource): { tone: AccountStatusTone; text: string } {
  if (!source.enabled || source.status.state === "disabled") {
    return { tone: "disabled", text: "Deaktiviert" };
  }
  switch (source.status.state) {
    case "premium":
      return { tone: "ok", text: source.status.message.trim() || "Premium Account" };
    case "free":
      return { tone: "free", text: "Free Account" };
    case "invalid":
      return { tone: "invalid", text: source.status.message.trim() || "Zugang ungültig" };
    case "checking":
      return { tone: "unknown", text: "Prüft…" };
    case "unchecked":
      return { tone: "unknown", text: "Noch nicht geprüft" };
  }
}

function projectCredential(kind: AccountRowSource["credentialKind"]): string {
  if (kind === "api-key") {
    return "API-Key";
  }
  return kind === "password" ? "••••••" : "Geschützter Zugang";
}

function projectAccountIdentity(username: string, checkedUsername?: string, checkedEmail?: string): { username: string; email: string } {
  const verifiedUsername = checkedUsername?.trim() || "";
  const stored = verifiedUsername || username.trim();
  const verifiedEmail = checkedEmail?.trim() || "";
  const storedIsEmail = stored.includes("@");
  return {
    username: stored && !storedIsEmail ? stored : "—",
    email: verifiedEmail || (storedIsEmail ? stored : "—")
  };
}

export function projectAccountRows(
  sources: readonly AccountRowSource[],
  selectedIds: readonly string[],
  nowMs: number = Date.now()
): AccountRowViewModel[] {
  const selected = new Set(selectedIds);
  return sources.map((source) => {
    const id = buildAccountRowId(source.service, source.mode, source.identityId);
    const status = projectStatus(source);
    const premiumUntilMs = source.status.premiumUntilMs && source.status.premiumUntilMs > nowMs
      ? source.status.premiumUntilMs
      : null;
    const identity = projectAccountIdentity(source.username, source.status.username, source.status.email);
    return {
      id,
      service: source.service,
      hoster: source.hoster,
      mode: source.mode,
      icon: ACCOUNT_SERVICE_ICONS[source.service],
      enabled: source.enabled,
      selected: selected.has(id),
      status: { ...status, checkedAgo: formatCheckedAgo(source.status.checkedAt, nowMs) },
      traffic: formatTraffic(source.dailyLimitBytes, source.dailyUsageBytes, source.totalUsageBytes),
      username: identity.username,
      email: identity.email,
      expires: formatExpiry(source.status.premiumUntilMs),
      credential: projectCredential(source.credentialKind),
      canCheck: source.canCheck,
      problem: status.tone === "invalid",
      premiumUntilMs
    };
  });
}

export function sortAccountRows(
  rows: readonly AccountRowViewModel[],
  direction: "desc" | "asc" = "desc"
): AccountRowViewModel[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((left, right) => {
      const leftUntil = left.row.premiumUntilMs ?? -1;
      const rightUntil = right.row.premiumUntilMs ?? -1;
      if (leftUntil > 0 && rightUntil > 0) {
        return (direction === "desc" ? rightUntil - leftUntil : leftUntil - rightUntil) || left.index - right.index;
      }
      if (leftUntil > 0) {
        return -1;
      }
      if (rightUntil > 0) {
        return 1;
      }
      return left.index - right.index;
    })
    .map(({ row }) => row);
}

export function pruneAccountSelection(
  selectedIds: readonly string[],
  rows: readonly Pick<AccountRowViewModel, "id">[]
): string[] {
  const existing = new Set(rows.map((row) => row.id));
  return [...new Set(selectedIds)].filter((id) => existing.has(id));
}

export function filterAccountAddOptions(
  options: readonly AccountAddOption[],
  query: string,
  filter: AccountAddFilter,
  configuredServices: readonly string[]
): AccountAddOption[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("de-DE");
  const configured = new Set(configuredServices);
  return options.filter((option) => {
    if (!option.multi && configured.has(option.service)) {
      return false;
    }
    if (filter !== "all" && option.filter !== filter) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return [option.title, option.service, option.mode, option.description, option.functionLabel]
      .join(" ")
      .toLocaleLowerCase("de-DE")
      .includes(normalizedQuery);
  });
}

export function reconcileAccountAddDraft(
  draft: AccountAddDraft,
  visibleOptions: readonly Pick<AccountAddOption, "id">[]
): AccountAddDraft {
  if (draft.selectedId && visibleOptions.some((option) => option.id === draft.selectedId)) {
    return draft;
  }
  return {
    selectedId: null,
    login: "",
    password: "",
    token: "",
    dailyLimitGb: ""
  };
}

export function buildTargetedAccountCheck(
  option: Pick<AccountAddOption, "service">,
  identityId: string
): TargetedAccountCheck | null {
  if (option.service !== "megadebrid-api" && option.service !== "debridlink") {
    return null;
  }
  return { service: option.service, expectedStatusId: identityId };
}
