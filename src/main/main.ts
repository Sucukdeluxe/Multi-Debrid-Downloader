import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { app, BrowserWindow, clipboard, dialog, ipcMain, Menu, powerMonitor, safeStorage, shell, Tray, type IpcMainEvent, type IpcMainInvokeEvent } from "electron";
import { AddLinksPayload, AppSettings, DebridProvider, EnableRemoteDiagnosticsInput, RendererSettingsUpdate, UpdateInstallProgress } from "../shared/types";
import { AppController } from "./app-controller";
import { IPC_CHANNELS } from "../shared/ipc";
import { getLogFilePath, logger } from "./logger";
import { getRecentErrors } from "./error-ring";
import { sendNotification } from "./notify";
import { APP_NAME } from "./constants";
import { extractHttpLinksFromText } from "./utils";
import { cleanupStaleSubstDrives, shutdownDaemon } from "./extractor";
import { revealHistoryEntry } from "./history-reveal";
import { DEV_SERVER_URL } from "./dev-server-url";
import { resolveAppIconPath } from "./app-icon";
import { configureCredentialProtector } from "./credential-protection";
import { isMdd2Backup } from "./backup-crypto";
import { validateAccountCommand, validateAccountCredentialCheckInput, validateAccountSecretRequest } from "./account-commands";
import { createRendererSettings } from "./renderer-state";
import { validateRendererSettingsUpdate } from "./renderer-settings";
import { applyMainWindowSecurity, createMainWindowWebPreferences, MAIN_WINDOW_EXTERNAL_HOSTS, openAllowedExternalUrl } from "./browser-security";
import { assertTrustedIpcSender, type TrustedIpcOptions } from "./ipc-security";
import { validateRealDebridLoginRequest } from "../shared/preload-api";
import { migrateProductUserDataDirectory } from "./storage";
import { validateCollectorContainerInspectionRequest, validateCollectorInspectionRequest } from "../shared/collector";
import { DailyStartScheduler, hasDailyStartRulePatch } from "./daily-start-scheduler";

function validateString(value: unknown, name: string): string {
  if (typeof value !== "string") {
    throw new Error(`${name} muss ein String sein`);
  }
  return value;
}

function validatePlainObject(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${name} muss ein Objekt sein`);
  }
  return value as Record<string, unknown>;
}

const IMPORT_QUEUE_MAX_BYTES = 10 * 1024 * 1024;
const CLIPBOARD_WRITE_MAX_BYTES = 4096;
const RENAME_PACKAGE_MAX_CHARS = 240;
const RESETTABLE_PROVIDER_KEYS = new Set<DebridProvider>([
  "realdebrid",
  "megadebrid-api",
  "megadebrid-web",
  "bestdebrid",
  "alldebrid",
  "ddownload",
  "onefichier",
  "debridlink",
  "linksnappy"
]);

if (app.isPackaged && !process.argv.some((arg) => arg === "--user-data-dir" || arg.startsWith("--user-data-dir="))) {
  app.setPath("userData", migrateProductUserDataDirectory(app.getPath("appData")));
}

function validateStringArray(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || !value.every(v => typeof v === "string")) {
    throw new Error(`${name} muss ein String-Array sein`);
  }
  return value as string[];
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.exit(0);
  process.exit(0);
}

process.on("uncaughtException", (error) => {
  logger.error(`Uncaught Exception: ${String(error?.stack || error)}`);
});
process.on("unhandledRejection", (reason) => {
  const detail = reason instanceof Error ? (reason.stack || reason.message) : String(reason);
  logger.error(`Unhandled Rejection: ${detail}`);
});
// Node-Warnungen (z.B. MaxListenersExceeded, DeprecationWarning) sind ein
// Frühindikator für Leaks/Fehlnutzung in einem langlaufenden Server-Prozess.
process.on("warning", (warning) => {
  logger.warn(`Node-Warnung: ${warning.name}: ${warning.message}${warning.stack ? ` | ${warning.stack.replace(/\s*\n\s*/g, " ⏎ ")}` : ""}`);
});

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let clipboardTimer: ReturnType<typeof setInterval> | null = null;
let updateQuitTimer: ReturnType<typeof setTimeout> | null = null;
let scheduledStartTimer: ReturnType<typeof setTimeout> | null = null;
let dailyStartScheduler: DailyStartScheduler | null = null;
let lastClipboardText = "";
let controller: AppController;
let pendingBackupImport: Buffer | null = null;
const CLIPBOARD_MAX_TEXT_CHARS = 50_000;

function reconcileDailyStart(source: string): void {
  void dailyStartScheduler?.reconcile().catch((error) => {
    logger.warn(`Täglicher Start konnte nach ${source} nicht abgeglichen werden: ${String(error)}`);
  });
}

function handlePowerSuspend(): void {
  reconcileDailyStart("Suspend");
}

function handlePowerResume(): void {
  reconcileDailyStart("Resume");
}

export interface BeforeQuitHandlerOptions {
  cleanup: () => void;
  shutdown: () => Promise<void>;
  continueQuit: () => void;
  onError: (error: unknown) => void;
}

export function createBeforeQuitHandler(options: BeforeQuitHandlerOptions): (event: { preventDefault: () => void }) => void {
  let shutdownStarted = false;
  let quitAllowed = false;
  return (event) => {
    if (quitAllowed) {
      return;
    }
    event.preventDefault();
    if (shutdownStarted) {
      return;
    }
    shutdownStarted = true;
    let shutdown: Promise<void>;
    try {
      options.cleanup();
      shutdown = options.shutdown();
    } catch (error) {
      shutdown = Promise.reject(error);
    }
    void shutdown.catch((error) => {
      options.onError(error);
    }).finally(() => {
      quitAllowed = true;
      options.continueQuit();
    });
  };
}

function isDevMode(): boolean {
  return process.env.NODE_ENV === "development";
}

function validateHistoryEntryIds(value: unknown): string[] {
  const entryIds = validateStringArray(value, "entryIds");
  if (entryIds.length > 100_000 || entryIds.some((entryId) => entryId.length === 0 || entryId.length > 4_096)) {
    throw new Error("entryIds ist ungültig");
  }
  return [...new Set(entryIds)];
}

function getRendererFileUrl(): string {
  return pathToFileURL(path.join(app.getAppPath(), "build", "renderer", "index.html")).toString();
}

function getTrustedRendererUrl(): string {
  return isDevMode() ? DEV_SERVER_URL : getRendererFileUrl();
}

function getTrustedIpcOptions(): TrustedIpcOptions {
  return {
    isPackaged: !isDevMode(),
    devServerUrl: DEV_SERVER_URL,
    appPath: app.getAppPath()
  };
}

function handleTrusted<TArgs extends unknown[]>(channel: string, listener: (event: IpcMainInvokeEvent, ...args: TArgs) => unknown): void {
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event, getTrustedIpcOptions());
    return listener(event, ...(args as TArgs));
  });
}

function onTrusted<TArgs extends unknown[]>(channel: string, listener: (event: IpcMainEvent, ...args: TArgs) => void): void {
  ipcMain.on(channel, (event, ...args) => {
    assertTrustedIpcSender(event, getTrustedIpcOptions());
    listener(event, ...(args as TArgs));
  });
}

// Single owner of the scheduled-start timer. startOnPast: a past time entered
// interactively starts right away; at boot a stale past time is cleared instead
// (an unattended auto-start at boot would race autoResumeOnStart's conflict gate).
function armScheduledStart(schedMs: number, opts: { startOnPast: boolean }): void {
  if (scheduledStartTimer !== null) {
    clearTimeout(scheduledStartTimer);
    scheduledStartTimer = null;
  }
  if (!schedMs || schedMs <= 0) {
    return;
  }
  const delay = schedMs - Date.now();
  if (delay <= 0) {
    if (opts.startOnPast) {
      void controller.start().catch((err) => logger.warn(`Scheduled-Start Fehler: ${String(err)}`));
    } else {
      logger.warn(`Geplanter Start (${new Date(schedMs).toLocaleString()}) lag beim App-Start in der Vergangenheit — verworfen`);
    }
    controller.updateSettings({ scheduledStartEpochMs: 0 });
    return;
  }
  scheduledStartTimer = setTimeout(() => {
    scheduledStartTimer = null;
    void controller.start().catch((err) => logger.warn(`Scheduled-Start Fehler: ${String(err)}`));
    controller.updateSettings({ scheduledStartEpochMs: 0 });
  }, delay);
  logger.info(`Geplanter Start gearmt: ${new Date(schedMs).toLocaleString()}`);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1920,
    height: 1080,
    minWidth: 1120,
    minHeight: 760,
    backgroundColor: "#070b14",
    title: `${APP_NAME} - v${controller.getVersion()}`,
    icon: resolveAppIconPath(app.isPackaged, app.getAppPath(), process.resourcesPath),
    webPreferences: createMainWindowWebPreferences(path.join(__dirname, "../preload/preload.js"))
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    logger.error(`Renderer-Laden fehlgeschlagen: id=${window.id} code=${errorCode} mainFrame=${isMainFrame} url=${validatedURL} error=${errorDescription}`);
  });

  applyMainWindowSecurity(window, {
    rendererUrl: getTrustedRendererUrl(),
    externalHosts: MAIN_WINDOW_EXTERNAL_HOSTS
  });

  if (!isDevMode()) {
    window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          "Content-Security-Policy": [
            "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://api.real-debrid.com https://codeberg.org https://bestdebrid.com https://api.alldebrid.com https://www.mega-debrid.eu https://ddownload.com https://ddl.to https://debrid-link.com"
          ]
        }
      });
    });
  }

  window.setMenuBarVisibility(false);
  window.setAutoHideMenuBar(true);

  if (isDevMode()) {
    void window.loadURL(DEV_SERVER_URL).catch((error) => {
      logger.error(`Renderer-Start fehlgeschlagen: ${String(error?.stack || error)}`);
    });
  } else {
    void window.loadFile(path.join(app.getAppPath(), "build", "renderer", "index.html")).catch((error) => {
      logger.error(`Renderer-Start fehlgeschlagen: ${String(error?.stack || error)}`);
    });
  }

  return window;
}

let rendererReloadTimes: number[] = [];
const RENDERER_RELOAD_WINDOW_MS = 5 * 60 * 1000;
const RENDERER_RELOAD_MAX = 3;

// Circuit breaker: recover from a one-off renderer crash by reloading, but stop
// after a few crashes in a short window so a reproducible crash can't spin into a
// reload loop that pegs an unattended server.
function allowRendererReload(): boolean {
  const now = Date.now();
  rendererReloadTimes = rendererReloadTimes.filter((t) => now - t < RENDERER_RELOAD_WINDOW_MS);
  if (rendererReloadTimes.length >= RENDERER_RELOAD_MAX) {
    return false;
  }
  rendererReloadTimes.push(now);
  return true;
}

function bindMainWindowLifecycle(window: BrowserWindow): void {
  window.on("close", (event) => {
    const settings = controller.getSettings();
    if (settings.minimizeToTray && tray) {
      event.preventDefault();
      window.hide();
    }
  });

  window.on("closed", () => {
    if (mainWindow === window) {
      mainWindow = null;
    }
  });

  window.webContents.on("render-process-gone", (_event, details) => {
    logger.error(`Renderer-Prozess beendet: reason=${details.reason} exitCode=${details.exitCode ?? "?"}`);
    if (details.reason === "clean-exit" || window.isDestroyed()) {
      return;
    }
    if (allowRendererReload()) {
      logger.warn("Renderer wird automatisch neu geladen (Wiederherstellung nach Absturz)");
      try {
        window.webContents.reload();
      } catch (error) {
        logger.error(`Renderer-Reload fehlgeschlagen: ${String(error)}`);
      }
    } else {
      logger.error(`Renderer-Absturz: Auto-Reload gestoppt (mehr als ${RENDERER_RELOAD_MAX} Abstürze in ${RENDERER_RELOAD_WINDOW_MS / 60000} Min) - manueller Neustart nötig`);
    }
  });

  // Nur protokollieren, niemals killen/neu laden: "unresponsive" feuert auch
  // während legitimer langer Sync-Arbeit (große JSON-Serialisierung) und erholt
  // sich meist von selbst. Eingreifen würde einen Schluckauf zum Ausfall machen.
  window.webContents.on("unresponsive", () => {
    logger.warn("Renderer reagiert nicht (unresponsive) - evtl. langer Sync-Task, warte auf Erholung");
  });
  window.webContents.on("responsive", () => {
    logger.info("Renderer wieder reaktionsfähig (responsive)");
  });
}

function createTray(): void {
  if (tray) {
    return;
  }
  const iconPath = resolveAppIconPath(app.isPackaged, app.getAppPath(), process.resourcesPath);
  try {
    tray = new Tray(iconPath);
  } catch (error) {
    logger.warn(`Tray-Icon konnte nicht erstellt werden (Headless/RDP/Service?): ${String(error)} - Minimize-to-Tray steht nicht zur Verfuegung, Fenster bleibt sichtbar.`);
    return;
  }
  tray.setToolTip(APP_NAME);
  const contextMenu = Menu.buildFromTemplate([
    { label: "Anzeigen", click: () => { mainWindow?.show(); mainWindow?.focus(); } },
    { type: "separator" },
    { label: "Start", click: () => { void controller.start().catch((err) => logger.warn(`Tray Start Fehler: ${String(err)}`)); } },
    { label: "Stop", click: () => { controller.stop(); } },
    { type: "separator" },
    { label: "Beenden", click: () => { app.quit(); } }
  ]);
  tray.setContextMenu(contextMenu);
  tray.on("double-click", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
}

function destroyTray(): void {
  if (tray) {
    tray.destroy();
    tray = null;
  }
}

function extractLinksFromText(text: string): string[] {
  return extractHttpLinksFromText(text);
}

function normalizeClipboardText(text: string): string {
  const truncateUnicodeSafe = (value: string, maxChars: number): string => {
    if (value.length <= maxChars) {
      return value;
    }
    const points = Array.from(value);
    if (points.length <= maxChars) {
      return value;
    }
    return points.slice(0, maxChars).join("");
  };

  const normalized = String(text || "");
  if (normalized.length <= CLIPBOARD_MAX_TEXT_CHARS) {
    return normalized;
  }
  const truncated = truncateUnicodeSafe(normalized, CLIPBOARD_MAX_TEXT_CHARS);
  const lastBreak = Math.max(
    truncated.lastIndexOf("\n"),
    truncated.lastIndexOf("\r"),
    truncated.lastIndexOf("\t"),
    truncated.lastIndexOf(" ")
  );
  if (lastBreak >= Math.floor(CLIPBOARD_MAX_TEXT_CHARS * 0.7)) {
    return truncated.slice(0, lastBreak);
  }
  return truncated;
}

function startClipboardWatcher(): void {
  if (clipboardTimer) {
    return;
  }
  lastClipboardText = normalizeClipboardText(clipboard.readText());
  clipboardTimer = setInterval(() => {
    let text: string;
    try {
      text = normalizeClipboardText(clipboard.readText());
    } catch {
      return;
    }
    if (text === lastClipboardText || !text.trim()) {
      return;
    }
    lastClipboardText = text;
    const links = extractLinksFromText(text);
    if (links.length > 0 && mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(IPC_CHANNELS.CLIPBOARD_DETECTED, links);
    }
  }, 2000);
}

function stopClipboardWatcher(): void {
  if (clipboardTimer) {
    clearInterval(clipboardTimer);
    clipboardTimer = null;
  }
}

function updateClipboardWatcher(): void {
  const settings = controller.getSettings();
  if (settings.clipboardWatch) {
    startClipboardWatcher();
  } else {
    stopClipboardWatcher();
  }
}

function updateTray(): void {
  const settings = controller.getSettings();
  if (settings.minimizeToTray) {
    createTray();
  } else {
    destroyTray();
  }
}

function registerIpcHandlers(): void {
  handleTrusted(IPC_CHANNELS.GET_SNAPSHOT, () => controller.getSnapshot());
  handleTrusted(IPC_CHANNELS.GET_VERSION, () => controller.getVersion());
  handleTrusted(IPC_CHANNELS.CHECK_UPDATES, async () => controller.checkUpdates());
  handleTrusted(IPC_CHANNELS.INSTALL_UPDATE, async () => {
    const result = await controller.installUpdate((progress: UpdateInstallProgress) => {
      if (!mainWindow || mainWindow.isDestroyed()) {
        return;
      }
      mainWindow.webContents.send(IPC_CHANNELS.UPDATE_INSTALL_PROGRESS, progress);
    });
    if (result.started) {
      updateQuitTimer = setTimeout(() => {
        app.quit();
      }, 250);
    }
    return result;
  });
  handleTrusted(IPC_CHANNELS.OPEN_EXTERNAL, async (_event: IpcMainInvokeEvent, rawUrl: string) => {
    return openAllowedExternalUrl(String(rawUrl || "").trim(), MAIN_WINDOW_EXTERNAL_HOSTS);
  });
  handleTrusted(IPC_CHANNELS.UPDATE_SETTINGS, async (_event: IpcMainInvokeEvent, partial: RendererSettingsUpdate) => {
    const validated = validateRendererSettingsUpdate(partial ?? {}, controller.getSettings());
    const result = controller.updateSettings(validated as Partial<AppSettings>);
    updateClipboardWatcher();
    updateTray();
    armScheduledStart(result.scheduledStartEpochMs || 0, { startOnPast: true });
    if (hasDailyStartRulePatch(validated)) {
      await dailyStartScheduler?.reconcile();
    } else {
      reconcileDailyStart("Einstellungsänderung");
    }
    return createRendererSettings(controller.getSettings());
  });
  handleTrusted(IPC_CHANNELS.RESET_PROVIDER_DAILY_USAGE, (_event: IpcMainInvokeEvent, provider: string) => {
    const validatedProvider = validateString(provider, "provider") as DebridProvider;
    if (!RESETTABLE_PROVIDER_KEYS.has(validatedProvider)) {
      throw new Error("provider ist ungültig");
    }
    return createRendererSettings(controller.resetProviderDailyUsage(validatedProvider));
  });
  handleTrusted(IPC_CHANNELS.RESET_DEBRID_LINK_API_KEY_DAILY_USAGE, (_event: IpcMainInvokeEvent, keyId: string) => {
    const validatedKeyId = validateString(keyId, "keyId").trim();
    if (!validatedKeyId) {
      throw new Error("keyId ist ungültig");
    }
    return createRendererSettings(controller.resetDebridLinkApiKeyDailyUsage(validatedKeyId));
  });

  handleTrusted(IPC_CHANNELS.CREATE_ACCOUNT, async (_event: IpcMainInvokeEvent, rawCommand: unknown) => {
    const command = validateAccountCommand(rawCommand);
    if (command.action !== "create") throw new Error("Account-Payload ist ungültig");
    const result = await controller.executeAccountCommand(command);
    reconcileDailyStart("Accountänderung");
    return result;
  });

  handleTrusted(IPC_CHANNELS.REPLACE_ACCOUNT, async (_event: IpcMainInvokeEvent, rawCommand: unknown) => {
    const command = validateAccountCommand(rawCommand);
    if (command.action !== "replace") throw new Error("Account-Payload ist ungültig");
    const result = await controller.executeAccountCommand(command);
    reconcileDailyStart("Accountänderung");
    return result;
  });

  handleTrusted(IPC_CHANNELS.UPDATE_ACCOUNT_SECRET, async (_event: IpcMainInvokeEvent, rawCommand: unknown) => {
    const command = validateAccountCommand(rawCommand);
    if (command.action !== "update-secret") throw new Error("Account-Payload ist ungültig");
    const result = await controller.executeAccountCommand(command);
    reconcileDailyStart("Accountänderung");
    return result;
  });

  handleTrusted(IPC_CHANNELS.DELETE_ACCOUNT, async (_event: IpcMainInvokeEvent, rawCommand: unknown) => {
    const command = validateAccountCommand(rawCommand);
    if (command.action !== "delete") throw new Error("Account-Payload ist ungültig");
    const result = await controller.executeAccountCommand(command);
    reconcileDailyStart("Accountänderung");
    return result;
  });
  handleTrusted(IPC_CHANNELS.REVEAL_ACCOUNT_SECRET, (_event: IpcMainInvokeEvent, rawRequest: unknown) => {
    return controller.revealAccountSecret(validateAccountSecretRequest(rawRequest));
  });
  handleTrusted(IPC_CHANNELS.GET_ARCHIVE_PASSWORD_LIST, () => controller.getArchivePasswordList());
  handleTrusted(IPC_CHANNELS.ADD_LINKS, (_event: IpcMainInvokeEvent, payload: AddLinksPayload) => {
    validatePlainObject(payload ?? {}, "payload");
    validateString(payload?.rawText, "rawText");
    if (payload.packageName !== undefined) {
      validateString(payload.packageName, "packageName");
    }
    if (payload.duplicatePolicy !== undefined && payload.duplicatePolicy !== "keep" && payload.duplicatePolicy !== "skip" && payload.duplicatePolicy !== "overwrite") {
      throw new Error("duplicatePolicy muss 'keep', 'skip' oder 'overwrite' sein");
    }
    return controller.addLinks(payload);
  });
  handleTrusted(IPC_CHANNELS.ADD_CONTAINERS, async (_event: IpcMainInvokeEvent, filePaths: string[]) => {
    const validPaths = validateStringArray(filePaths ?? [], "filePaths");
    const safePaths = validPaths.filter((p) => path.isAbsolute(p));
    return controller.addContainers(safePaths);
  });
  handleTrusted(IPC_CHANNELS.INSPECT_COLLECTOR_TEXT, (_event: IpcMainInvokeEvent, rawRequest: unknown) => {
    return controller.inspectCollectorText(validateCollectorInspectionRequest(rawRequest));
  });
  handleTrusted(IPC_CHANNELS.INSPECT_COLLECTOR_CONTAINERS, (_event: IpcMainInvokeEvent, rawPaths: unknown, rawAddedAt: unknown) => {
    const request = validateCollectorContainerInspectionRequest(rawPaths, rawAddedAt);
    const safePaths = request.filePaths.filter((filePath) => path.isAbsolute(filePath));
    if (safePaths.length !== request.filePaths.length) {
      throw new Error("Container-Payload ist ungültig");
    }
    return controller.inspectCollectorContainers(safePaths, request.addedAt);
  });
  handleTrusted(IPC_CHANNELS.GET_START_CONFLICTS, () => controller.getStartConflicts());
  handleTrusted(IPC_CHANNELS.RESOLVE_START_CONFLICT, (_event: IpcMainInvokeEvent, packageId: string, policy: "keep" | "skip" | "overwrite") => {
    validateString(packageId, "packageId");
    validateString(policy, "policy");
    if (policy !== "keep" && policy !== "skip" && policy !== "overwrite") {
      throw new Error("policy muss 'keep', 'skip' oder 'overwrite' sein");
    }
    return controller.resolveStartConflict(packageId, policy);
  });
  handleTrusted(IPC_CHANNELS.CLEAR_ALL, () => controller.clearAll());
  handleTrusted(IPC_CHANNELS.START, () => {
    if (scheduledStartTimer !== null) {
      clearTimeout(scheduledStartTimer);
      scheduledStartTimer = null;
      controller.updateSettings({ scheduledStartEpochMs: 0 });
    }
    return controller.start();
  });
  handleTrusted(IPC_CHANNELS.START_PACKAGES, (_event: IpcMainInvokeEvent, packageIds: string[]) => {
    validateStringArray(packageIds ?? [], "packageIds");
    return controller.startPackages(packageIds ?? []);
  });
  handleTrusted(IPC_CHANNELS.START_ITEMS, (_event: IpcMainInvokeEvent, itemIds: string[]) => {
    validateStringArray(itemIds ?? [], "itemIds");
    return controller.startItems(itemIds ?? []);
  });
  handleTrusted(IPC_CHANNELS.STOP, () => controller.stop());
  handleTrusted(IPC_CHANNELS.TOGGLE_PAUSE, () => controller.togglePause());
  handleTrusted(IPC_CHANNELS.CANCEL_PACKAGE, (_event: IpcMainInvokeEvent, packageId: string) => {
    validateString(packageId, "packageId");
    return controller.cancelPackage(packageId);
  });
  handleTrusted(IPC_CHANNELS.RENAME_PACKAGE, (_event: IpcMainInvokeEvent, packageId: string, newName: string) => {
    validateString(packageId, "packageId");
    validateString(newName, "newName");
    if (newName.length > RENAME_PACKAGE_MAX_CHARS) {
      throw new Error(`newName zu lang (max ${RENAME_PACKAGE_MAX_CHARS} Zeichen)`);
    }
    return controller.renamePackage(packageId, newName);
  });
  handleTrusted(IPC_CHANNELS.REORDER_PACKAGES, (_event: IpcMainInvokeEvent, packageIds: string[]) => {
    validateStringArray(packageIds, "packageIds");
    return controller.reorderPackages(packageIds);
  });
  handleTrusted(IPC_CHANNELS.REMOVE_ITEM, (_event: IpcMainInvokeEvent, itemId: string) => {
    validateString(itemId, "itemId");
    return controller.removeItem(itemId);
  });
  handleTrusted(IPC_CHANNELS.TOGGLE_PACKAGE, (_event: IpcMainInvokeEvent, packageId: string) => {
    validateString(packageId, "packageId");
    return controller.togglePackage(packageId);
  });
  handleTrusted(IPC_CHANNELS.EXPORT_PACKAGE_SELECTION, async (_event: IpcMainInvokeEvent, packageIds: string[]) => {
    const validPackageIds = validateStringArray(packageIds ?? [], "packageIds");
    const exported = controller.exportPackageSelection(validPackageIds);
    if (exported.packageCount === 0 || exported.linkCount === 0) {
      return { saved: false, packageCount: 0, linkCount: 0 };
    }
    const options = {
      defaultPath: exported.defaultFileName,
      filters: [{ name: "Link Export", extensions: ["txt"] }]
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return { saved: false, packageCount: exported.packageCount, linkCount: exported.linkCount };
    }
    await fs.promises.writeFile(result.filePath, exported.text, "utf8");
    return { saved: true, packageCount: exported.packageCount, linkCount: exported.linkCount, filePath: result.filePath };
  });
  handleTrusted(IPC_CHANNELS.EXPORT_ITEM_SELECTION, async (_event: IpcMainInvokeEvent, itemIds: string[]) => {
    const validItemIds = validateStringArray(itemIds ?? [], "itemIds");
    const exported = controller.exportItemSelection(validItemIds);
    if (exported.packageCount === 0 || exported.linkCount === 0) {
      return { saved: false, packageCount: 0, linkCount: 0 };
    }
    const options = {
      defaultPath: exported.defaultFileName,
      filters: [{ name: "Link Export", extensions: ["txt"] }]
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return { saved: false, packageCount: exported.packageCount, linkCount: exported.linkCount };
    }
    await fs.promises.writeFile(result.filePath, exported.text, "utf8");
    return { saved: true, packageCount: exported.packageCount, linkCount: exported.linkCount, filePath: result.filePath };
  });
  handleTrusted(IPC_CHANNELS.RETRY_EXTRACTION, (_event: IpcMainInvokeEvent, packageId: string) => {
    validateString(packageId, "packageId");
    return controller.retryExtraction(packageId);
  });
  handleTrusted(IPC_CHANNELS.EXTRACT_NOW, (_event: IpcMainInvokeEvent, packageId: string) => {
    validateString(packageId, "packageId");
    return controller.extractNow(packageId);
  });
  handleTrusted(IPC_CHANNELS.RESET_PACKAGE, (_event: IpcMainInvokeEvent, packageId: string) => {
    validateString(packageId, "packageId");
    return controller.resetPackage(packageId);
  });
  handleTrusted(IPC_CHANNELS.SET_PACKAGE_PRIORITY, (_event: IpcMainInvokeEvent, packageId: string, priority: string) => {
    validateString(packageId, "packageId");
    validateString(priority, "priority");
    if (priority !== "high" && priority !== "normal" && priority !== "low") {
      throw new Error("priority muss 'high', 'normal' oder 'low' sein");
    }
    return controller.setPackagePriority(packageId, priority);
  });
  handleTrusted(IPC_CHANNELS.SKIP_ITEMS, (_event: IpcMainInvokeEvent, itemIds: string[]) => {
    validateStringArray(itemIds ?? [], "itemIds");
    return controller.skipItems(itemIds ?? []);
  });
  handleTrusted(IPC_CHANNELS.RESET_ITEMS, (_event: IpcMainInvokeEvent, itemIds: string[]) => {
    validateStringArray(itemIds ?? [], "itemIds");
    return controller.resetItems(itemIds ?? []);
  });
  handleTrusted(IPC_CHANNELS.GET_HISTORY, () => controller.getHistory());
  handleTrusted(IPC_CHANNELS.CLEAR_HISTORY, () => controller.clearHistory());
  handleTrusted(IPC_CHANNELS.REMOVE_HISTORY_ENTRY, (_event: IpcMainInvokeEvent, entryId: string) => {
    validateString(entryId, "entryId");
    return controller.removeHistoryEntry(entryId);
  });
  handleTrusted(IPC_CHANNELS.REMOVE_HISTORY_ENTRIES, (_event: IpcMainInvokeEvent, entryIds: unknown) => {
    return controller.removeHistoryEntries(validateHistoryEntryIds(entryIds));
  });
  handleTrusted(IPC_CHANNELS.REVEAL_HISTORY_ENTRY, (_event: IpcMainInvokeEvent, entryId: unknown) => {
    return revealHistoryEntry({ entryId }, {
      loadHistory: () => controller.getHistory(),
      stat: (directory) => fs.promises.stat(directory),
      openPath: (directory) => shell.openPath(directory)
    });
  });
  handleTrusted(IPC_CHANNELS.EXPORT_QUEUE, async () => {
    const options = {
      defaultPath: `rd-queue-export.json`,
      filters: [{ name: "Queue Export", extensions: ["json"] }]
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return { saved: false };
    }
    const json = controller.exportQueue();
    await fs.promises.writeFile(result.filePath, json, "utf8");
    return { saved: true };
  });
  handleTrusted(IPC_CHANNELS.IMPORT_QUEUE, (_event: IpcMainInvokeEvent, json: string) => {
    validateString(json, "json");
    const bytes = Buffer.byteLength(json, "utf8");
    if (bytes > IMPORT_QUEUE_MAX_BYTES) {
      throw new Error(`Queue-Import zu groß (max ${IMPORT_QUEUE_MAX_BYTES} Bytes)`);
    }
    return controller.importQueue(json);
  });
  handleTrusted(IPC_CHANNELS.TOGGLE_CLIPBOARD, () => {
    const settings = controller.getSettings();
    const next = !settings.clipboardWatch;
    controller.updateSettings({ clipboardWatch: next });
    updateClipboardWatcher();
    return next;
  });
  handleTrusted(IPC_CHANNELS.WRITE_CLIPBOARD_TEXT, (_event: IpcMainInvokeEvent, rawText: unknown) => {
    const text = validateString(rawText, "text");
    const bytes = Buffer.byteLength(text, "utf8");
    if (!text.trim()) {
      throw new Error("text darf nicht leer sein");
    }
    if (bytes > CLIPBOARD_WRITE_MAX_BYTES) {
      throw new Error(`text ist zu groß (max ${CLIPBOARD_WRITE_MAX_BYTES} Bytes)`);
    }
    try {
      clipboard.writeText(text);
      return true;
    } catch (error) {
      logger.warn(`Zwischenablage-Schreibfehler: bytes=${bytes}, error=${String(error)}`);
      throw error;
    }
  });
  handleTrusted(IPC_CHANNELS.PICK_FOLDER, async () => {
    const options = {
      properties: ["openDirectory", "createDirectory"] as Array<"openDirectory" | "createDirectory">
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? null : result.filePaths[0] || null;
  });
  handleTrusted(IPC_CHANNELS.PICK_CONTAINERS, async () => {
    const options = {
      properties: ["openFile", "multiSelections"] as Array<"openFile" | "multiSelections">,
      filters: [
        { name: "Container", extensions: ["dlc"] },
        { name: "Alle Dateien", extensions: ["*"] }
      ]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    return result.canceled ? [] : result.filePaths;
  });
  handleTrusted(IPC_CHANNELS.GET_SESSION_STATS, () => controller.getSessionStats());
  handleTrusted(IPC_CHANNELS.RESET_SESSION_STATS, () => controller.resetSessionStats());
  handleTrusted(IPC_CHANNELS.RESET_DOWNLOAD_STATS, () => controller.resetDownloadStats());

  handleTrusted(IPC_CHANNELS.RESTART, () => {
    app.relaunch();
    app.quit();
  });

  handleTrusted(IPC_CHANNELS.QUIT, () => {
    app.quit();
  });

  handleTrusted(IPC_CHANNELS.EXPORT_BACKUP, async (_event: IpcMainInvokeEvent, rawPassphrase: unknown) => {
    const passphrase = validateString(rawPassphrase, "passphrase");
    const options = {
      defaultPath: `${new Date().toISOString().slice(0, 10).split("-").reverse().join("-")}-mdd-backup.mdd`,
      filters: [{ name: "MDD Backup", extensions: ["mdd"] }]
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return { saved: false };
    }
    const encrypted = controller.exportBackup(passphrase);
    await fs.promises.writeFile(result.filePath, encrypted);
    return { saved: true };
  });

  handleTrusted(IPC_CHANNELS.EXPORT_ONLINE_BACKUP, async () => controller.exportOnlineBackup());

  handleTrusted(IPC_CHANNELS.IMPORT_ONLINE_BACKUP, async (_event: IpcMainInvokeEvent, rawKey: unknown) => {
    const key = validateString(rawKey, "key").trim();
    if (key.length > 128) {
      throw new Error("Online-Sicherungsschlüssel ist ungültig");
    }
    return controller.importOnlineBackup(key);
  });

  handleTrusted(IPC_CHANNELS.EXPORT_SUPPORT_BUNDLE, async () => {
    const options = {
      defaultPath: controller.getSupportBundleDefaultFileName(),
      filters: [{ name: "Support Bundle", extensions: ["zip"] }]
    };
    const result = mainWindow ? await dialog.showSaveDialog(mainWindow, options) : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) {
      return { saved: false };
    }
    const exported = await controller.exportSupportBundle();
    await fs.promises.writeFile(result.filePath, exported.buffer);
    return { saved: true, filePath: result.filePath };
  });

  handleTrusted(IPC_CHANNELS.OPEN_LOG, async () => {
    const logPath = getLogFilePath();
    await shell.openPath(logPath);
  });

  handleTrusted(IPC_CHANNELS.OPEN_LOG_DIRECTORY, async () => {
    await shell.openPath(controller.getLogDirectory());
  });

  handleTrusted(IPC_CHANNELS.OPEN_AUDIT_LOG, async () => {
    const logPath = controller.getAuditLogPath();
    if (logPath) {
      await shell.openPath(logPath);
    }
  });

  handleTrusted(IPC_CHANNELS.OPEN_RENAME_LOG, async () => {
    const logPath = controller.getRenameLogPath();
    if (logPath) {
      await shell.openPath(logPath);
    }
  });

  handleTrusted(IPC_CHANNELS.OPEN_SESSION_LOG, async () => {
    const logPath = controller.getSessionLogPath();
    if (logPath) {
      await shell.openPath(logPath);
    }
  });

  handleTrusted(IPC_CHANNELS.OPEN_TRACE_LOG, async () => {
    const logPath = controller.getTraceLogPath();
    if (logPath) {
      await shell.openPath(logPath);
    }
  });

  handleTrusted(IPC_CHANNELS.OPEN_PACKAGE_LOG, async (_event: IpcMainInvokeEvent, packageId: string) => {
    validateString(packageId, "packageId");
    const logPath = controller.getPackageLogPath(packageId);
    if (logPath) {
      await shell.openPath(logPath);
    }
  });

  handleTrusted(IPC_CHANNELS.GET_DEBUG_SETUP_CHECK, async () => controller.getDebugSetupCheck());

  handleTrusted(IPC_CHANNELS.GET_RECENT_ERRORS, async () => getRecentErrors());

  handleTrusted(IPC_CHANNELS.TEST_NOTIFY, async (_event: IpcMainInvokeEvent, url: string, mention: string) => {
    validateString(url, "url");
    return sendNotification(url, {
      title: "🔔 Test-Benachrichtigung",
      message: "Webhook funktioniert — Benachrichtigungen kommen hier an.",
      mention: typeof mention === "string" ? mention : ""
    });
  });

  handleTrusted(IPC_CHANNELS.GET_TRACE_CONFIG, async () => controller.getTraceConfig());

  handleTrusted(IPC_CHANNELS.SET_TRACE_ENABLED, async (_event: IpcMainInvokeEvent, enabled: boolean, note?: string, durationMinutes?: number) => {
    if (typeof enabled !== "boolean") {
      throw new Error("enabled muss ein Boolean sein");
    }
    if (note !== undefined) {
      validateString(note, "note");
    }
    if (durationMinutes !== undefined && (!Number.isFinite(durationMinutes) || durationMinutes <= 0)) {
      throw new Error("durationMinutes muss eine positive Zahl sein");
    }
    return controller.setTraceEnabled(enabled, note, durationMinutes ? durationMinutes * 60 * 1000 : undefined);
  });

  handleTrusted(IPC_CHANNELS.ROTATE_DEBUG_TOKEN, async () => {
    const rotated = controller.rotateDebugToken();
    return { path: rotated.path };
  });

  handleTrusted(IPC_CHANNELS.GET_REMOTE_DIAGNOSTICS, async () => {
    return controller.getRemoteDiagnostics();
  });

  handleTrusted(IPC_CHANNELS.ENABLE_REMOTE_DIAGNOSTICS, async (_event: IpcMainInvokeEvent, input: EnableRemoteDiagnosticsInput) => {
    if (!input || (input.hostMode !== "local" && input.hostMode !== "network")) {
      throw new Error("hostMode muss 'local' oder 'network' sein");
    }
    const allowlist = Array.isArray(input.allowlist) ? input.allowlist.map((entry) => String(entry)) : [];
    return controller.enableRemoteDiagnostics({
      hostMode: input.hostMode,
      publicHost: String(input.publicHost || ""),
      port: input.port ? Number(input.port) : undefined,
      allowlist,
      name: input.name ? String(input.name) : undefined,
      rotateToken: Boolean(input.rotateToken)
    });
  });

  handleTrusted(IPC_CHANNELS.DISABLE_REMOTE_DIAGNOSTICS, async () => {
    return controller.disableRemoteDiagnostics();
  });

  handleTrusted(IPC_CHANNELS.ROTATE_REMOTE_DIAGNOSTICS_TOKEN, async () => {
    return controller.rotateRemoteDiagnosticsToken();
  });

  handleTrusted(IPC_CHANNELS.OPEN_ITEM_LOG, async (_event: IpcMainInvokeEvent, itemId: string) => {
    validateString(itemId, "itemId");
    const logPath = controller.getItemLogPath(itemId);
    if (logPath) {
      await shell.openPath(logPath);
    }
  });

  handleTrusted(IPC_CHANNELS.OPEN_REALDEBRID_LOGIN, async (_event: IpcMainInvokeEvent, rawRequest: unknown) => {
    await controller.openRealDebridLoginWindow(validateRealDebridLoginRequest(rawRequest));
  });

  handleTrusted(IPC_CHANNELS.OPEN_ALLDEBRID_LOGIN, async () => {
    await controller.openAllDebridLoginWindow();
  });

  handleTrusted(IPC_CHANNELS.IMPORT_BESTDEBRID_COOKIES, async () => {
    const options = {
      properties: ["openFile"] as Array<"openFile">,
      filters: [
        { name: "Cookie-Datei", extensions: ["txt"] },
        { name: "Alle Dateien", extensions: ["*"] }
      ]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return 0;
    }
    return controller.importBestDebridCookies(result.filePaths[0]);
  });

  handleTrusted(IPC_CHANNELS.GET_ALLDEBRID_HOST_INFO, async () => {
    return controller.getAllDebridHostInfo();
  });

  handleTrusted(IPC_CHANNELS.GET_DEBRIDLINK_HOST_LIMITS, async () => {
    return controller.getDebridLinkHostLimits();
  });

  handleTrusted(IPC_CHANNELS.CHECK_DEBRID_ACCOUNTS, async (_event, rawScope: unknown) => {
    const scope = rawScope === undefined ? "active" : validateString(rawScope, "scope");
    if (scope !== "active" && scope !== "all") {
      throw new Error("scope ist ungültig");
    }
    return controller.checkDebridAccounts(scope);
  });

  handleTrusted(IPC_CHANNELS.CHECK_ACCOUNT_CREDENTIALS, async (_event, rawInput: unknown) => {
    return controller.checkAccountCredentials(validateAccountCredentialCheckInput(rawInput));
  });

  handleTrusted(IPC_CHANNELS.SELECT_BACKUP_IMPORT, async () => {
    pendingBackupImport = null;
    const options = {
      properties: ["openFile"] as Array<"openFile">,
      filters: [
        { name: "MDD Backup", extensions: ["mdd"] },
        { name: "Legacy Backup (JSON)", extensions: ["json"] },
        { name: "Alle Dateien", extensions: ["*"] }
      ]
    };
    const result = mainWindow ? await dialog.showOpenDialog(mainWindow, options) : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) {
      return { selected: false, requiresPassphrase: false, message: "Abgebrochen" };
    }
    const filePath = result.filePaths[0];
    const stat = await fs.promises.stat(filePath);
    const BACKUP_MAX_BYTES = 50 * 1024 * 1024;
    if (stat.size > BACKUP_MAX_BYTES) {
      return { selected: false, requiresPassphrase: false, message: `Backup-Datei zu groß (max 50 MB, Datei hat ${(stat.size / 1024 / 1024).toFixed(1)} MB)` };
    }
    const data = await fs.promises.readFile(filePath);
    pendingBackupImport = data;
    return { selected: true, requiresPassphrase: isMdd2Backup(data) };
  });

  handleTrusted(IPC_CHANNELS.CANCEL_BACKUP_IMPORT, () => {
    pendingBackupImport = null;
  });

  handleTrusted(IPC_CHANNELS.IMPORT_BACKUP, async (_event: IpcMainInvokeEvent, rawPassphrase?: unknown) => {
    const data = pendingBackupImport;
    pendingBackupImport = null;
    if (!data) {
      return { restored: false, relaunch: false, message: "Keine Backup-Datei ausgewählt" };
    }
    const passphrase = typeof rawPassphrase === "string" ? rawPassphrase : undefined;
    const importResult = controller.importBackup(data, passphrase);
    // Only a full restore (queue swapped) needs the auto-relaunch. A settings-
    // only import applied live — relaunching would be pointless and would drop
    // the running queue.
    if (importResult.restored && importResult.relaunch) {
      setTimeout(() => {
        app.relaunch();
        app.quit();
      }, 1500);
    }
    return importResult;
  });

  onTrusted(IPC_CHANNELS.LOG_RENDERER_ERROR, (_event, rawReport: unknown) => {
    try {
      logger.error(formatRendererErrorReport(rawReport));
    } catch (error) {
      logger.error(`[Renderer] Fehlerbericht konnte nicht verarbeitet werden: ${String(error)}`);
    }
  });

  controller.onState = (snapshot) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send(IPC_CHANNELS.STATE_UPDATE, snapshot);
  };
  controller.onHistoryEntryAdded = (entry) => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      return;
    }
    mainWindow.webContents.send(IPC_CHANNELS.HISTORY_ENTRY_ADDED, entry);
  };
}

function formatRendererErrorReport(rawReport: unknown): string {
  const report = (rawReport && typeof rawReport === "object" ? rawReport : {}) as Record<string, unknown>;
  const str = (value: unknown): string => (typeof value === "string" ? value : "");
  const num = (value: unknown): string => (typeof value === "number" && Number.isFinite(value) ? String(value) : "");
  const kind = str(report.kind) || "error";
  const message = (str(report.message) || "(ohne Nachricht)").slice(0, 2000);
  const source = str(report.source);
  const line = num(report.line);
  const column = num(report.column);
  const stack = str(report.stack).slice(0, 4000);
  const componentStack = str(report.componentStack).slice(0, 4000);

  const parts: string[] = [`[Renderer:${kind}] ${message}`];
  if (source) {
    parts.push(`@ ${source}${line ? `:${line}${column ? `:${column}` : ""}` : ""}`);
  }
  if (stack) {
    parts.push(`| stack: ${stack.replace(/\s*\n\s*/g, " ⏎ ")}`);
  }
  if (componentStack) {
    parts.push(`| react: ${componentStack.replace(/\s*\n\s*/g, " ⏎ ")}`);
  }
  return parts.join(" ");
}

app.on("child-process-gone", (_event, details) => {
  const killed = details.reason !== "clean-exit" && details.reason !== "killed";
  const line = `Subprozess beendet: type=${details.type} reason=${details.reason} exitCode=${details.exitCode ?? "?"}${details.name ? ` name=${details.name}` : ""}${details.serviceName ? ` service=${details.serviceName}` : ""}`;
  if (killed) {
    logger.error(line);
  } else {
    logger.warn(line);
  }
});

app.on("second-instance", () => {
  if (mainWindow) {
    if (mainWindow.isMinimized()) {
      mainWindow.restore();
    }
    mainWindow.show();
    mainWindow.focus();
  }
});

app.whenReady().then(() => {
  configureCredentialProtector(safeStorage);
  controller = new AppController();
  dailyStartScheduler = new DailyStartScheduler(controller);
  cleanupStaleSubstDrives();
  registerIpcHandlers();
  mainWindow = createWindow();
  bindMainWindowLifecycle(mainWindow);
  updateClipboardWatcher();
  updateTray();
  // A scheduled start persists in the settings but its timer lived only in this
  // process — without re-arming it here, any restart (auto-update, reboot,
  // crash) silently swallowed the planned run.
  armScheduledStart(controller.getSettings().scheduledStartEpochMs || 0, { startOnPast: false });
  dailyStartScheduler.begin((error) => {
    logger.warn(`Täglicher Start konnte nicht abgeglichen werden: ${String(error)}`);
  });
  powerMonitor.on("suspend", handlePowerSuspend);
  powerMonitor.on("resume", handlePowerResume);

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow();
      bindMainWindowLifecycle(mainWindow);
    }
  });
}).catch((error) => {
  logger.error(`App-Start fehlgeschlagen: ${String(error?.stack || error)}`);
  console.error("App startup failed:", error);
  app.quit();
});

app.on("window-all-closed", () => {
  logger.warn("Alle Hauptfenster geschlossen");
  if (process.platform !== "darwin") {
    app.quit();
  }
});

app.on("before-quit", createBeforeQuitHandler({
  cleanup: () => {
    if (updateQuitTimer) { clearTimeout(updateQuitTimer); updateQuitTimer = null; }
    if (scheduledStartTimer) { clearTimeout(scheduledStartTimer); scheduledStartTimer = null; }
    dailyStartScheduler?.end();
    powerMonitor.removeListener("suspend", handlePowerSuspend);
    powerMonitor.removeListener("resume", handlePowerResume);
    stopClipboardWatcher();
    destroyTray();
    shutdownDaemon();
  },
  shutdown: async () => {
    if (controller) {
      await controller.shutdown();
    }
  },
  continueQuit: () => app.quit(),
  onError: (error) => {
    logger.error(`Fehler beim Shutdown: ${String(error)}`);
  }
}));
