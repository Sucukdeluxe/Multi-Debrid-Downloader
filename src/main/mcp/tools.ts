import fs from "node:fs/promises";
import { flushDiagnosticLogWrites } from "../diagnostic-log-writer";
import crypto from "node:crypto";
import AdmZip from "adm-zip";
import type { AppController } from "../app-controller";
import { createRendererAccounts, createRendererSettings } from "../renderer-state";
import { validateRendererSettingsUpdate } from "../renderer-settings";
import { validateAccountCommand, validateAccountCredentialCheckInput, validateAccountSecretRequest } from "../account-commands";
import { validateCollectorPersistenceState, validateCollectorTextPreparationRequest } from "../../shared/collector";
import { getProviderRuntimeSnapshot } from "../debrid";
import { getRecentErrors } from "../error-ring";
import { getLogFilePath } from "../logger";
import { getSessionLogPath } from "../session-log";
import { getConversionLogPath } from "../conversion-trace";
import { getNetworkProxyState } from "../network-proxy";
import { getWindowsHostDiagnostics } from "../windows-host-diagnostics";
import { runtimePerformance } from "../runtime-performance";
import { getProxyTransferSnapshot } from "../proxy-segmented-download";
import type { AddLinksPayload, DebridProvider, PackagePriority, RendererSettingsUpdate } from "../../shared/types";
import type { McpScope } from "../../shared/mcp";
import type { McpTool } from "./endpoint";
import { McpFiles } from "./files";
import type { McpUpdateJobs } from "./update-jobs";
import type { InstallerManifest, McpInstallerUploads } from "./installer-uploads";
import { McpFileTransfers, formatTransferResult } from "./file-transfers";
import { redact, requireScopes, type Schema } from "./security";

const str = (maxLength = 256): Schema => ({ type: "string", minLength: 1, maxLength });
const integer = (maximum: number, minimum = 0): Schema => ({ type: "integer", minimum, maximum });
const object = (properties: Record<string, Schema> = {}, required = Object.keys(properties)): Schema => ({ type: "object", properties, required, additionalProperties: false });
const ids: Schema = { type: "array", items: str(), minItems: 1, maxItems: 500 };
const page = { offset: integer(10_000_000), limit: integer(200, 1), search: { type: "string", maxLength: 500 } as Schema };
const kinds = ["realdebrid-api", "realdebrid-web", "megadebrid-api", "megadebrid-web", "bestdebrid-api", "bestdebrid-web", "alldebrid-api", "alldebrid-web", "deepbrid-api", "ddownload-login", "onefichier-api", "debridlink-api", "linksnappy-login"];
const providers = ["realdebrid", "megadebrid-api", "megadebrid-web", "bestdebrid", "alldebrid", "deepbrid", "ddownload", "onefichier", "debridlink", "linksnappy"];

function paginate(entries: unknown[], args: Record<string, unknown>): unknown {
  const search = String(args.search || "").toLocaleLowerCase();
  const filtered = search ? entries.filter(entry => JSON.stringify(entry).toLocaleLowerCase().includes(search)) : entries;
  const offset = Number(args.offset || 0);
  const limit = Number(args.limit || 100);
  return { total: filtered.length, offset, nextOffset: offset + limit < filtered.length ? offset + limit : null, entries: filtered.slice(offset, offset + limit) };
}

async function tail(file: string | null, lines: number, search: string): Promise<unknown> {
  if (!file) return { lines: [], missing: true };
  await flushDiagnosticLogWrites(file);
  let handle;
  try {
    handle = await fs.open(file, "r");
    const stat = await handle.stat();
    const offset = Math.max(0, stat.size - 1_048_576);
    const buffer = Buffer.alloc(Math.min(stat.size, 1_048_576));
    const read = await handle.read(buffer, 0, buffer.length, offset);
    const all = buffer.subarray(0, read.bytesRead).toString("utf8").split(/\r?\n/);
    if (offset) all.shift();
    return { lines: all.filter(line => !search || line.toLowerCase().includes(search.toLowerCase())).slice(-lines), truncated: offset > 0, size: stat.size };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return { lines: [], missing: true };
    throw error;
  } finally { await handle?.close(); }
}

export interface McpToolDependencies {
  controller: AppController;
  files: McpFiles;
  getScopes(): McpScope[];
  getSecrets(): string[];
  getInstallationId?(): string;
  updates: Pick<McpUpdateJobs, "start" | "status">;
  installerUploads?: Pick<McpInstallerUploads, "begin" | "chunk" | "status" | "commit" | "cancel">;
  updateSettings(patch: RendererSettingsUpdate): Promise<unknown>;
  start?(): Promise<void>;
  accountsChanged?(): void;
  restart(): void;
  quit(): void;
}

export function createMcpTools(deps: McpToolDependencies): McpTool[] {
  const c = deps.controller;
  const transfers = new McpFileTransfers(deps.files);
  const tools: McpTool[] = [];
  const add = (name: string, description: string, inputSchema: Schema, scopes: McpScope[], run: McpTool["run"], options: Partial<McpTool> = {}) => tools.push({ name: `mdd_${name}`, description, inputSchema, scopes, run, ...options });
  const read = (name: string, description: string, schema: Schema, run: McpTool["run"]) => add(name, description, schema, ["read"], run, { idempotent: true });
  const write = (name: string, description: string, schema: Schema, run: McpTool["run"], options: Partial<McpTool> = {}) => add(name, description, schema, ["control"], run, options);
  const snapshot = () => c.getSnapshot();
  const mustPackage = (id: unknown): string => { const key = String(id); if (!snapshot().session.packages[key]) throw new Error("Paket nicht gefunden."); return key; };
  const mustItems = (values: unknown): string[] => (values as string[]).map(id => { if (!snapshot().session.items[id]) throw new Error("Dateieintrag nicht gefunden."); return id; });
  const mustPackages = (values: unknown): string[] => (values as string[]).map(mustPackage);
  const artifacts = new Map<string, { data: Buffer; scopes: McpScope[]; expires: number }>();
  const jobs = new Map<string, { id: string; state: "running" | "completed" | "failed" | "cancelled"; bytes: number; total: number; startedAt: number; result?: unknown; error?: string; abort: AbortController }>();
  function artifact(data: Buffer, scopes: McpScope[]) {
    for (const [id, entry] of artifacts) if (entry.expires < Date.now()) artifacts.delete(id);
    if (data.length > 32_000_000 || artifacts.size >= 4) throw new Error("Exportlimit erreicht. Vorhandene Exporte zuerst schließen.");
    const id = crypto.randomUUID();
    artifacts.set(id, { data, scopes, expires: Date.now() + 600_000 });
    return { artifactId: id, bytes: data.length, sha256: crypto.createHash("sha256").update(data).digest("hex"), expiresInSeconds: 600 };
  }
  read("status", "Read application version, transfer status and counts without returning the whole queue.", object(), () => {
    const current = snapshot();
    return { version: c.getVersion(), session: { ...current.session, packages: undefined, items: undefined }, packageCount: Object.keys(current.session.packages).length, itemCount: Object.keys(current.session.items).length, stats: c.getSessionStats(), proxy: getNetworkProxyState() };
  });
  read("packages_list", "List packages with bounded pagination. Use IDs for actions.", object(page, []), args => paginate(Object.values(snapshot().session.packages), args));
  read("items_list", "List individual downloads, filtered by package or status, with bounded pagination.", object({ ...page, packageId: str(), status: str(50) }, []), args => paginate(Object.values(snapshot().session.items).filter(item => (!args.packageId || item.packageId === args.packageId) && (!args.status || item.status === args.status)), args));
  read("history_list", "Read persisted history with pagination.", object(page, []), args => paginate(c.getHistory(), args));
  read("statistics", "Read current session and all-time statistics.", object(), () => ({ session: c.getSessionStats(), allTime: { bytes: c.getSettings().totalDownloadedAllTime, files: c.getSettings().totalCompletedFilesAllTime, runtimeMs: c.getSettings().totalRuntimeAllTimeMs } }));
  read("settings_get", "Read non-secret settings. Secret values are never returned.", object(), () => createRendererSettings(c.getSettings()));
  read("accounts_list", "Read accounts and their known validation and usage status; credentials remain masked.", object(page, []), args => paginate(createRendererAccounts(c.getSettings()), args));
  read("providers", "Read provider runtime cooldowns, capacity and routing information.", object(), () => getProviderRuntimeSnapshot());
  read("performance", "Read bounded main-thread delay, CPU, memory, disk timings and connection/readback queue occupancy from memory without running host commands.", object(), () => ({ ...runtimePerformance.snapshot(), proxyTransfers: getProxyTransferSnapshot() }));
  read("errors", "Read the latest application warnings and errors.", object({ limit: integer(500, 1) }, []), args => getRecentErrors().slice(-Number(args.limit || 100)));
  read("diagnostics", "Run the existing local diagnostic checks. Does not change downloads.", object(), () => c.getDebugSetupCheck());
  read("host_diagnostics", "Read bounded Windows crash and host diagnostic information.", object(), () => getWindowsHostDiagnostics());
  read("notifications", "Read notification queue and incident status without webhook credentials.", object(), () => c.getNotificationSupportPayload());
  read("trace_get", "Read temporary diagnostic trace configuration.", object(), () => c.getTraceConfig());
  write("trace_set", "Enable a time-limited diagnostic trace or disable it.", object({ enabled: { type: "boolean" }, minutes: integer(120, 1) }, ["enabled"]), args => c.setTraceEnabled(Boolean(args.enabled), "MCP", Number(args.minutes || 15) * 60_000), { idempotent: true });
  read("logs_read", "Read a bounded, redacted tail of a known application log. Package/item logs require their ID.", object({ kind: { type: "string", enum: ["main", "audit", "rename", "session", "conversion", "trace", "package", "item"] }, id: str(), lines: integer(2000, 1), search: { type: "string", maxLength: 500 } }, ["kind"]), args => {
    const files: Record<string, () => string | null> = { main: getLogFilePath, audit: () => c.getAuditLogPath(), rename: () => c.getRenameLogPath(), session: getSessionLogPath, conversion: getConversionLogPath, trace: () => c.getTraceLogPath(), package: () => c.getPackageLogPath(mustPackage(args.id)), item: () => c.getItemLogPath(mustItems([String(args.id)])[0]) };
    return tail(files[String(args.kind)](), Number(args.lines || 200), String(args.search || ""));
  });
  read("collector_list", "List persisted link collector packages.", object(page, []), args => paginate(c.getCollectorState().packages, args));
  read("collector_inspect", "Parse link text without adding it to the queue.", object({ rawText: str(500_000) }), args => c.prepareCollectorText(validateCollectorTextPreparationRequest({ rawText: args.rawText, addedAt: Date.now() })));
  write("collector_replace", "Replace persisted collector state. Requires local confirmation because existing entries can be removed.", object({ state: { type: "object", additionalProperties: true } }), args => c.saveCollectorState(validateCollectorPersistenceState(args.state)), { destructive: true });
  write("links_add", "Add links to the download queue. Overwriting existing targets requires confirmation.", object({ rawText: str(500_000), packageName: str(500), duplicatePolicy: { type: "string", enum: ["keep", "skip", "overwrite"] } }, ["rawText"]), args => c.addLinks(args as unknown as AddLinksPayload), { destructive: args => args.duplicatePolicy === "overwrite", openWorld: true });
  write("queue_import", "Import a previously exported queue. Existing app validation applies.", object({ json: str(900_000) }), args => c.importQueue(String(args.json)), { destructive: true });
  read("queue_export", "Export queue state as a temporary paged artifact.", object(), () => artifact(Buffer.from(JSON.stringify(redact(JSON.parse(c.exportQueue()), deps.getSecrets()))), ["read"]));
  read("conflicts_list", "Read existing-file conflicts before starting downloads.", object(), () => c.getStartConflicts());
  write("conflict_resolve", "Resolve a target-file conflict for one package. Overwrite requires local confirmation.", object({ packageId: str(), policy: { type: "string", enum: ["keep", "skip", "overwrite"] } }), args => c.resolveStartConflict(mustPackage(args.packageId), args.policy as "keep" | "skip" | "overwrite"), { destructive: args => args.policy === "overwrite" });
  write("start", "Start the download queue using current settings and duplicate handling.", object(), () => deps.start ? deps.start() : c.start(), { openWorld: true });
  write("stop", "Stop current downloads through the existing scheduler.", object(), () => c.stop(), { idempotent: true });
  write("pause_toggle", "Toggle paused state. Read current status first; this operation is not idempotent.", object(), () => c.togglePause());
  write("packages_start", "Start the selected packages.", object({ packageIds: ids }), args => c.startPackages(mustPackages(args.packageIds)), { openWorld: true });
  write("items_start", "Start the selected file entries.", object({ itemIds: ids }), args => c.startItems(mustItems(args.itemIds)), { openWorld: true });
  write("package_toggle", "Enable or disable one package.", object({ packageId: str() }), args => c.togglePackage(mustPackage(args.packageId)));
  write("package_cancel", "Cancel one package; requires local confirmation.", object({ packageId: str() }), args => c.cancelPackage(mustPackage(args.packageId)), { destructive: true });
  write("package_rename", "Rename a package through the existing app action.", object({ packageId: str(), name: str(240) }), args => c.renamePackage(mustPackage(args.packageId), String(args.name)), { destructive: true });
  write("packages_reorder", "Set the package order using existing IDs.", object({ packageIds: ids }), args => c.reorderPackages(mustPackages(args.packageIds)));
  write("package_priority", "Set one package's scheduler priority.", object({ packageId: str(), priority: { type: "string", enum: ["low", "normal", "high"] } }), args => c.setPackagePriority(mustPackage(args.packageId), args.priority as PackagePriority), { idempotent: true });
  write("package_reset", "Reset a complete package, including already downloaded entries. Requires confirmation.", object({ packageId: str() }), args => c.resetPackage(mustPackage(args.packageId)), { destructive: true });
  write("items_reset", "Reset only explicitly selected entries. Requires confirmation.", object({ itemIds: ids }), args => c.resetItems(mustItems(args.itemIds)), { destructive: true });
  write("items_skip", "Skip selected file entries.", object({ itemIds: ids }), args => c.skipItems(mustItems(args.itemIds)), { destructive: true });
  write("item_remove", "Remove one file entry using the existing app action. Requires confirmation.", object({ itemId: str() }), args => c.removeItem(mustItems([String(args.itemId)])[0]), { destructive: true });
  write("offline_remove", "Remove offline archives or packages from the queue according to explicit scope.", object({ packageIds: ids, scope: { type: "string", enum: ["archive", "package"] } }), args => c.removeOfflinePackages(mustPackages(args.packageIds), args.scope as "archive" | "package"), { destructive: true });
  write("queue_clear", "Clear the complete queue through the existing application action. Requires confirmation.", object(), () => c.clearAll(), { destructive: true });
  write("extract_retry", "Retry failed extraction using the existing extraction and recovery logic. Local confirmation is required unless the separate extraction permission is enabled locally. Configured conflict and cleanup rules still apply.", object({ packageId: str() }), args => c.retryExtraction(mustPackage(args.packageId)), { destructive: true, confirmationBypassScope: "extraction" });
  write("extract_now", "Start extraction through the existing app logic and conflict settings. Local confirmation is required unless the separate extraction permission is enabled locally. Integrity checks and configured cleanup rules still apply.", object({ packageId: str() }), args => c.extractNow(mustPackage(args.packageId)), { destructive: true, confirmationBypassScope: "extraction" });
  write("history_remove", "Remove selected history records. Does not request arbitrary filesystem deletion.", object({ entryIds: ids }), args => { const known = new Set(c.getHistory().map(entry => entry.id)); if ((args.entryIds as string[]).some(id => !known.has(id))) throw new Error("Verlaufseintrag nicht gefunden."); return c.removeHistoryEntries(args.entryIds as string[]); }, { destructive: true });
  write("history_clear", "Clear persisted history. Requires confirmation.", object(), () => c.clearHistory(), { destructive: true });
  write("statistics_reset", "Reset session or all-time download statistics.", object({ scope: { type: "string", enum: ["session", "all-time"] } }), args => args.scope === "session" ? c.resetSessionStats() : c.resetDownloadStats(), { destructive: true });
  write("settings_update", "Change validated application settings. Filesystem roots, update source and MCP permissions cannot be expanded remotely; proxy-only cannot be disabled remotely.", object({ patch: { type: "object", additionalProperties: true } }), args => {
    const patch = args.patch as Record<string, unknown>;
    const blocked = ["outputDir", "extractDir", "mkvLibraryDir", "logStorageLocation", "proxyListPath", "updateRepo", "confirmDeleteSelection", "backupIncludeRemoteDiagnostics"];
    if (Object.keys(patch).some(key => blocked.includes(key)) || patch.proxyDownloadEnabled === false) throw new Error("Diese Sicherheits- oder Pfadeinstellung muss lokal geändert werden.");
    const validated = validateRendererSettingsUpdate(patch, c.getSettings());
    return deps.updateSettings(validated);
  }, { destructive: args => Object.keys(args.patch as object).some(key => /cleanup|remove|retention|historyMax|autoExtract|autoRename|Audio|extractConflict|rememberToken/i.test(key)), openWorld: true });
  write("accounts_check", "Validate configured accounts through the current proxy routing; technical failures do not invalidate credentials.", object({ scope: { type: "string", enum: ["active", "all"] } }, []), (args, context) => c.checkDebridAccounts(args.scope === "all" ? "all" : "active", context.signal), { openWorld: true });
  write("account_check", "Check one supported account's stored credentials or explicit new credentials.", object({ kind: { type: "string", enum: ["realdebrid-api", "realdebrid-web", "megadebrid-api", "megadebrid-web", "debridlink-api", "deepbrid-api"] }, accountId: str(), identity: str(512), secret: str(100_000) }, ["kind"]), (args, context) => c.checkAccountCredentials(validateAccountCredentialCheckInput(args), context.signal), { openWorld: true });
  const accountSchema = { kind: { type: "string", enum: kinds } as Schema, accountId: str(), identity: str(512), secret: str(100_000), dailyLimitBytes: integer(Number.MAX_SAFE_INTEGER) };
  for (const action of ["create", "replace", "update-secret", "delete"] as const) {
    const properties: Record<string, Schema> = action === "delete" ? { kind: accountSchema.kind, accountId: accountSchema.accountId } : action === "update-secret" ? { kind: accountSchema.kind, accountId: accountSchema.accountId, secret: accountSchema.secret } : action === "create" ? { kind: accountSchema.kind, identity: accountSchema.identity, secret: accountSchema.secret, dailyLimitBytes: accountSchema.dailyLimitBytes } : accountSchema;
    write(`account_${action.replace("-", "_")}`, `${action} an account through the existing validated account command. Credentials are never echoed.`, object(properties, action === "create" ? ["kind"] : action === "update-secret" ? ["kind", "accountId", "secret"] : ["kind", "accountId"]), async (args, context) => { const result = await c.executeAccountCommand(validateAccountCommand({ ...args, action }), context.signal); deps.accountsChanged?.(); return result; }, { destructive: action === "delete" || action === "replace", openWorld: action !== "delete" });
  }
  write("account_enabled", "Enable or disable an existing account without changing its credentials.", object({ accountId: str(), enabled: { type: "boolean" } }), args => {
    const settings = c.getSettings();
    const account = createRendererAccounts(settings).find(entry => entry.accountId === args.accountId);
    if (!account) throw new Error("Account nicht gefunden.");
    const field = account.provider === "realdebrid" ? "realDebridDisabledAccountIds" : account.provider === "debridlink" ? "debridLinkDisabledKeyIds" : account.provider === "megadebrid-api" ? "megaDebridApiDisabledAccountIds" : account.provider === "megadebrid-web" ? "megaDebridWebDisabledAccountIds" : "disabledProviders";
    const value = field === "disabledProviders" ? account.provider : account.accountId;
    const current = settings[field] as string[];
    const patch: Record<string, unknown> = { [field]: args.enabled ? current.filter(id => id !== value) : [...new Set([...current, value])] };
    if (args.enabled) {
      patch.disabledProviders = settings.disabledProviders.filter(provider => provider !== account.provider);
      if (account.provider === "megadebrid-api") patch.megaDebridApiEnabled = true;
      if (account.provider === "megadebrid-web") patch.megaDebridWebEnabled = true;
    }
    return deps.updateSettings(patch as RendererSettingsUpdate);
  }, { idempotent: true });
  write("provider_usage_reset", "Reset locally tracked daily provider usage, not the provider's actual remote quota.", object({ provider: { type: "string", enum: providers } }), args => createRendererSettings(c.resetProviderDailyUsage(args.provider as DebridProvider)), { destructive: true });
  write("key_usage_reset", "Reset locally tracked daily Debrid-Link key usage.", object({ keyId: str() }), args => createRendererSettings(c.resetDebridLinkApiKeyDailyUsage(String(args.keyId))), { destructive: true });
  add("account_secret_reveal", "Explicitly reveal exactly one stored account secret. Requires locally enabled secret access.", object({ kind: { type: "string", enum: kinds }, accountId: str() }), ["read", "secrets"], args => c.revealAccountSecret(validateAccountSecretRequest(args)), { reveal: true, destructive: true });
  add("archive_passwords_reveal", "Explicitly reveal configured archive passwords. Requires locally enabled secret access and confirmation.", object(), ["read", "secrets"], () => c.getArchivePasswordList(), { reveal: true, destructive: true });
  add("files_roots", "List the locally approved file roots. No arbitrary paths are accepted.", object(), ["read", "files"], () => deps.files.listRoots(), { idempotent: true });
  add("files_list", "List a directory under an approved root. Symbolic links and private app files are excluded.", object({ rootId: str(), relativePath: { type: "string", maxLength: 2048 }, offset: integer(10_000_000), limit: integer(200, 1) }, ["rootId"]), ["read", "files"], args => deps.files.list(String(args.rootId), String(args.relativePath || ""), Number(args.offset || 0), Number(args.limit || 100)), { idempotent: true });
  add("files_read", "Read at most 256 KiB of text from an approved root. Credential files and symbolic links are rejected.", object({ rootId: str(), relativePath: str(2048), offset: integer(Number.MAX_SAFE_INTEGER), length: integer(262_144, 1) }, ["rootId", "relativePath"]), ["read", "files"], args => deps.files.read(String(args.rootId), String(args.relativePath), Number(args.offset || 0), Number(args.length || 65536)), { idempotent: true });
  add("files_hash", "Compute SHA-256 for an approved file, with cancellation and concurrent-file-change detection.", object({ rootId: str(), relativePath: str(2048) }), ["read", "files"], (args, context) => deps.files.hash(String(args.rootId), String(args.relativePath), context.signal), { idempotent: true });
  add("files_transfer_open", "Prepare a complete binary file transfer from an approved root. Requires locally enabled complete-file transfer. The original stays unchanged. Poll files_transfer_get until ready; expires after one hour or ten idle minutes.", object({ rootId: str(), relativePath: str(2048) }), ["read", "files", "transfer"], async (args, context) => {
    const result = await transfers.open(String(args.rootId), String(args.relativePath), context.principalId, context.signal);
    const installationId = deps.getInstallationId?.();
    return { ...result, reference: installationId ? `media-mcp-file:v1:${Buffer.from(JSON.stringify({ v: 1, installationId, kind: "downloader", transferId: result.transferId })).toString("base64url")}` : undefined };
  }, { dispose: () => transfers.dispose(), format: formatTransferResult });
  add("files_transfer_get", "Read transfer preparation, size, source SHA-256 and expiry. Only the same authenticated installation principal can access it.", object({ transferId: str() }), ["read", "files", "transfer"], (args, context) => transfers.get(String(args.transferId), context.principalId), { idempotent: true, format: formatTransferResult });
  add("files_transfer_list", "List this principal's pending binary transfers without exposing source paths or credentials.", object(), ["read", "files", "transfer"], (_args, context) => transfers.list(context.principalId), { idempotent: true, format: formatTransferResult });
  add("files_transfer_read", "Read an exact binary range up to 1 MiB with a chunk SHA-256. Use a receiver script rather than putting base64 in conversation. Repeating a range is safe; no source bytes are changed.", object({ transferId: str(), offset: integer(Number.MAX_SAFE_INTEGER), length: integer(1_048_576, 1) }, ["transferId", "offset"]), ["read", "files", "transfer"], (args, context) => transfers.read(String(args.transferId), context.principalId, Number(args.offset), Number(args.length || 1_048_576), context.signal), { idempotent: true, binary: true, format: formatTransferResult });
  add("files_transfer_close", "Close a binary transfer and release its source handle. Does not remove the original file.", object({ transferId: str() }), ["read", "files", "transfer"], (args, context) => transfers.close(String(args.transferId), context.principalId));
  add("files_hash_start", "Start a background SHA-256 check for a large approved file. Poll jobs_get and cancel with jobs_cancel.", object({ rootId: str(), relativePath: str(2048) }), ["read", "files"], args => {
    for (const [id, job] of jobs) if (job.state !== "running" && job.startedAt < Date.now() - 3_600_000) jobs.delete(id);
    if ([...jobs.values()].filter(job => job.state === "running").length >= 2 || jobs.size >= 32) throw new Error("Prüfauftragslimit erreicht.");
    const id = crypto.randomUUID();
    const job: { id: string; state: "running" | "completed" | "failed" | "cancelled"; bytes: number; total: number; startedAt: number; result?: unknown; error?: string; abort: AbortController } = { id, state: "running", bytes: 0, total: 0, startedAt: Date.now(), abort: new AbortController() };
    jobs.set(id, job);
    void deps.files.hash(String(args.rootId), String(args.relativePath), AbortSignal.any([job.abort.signal, AbortSignal.timeout(1_800_000)]), (bytes, total) => { job.bytes = bytes; job.total = total; }).then(result => { job.result = result; job.state = "completed"; }, error => { job.error = String(redact(error instanceof Error ? error.message : "Prüfung fehlgeschlagen", deps.getSecrets())); job.state = job.abort.signal.aborted ? "cancelled" : "failed"; });
    return { jobId: id, state: job.state };
  }, { dispose: () => { for (const job of jobs.values()) job.abort.abort(); jobs.clear(); artifacts.clear(); } });
  add("jobs_list", "List background file checks without exposing paths or secrets.", object(), ["read", "files"], () => [...jobs.values()].map(({ abort, ...job }) => job), { idempotent: true });
  add("jobs_get", "Read the status, byte progress and result of one background file check.", object({ jobId: str() }), ["read", "files"], args => { const job = jobs.get(String(args.jobId)); if (!job) throw new Error("Prüfauftrag nicht gefunden."); const { abort, ...result } = job; return result; }, { idempotent: true });
  add("jobs_cancel", "Cancel one background read-only file check.", object({ jobId: str() }), ["read", "files"], args => { const job = jobs.get(String(args.jobId)); if (!job) throw new Error("Prüfauftrag nicht gefunden."); job.abort.abort(); return { cancelled: true }; }, { idempotent: true });
  add("containers_add", "Import a supported link container from an approved file root.", object({ rootId: str(), relativePath: str(2048) }), ["control", "files"], async args => c.addContainers([await deps.files.allowedPath(String(args.rootId), String(args.relativePath))]), { openWorld: true });
  write("update_check", "Check the application's configured update source.", object(), () => c.checkUpdates(), { openWorld: true, idempotent: true });
  read("update_status", "Read the persistent update job, progress and target-version verification after reconnecting. A disconnected MCP connection alone does not prove an update succeeded.", object(), () => deps.updates.status());
  if (deps.installerUploads) {
    const upload = deps.installerUploads;
    const manifest = object({ version: str(20), baseVersion: str(20), bytes: integer(268435456, 131072), sha256: str(64), expiresAt: integer(Number.MAX_SAFE_INTEGER), installationId: str(36), requestKey: str(128) });
    add("update_upload_begin", "Begin a signed, installation-bound installer upload without a public release. Requires the local updates grant. Only the pinned publisher key is trusted; no arbitrary paths or commands. Resume by repeating the identical signed manifest.", object({ manifest, signature: str(88) }), ["control", "updates"], (args, context) => upload.begin(args.manifest as unknown as InstallerManifest, String(args.signature), context.principalId), { idempotent: true });
    add("update_upload_chunk", "Upload one canonical base64 block, at most 512 KiB. Exact retries are safe; different repeated data or gaps are rejected. Do not print installer data in chat.", object({ uploadId: str(36), offset: integer(268435456), base64: str(699052) }), ["control", "updates"], (args, context) => upload.chunk(String(args.uploadId), context.principalId, Number(args.offset), String(args.base64)), { idempotent: true });
    add("update_upload_status", "Read upload progress. After commit use update_status to verify installation after restart.", object({ uploadId: str(36) }), ["control", "updates"], (args, context) => upload.status(String(args.uploadId), context.principalId), { idempotent: true });
    add("update_upload_commit", "Verify the complete signed installer and start the persistent update job without consulting GitHub. Requires exact base version and local updates grant. Allow interruption explicitly; settings/session are backed up before the fixed installer command runs. Verify completed and verifiedVersion after reconnect.", object({ uploadId: str(36), allowInterrupt: { type: "boolean" } }, ["uploadId"]), ["control", "updates"], (args, context) => upload.commit(String(args.uploadId), context.principalId, args.allowInterrupt === true, context.signal), { destructive: true, confirmationBypassScope: "updates", idempotent: true });
    add("update_upload_cancel", "Remove an uncommitted installer upload only. Cannot stop an installer already handed over.", object({ uploadId: str(36) }), ["control", "updates"], (args, context) => upload.cancel(String(args.uploadId), context.principalId));
  }
  write("update_install", "Start one persistent update job for an exact stable version. Requires local confirmation unless the separate updates permission is enabled locally. Poll update_status; after reconnecting verify completed and verifiedVersion. Reuse requestKey after an uncertain response; never submit a new key automatically. Downloads continue during preparation; allowInterrupt explicitly permits parking them for installation and restart.", object({ expectedVersion: { type: "string", pattern: "^\\d{1,6}\\.\\d{1,6}\\.\\d{1,6}$", maxLength: 20 }, requestKey: { type: "string", pattern: "^[A-Za-z0-9_-]{8,128}$", maxLength: 128 }, allowInterrupt: { type: "boolean" } }, ["expectedVersion", "requestKey"]), (args, context) => deps.updates.start(String(args.expectedVersion), String(args.requestKey), args.allowInterrupt === true, context.signal), { destructive: true, confirmationBypassScope: "updates", openWorld: true, idempotent: true });
  write("app_restart", "Restart this application only; requires local confirmation.", object(), () => { setTimeout(deps.restart, 1000); return { scheduled: true }; }, { destructive: true });
  write("app_quit", "Close this application only; requires local confirmation. MCP becomes unavailable until the app starts again.", object(), () => { setTimeout(deps.quit, 1000); return { scheduled: true }; }, { destructive: true });
  read("support_export", "Create an in-memory support ZIP with redacted text entries; does not include credentials.", object(), async () => {
    const source = await c.exportSupportBundle({ includeArchivePasswords: false });
    const zip = new AdmZip(source.buffer);
    for (const entry of zip.getEntries()) if (!entry.isDirectory) {
      const text = entry.getData().toString("utf8");
      let result: string;
      try { result = JSON.stringify(redact(JSON.parse(text), deps.getSecrets())); }
      catch { result = String(redact(text, deps.getSecrets())); }
      zip.updateFile(entry.entryName, Buffer.from(result));
    }
    return { fileName: source.defaultFileName, ...artifact(zip.toBuffer(), ["read"]) };
  });
  add("backup_export", "Export an encrypted backup as a temporary artifact. Secret-export permission and local confirmation are required.", object({ passphrase: str(1024) }), ["control", "secrets"], args => artifact(c.exportBackup(String(args.passphrase)), ["control", "secrets"]), { destructive: true });
  add("backup_restore", "Restore an encrypted backup supplied as base64. Requires local confirmation and does not import MCP credentials.", object({ base64: str(900_000), passphrase: str(1024) }), ["control", "secrets"], args => c.importBackup(Buffer.from(String(args.base64), "base64"), String(args.passphrase)), { destructive: true });
  add("online_backup_export", "Create an online backup and explicitly return its secret recovery key. Requires secret permission and confirmation.", object(), ["control", "secrets"], () => c.exportOnlineBackup(), { destructive: true, openWorld: true, reveal: true });
  add("online_backup_restore", "Restore settings from an explicitly supplied online backup key. Requires confirmation.", object({ key: str(100_000) }), ["control", "secrets"], args => c.importOnlineBackup(String(args.key)), { destructive: true, openWorld: true });
  add("artifact_read", "Read one bounded base64 chunk of a temporary export. Artifact-specific permissions are rechecked.", object({ artifactId: str(), offset: integer(32_000_000), length: integer(262_144, 1) }, ["artifactId"]), ["read"], args => {
    const entry = artifacts.get(String(args.artifactId));
    if (!entry || entry.expires < Date.now()) throw new Error("Export nicht vorhanden oder abgelaufen.");
    requireScopes(deps.getScopes(), entry.scopes);
    const offset = Number(args.offset || 0);
    const end = Math.min(entry.data.length, offset + Number(args.length || 65536));
    return { base64: entry.data.subarray(offset, end).toString("base64"), nextOffset: end < entry.data.length ? end : null, bytes: entry.data.length };
  }, { binary: true, idempotent: true });
  read("artifact_close", "Release one in-memory export immediately.", object({ artifactId: str() }), args => ({ removed: artifacts.delete(String(args.artifactId)) }));
  return tools;
}
