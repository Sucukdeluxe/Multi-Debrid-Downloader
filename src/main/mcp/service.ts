import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { safeStorage } from "electron";
import type { AppController } from "../app-controller";
import type { McpConfiguration, McpCredentials, McpScope, McpStatus } from "../../shared/mcp";
import { collectAccountStatusRedactionValues } from "../account-status-sanitizer";
import { getNetworkProxyState } from "../network-proxy";
import { McpEndpoint } from "./endpoint";
import { McpFiles } from "./files";
import { createMcpTools, type McpToolDependencies } from "./tools";
import { RelayAgent } from "./relay-client";
import { validateRelayUrl } from "./security";

const DEFAULT_RELAY = "https://downloader.24-music.de/mcp-relay";
const defaults = (): McpConfiguration => ({ enabled: false, relayUrl: DEFAULT_RELAY, name: "Multi-Debrid-Downloader", scopes: ["read", "control", "files"], extraRoots: [] });
interface SecretsFile { current: McpCredentials | null; revocations: McpCredentials[]; configuration?: McpConfiguration; }
export interface McpServiceOptions extends Pick<McpToolDependencies, "updateSettings" | "restart" | "quit" | "start" | "accountsChanged"> {
  controller: AppController;
  baseDir: string;
  confirm(tool: string, summary: unknown, digest: string, signal: AbortSignal): Promise<boolean>;
}

export class McpService {
  private config = defaults();
  private secrets: SecretsFile = { current: null, revocations: [] };
  private connection: McpStatus["connection"] = "disabled";
  private lastContactAt: number | null = null;
  private activeRequests = 0;
  private error: string | null = null;
  private agent: RelayAgent | null = null;
  private endpoint: McpEndpoint | null = null;
  private lifecycle = Promise.resolve();
  private startup = new AbortController();
  private directory: string;
  private toolsCount = 0;
  private revision = 0;
  private retryTimer: NodeJS.Timeout | null = null;
  private revocationTimer: NodeJS.Timeout | null = null;
  private revocationTask: Promise<void> | null = null;
  private closed = false;
  constructor(private options: McpServiceOptions) {
    this.directory = path.join(options.baseDir, "mcp");
    try {
      const configFile = path.join(this.directory, "configuration.json");
      if (fs.existsSync(configFile)) this.config = this.validate(JSON.parse(fs.readFileSync(configFile, "utf8")));
      const secretsFile = path.join(this.directory, "identity.bin");
      if (fs.existsSync(secretsFile)) {
        if (!safeStorage.isEncryptionAvailable()) throw new Error("Die lokale Schlüsselverschlüsselung ist nicht verfügbar.");
        if (fs.statSync(secretsFile).size > 1_000_000) throw new Error("Ungültige MCP-Schlüsseldatei.");
        const loaded = JSON.parse(safeStorage.decryptString(fs.readFileSync(secretsFile)));
        if (!loaded || !Array.isArray(loaded.revocations) || loaded.revocations.length > 128 || (loaded.current !== null && typeof loaded.current !== "object")) throw new Error("Ungültige MCP-Schlüsseldatei.");
        this.secrets = loaded;
        if (this.secrets.configuration) this.config = this.validate(this.secrets.configuration);
        for (const entry of [this.secrets.current, ...this.secrets.revocations].filter(Boolean) as McpCredentials[]) this.validateCredentials(entry);
      }
      if (fs.existsSync(path.join(this.directory, "disabled.marker"))) {
        this.config.enabled = false;
        if (this.secrets.current) { this.secrets.revocations.push(this.secrets.current); this.secrets.current = null; }
      }
      if (this.config.enabled) void this.connect(this.revision);
      this.scheduleRevocations();
    } catch { this.secrets = { current: null, revocations: [] }; this.config.enabled = false; this.connection = "blocked"; this.error = "MCP-Konfiguration oder geschützter Schlüssel konnte nicht gelesen werden."; }
  }
  private validateCredentials(value: McpCredentials): void {
    if (!value || !/^[a-f0-9-]{36}$/.test(value.installationId) || !/^[A-Za-z0-9_-]{43}$/.test(value.agentToken) || !/^[A-Za-z0-9_-]{43}$/.test(value.clientToken)) throw new Error("Ungültige MCP-Identität.");
    validateRelayUrl(value.relayUrl);
  }
  private validate(value: unknown): McpConfiguration {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Ungültige MCP-Konfiguration.");
    const input = value as Record<string, unknown>;
    if (Object.keys(input).some(key => !["enabled", "relayUrl", "name", "scopes", "extraRoots"].includes(key)) || typeof input.enabled !== "boolean" || typeof input.name !== "string" || !input.name.trim() || input.name.length > 100 || !Array.isArray(input.scopes) || !Array.isArray(input.extraRoots) || input.extraRoots.length > 16) throw new Error("Ungültige MCP-Konfiguration.");
    const allowed = new Set(["read", "control", "files", "secrets"]);
    if (input.scopes.some(scope => typeof scope !== "string" || !allowed.has(scope)) || !input.scopes.includes("read")) throw new Error("Ungültige MCP-Berechtigungen.");
    if (input.extraRoots.some(root => typeof root !== "string" || !path.isAbsolute(root) || !fs.statSync(root).isDirectory())) throw new Error("Zusätzliche Dateifreigaben müssen vorhandene absolute Ordner sein.");
    return { enabled: input.enabled, name: input.name.trim(), relayUrl: validateRelayUrl(String(input.relayUrl)), scopes: [...new Set(input.scopes)] as McpScope[], extraRoots: [...new Set(input.extraRoots as string[])] };
  }
  private persist(): void {
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const disabledMarker = path.join(this.directory, "disabled.marker");
    if (!this.config.enabled) {
      const handle = fs.openSync(disabledMarker, "w", 0o600);
      try { fs.writeFileSync(handle, "disabled\n"); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
    }
    if (this.config.enabled && !safeStorage.isEncryptionAvailable()) throw new Error("MCP benötigt sichere lokale Schlüsselverschlüsselung.");
    const files: [string, Buffer][] = [];
    if (safeStorage.isEncryptionAvailable()) files.push(["identity.bin", safeStorage.encryptString(JSON.stringify({ ...this.secrets, configuration: this.config }))]);
    files.push(["configuration.json", Buffer.from(JSON.stringify(this.config))]);
    for (const [name, data] of files) {
      const temporary = path.join(this.directory, `${name}.${crypto.randomUUID()}.tmp`);
      try {
        const handle = fs.openSync(temporary, "wx", 0o600);
        try { fs.writeFileSync(handle, data); fs.fsyncSync(handle); } finally { fs.closeSync(handle); }
        fs.renameSync(temporary, path.join(this.directory, name));
      }
      finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
    }
    if (this.config.enabled && fs.existsSync(disabledMarker)) fs.unlinkSync(disabledMarker);
  }
  getStatus(): McpStatus {
    return { ...this.config, scopes: [...this.config.scopes], extraRoots: [...this.config.extraRoots], connection: this.connection, installationId: this.secrets.current?.installationId || null, activeRequests: this.activeRequests, lastContactAt: this.lastContactAt, error: this.error, toolCount: this.toolsCount };
  }
  private scopes(): McpScope[] { return !this.closed && this.config.enabled ? this.config.scopes : []; }
  private redactions(): string[] {
    return [...collectAccountStatusRedactionValues(this.options.controller.getSettings()), ...[this.secrets.current, ...this.secrets.revocations].filter(Boolean).flatMap(entry => [entry!.agentToken, entry!.clientToken])];
  }
  private audit(event: { tool: string; requestId: string; outcome: string; durationMs: number }): void {
    try {
      const file = path.join(this.directory, "audit.log");
      if (fs.existsSync(file) && fs.statSync(file).size > 2_000_000) fs.renameSync(file, `${file}.old`);
      fs.appendFileSync(file, `${JSON.stringify({ at: new Date().toISOString(), installationId: this.secrets.current?.installationId, ...event })}\n`, { mode: 0o600 });
    } catch { }
  }
  private async stopAgent(): Promise<void> {
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.startup.abort();
    const agent = this.agent;
    this.agent = null;
    await agent?.stop();
    await this.endpoint?.close();
    this.endpoint = null;
    this.activeRequests = 0;
  }
  private scheduleRevocations(): void {
    if (this.closed || this.revocationTimer || !this.secrets.revocations.length) return;
    this.revocationTimer = setTimeout(() => {
      this.revocationTimer = null;
      void this.revokePending().catch(() => {}).finally(() => this.scheduleRevocations());
    }, 60_000);
    this.revocationTimer.unref?.();
  }
  private revokePending(): Promise<void> {
    if (this.revocationTask) return this.revocationTask;
    this.revocationTask = (async () => {
      const done = new Set<string>();
      const budget = AbortSignal.timeout(8000);
      for (const credentials of [...this.secrets.revocations]) {
        if (budget.aborted || this.closed) break;
        try {
          const response = await fetch(`${credentials.relayUrl}/v1/agent/${credentials.installationId}`, { method: "DELETE", headers: { Authorization: `Bearer ${credentials.agentToken}` }, redirect: "error", signal: AbortSignal.any([budget, AbortSignal.timeout(5000)]) });
          await response.body?.cancel();
          if (response.ok || response.status === 401) done.add(credentials.installationId);
        } catch { }
      }
      this.secrets.revocations = this.secrets.revocations.filter(credentials => !done.has(credentials.installationId));
      this.persist();
    })().finally(() => { this.revocationTask = null; this.scheduleRevocations(); });
    return this.revocationTask;
  }
  private async activate(): Promise<void> {
    if (!this.config.enabled) return;
    this.startup = new AbortController();
    const signal = this.startup.signal;
    this.connection = "connecting";
    this.error = null;
    await this.revokePending();
    signal.throwIfAborted();
    if (!this.secrets.current) {
      this.secrets.current = { installationId: crypto.randomUUID(), agentToken: crypto.randomBytes(32).toString("base64url"), clientToken: crypto.randomBytes(32).toString("base64url"), relayUrl: this.config.relayUrl };
      this.persist();
    }
    const credentials = this.secrets.current;
    const response = await fetch(`${credentials.relayUrl}/v1/installations`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...credentials, relayUrl: undefined, kind: "downloader", name: this.config.name }), redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]) });
    await response.body?.cancel();
    if (!response.ok && response.status !== 409) throw new Error("MCP-Registrierung fehlgeschlagen.");
    signal.throwIfAborted();
    const c = this.options.controller;
    const files = new McpFiles(() => {
      const settings = c.getSettings();
      return [{ id: "output", path: settings.outputDir }, { id: "extract", path: settings.extractDir }, { id: "library", path: settings.mkvLibraryDir }, { id: "logs", path: c.getLogDirectory(), logsOnly: true }, ...this.config.extraRoots.map((root, i) => ({ id: `extra-${i + 1}`, path: root }))];
    });
    const tools = createMcpTools({ ...this.options, files, getScopes: () => this.scopes(), getSecrets: () => this.redactions() });
    this.toolsCount = tools.length;
    this.endpoint = new McpEndpoint({ name: "multi-debrid-downloader", version: c.getVersion(), tools, getScopes: () => this.scopes(), getSecrets: () => this.redactions(), confirm: this.options.confirm, audit: event => this.audit(event) });
    this.agent = new RelayAgent(credentials, this.endpoint, (state, count) => {
      if (this.closed || !this.config.enabled) return;
      this.connection = getNetworkProxyState().status === "blocked" ? "blocked" : state;
      this.activeRequests = count;
      if (state === "online") { this.lastContactAt = Date.now(); this.error = null; }
      else this.error = state === "blocked" ? "MCP-Zugang abgewiesen. Schlüssel erneuern oder deaktivieren." : "Vermittlungsdienst nicht erreichbar. Proxy und Netzwerk prüfen.";
    });
    this.agent.start();
  }
  private async connect(revision: number): Promise<void> {
    if (revision !== this.revision || !this.config.enabled) return;
    try { await this.activate(); }
    catch {
      if (revision !== this.revision || !this.config.enabled) return;
      this.connection = getNetworkProxyState().status === "blocked" ? "blocked" : "offline";
      this.error = "MCP konnte nicht verbunden werden. Proxy und Vermittlungsdienst prüfen.";
      this.retryTimer = setTimeout(() => { this.retryTimer = null; void this.connect(revision); }, 15_000);
      this.retryTimer.unref?.();
    }
  }
  configure(input: unknown, rotate = false): Promise<McpStatus> {
    if (this.closed) throw new Error("MCP wurde beendet.");
    const next = this.validate(input);
    if (next.enabled && !safeStorage.isEncryptionAvailable()) throw new Error("MCP benötigt sichere lokale Schlüsselverschlüsselung.");
    const revision = ++this.revision;
    this.startup.abort();
    if (!next.enabled) this.config.enabled = false;
    const operation = this.lifecycle.then(async () => {
      await this.stopAgent();
      if (revision !== this.revision) return this.getStatus();
      const old = this.secrets.current;
      if (old && (rotate || !next.enabled || old.relayUrl !== next.relayUrl)) {
        if (this.secrets.revocations.length >= 128) throw new Error("Zu viele ausstehende Schlüsselwiderrufe. Netzwerkverbindung wiederherstellen.");
        this.secrets.revocations.push(old);
        this.secrets.current = null;
      }
      this.config = next;
      this.persist();
      this.connection = next.enabled ? "connecting" : "disabled";
      this.error = null;
      if (next.enabled) {
        await this.connect(revision);
      } else await this.revokePending();
      return this.getStatus();
    });
    this.lifecycle = operation.then(() => {}, () => {});
    return operation;
  }
  connectionCode(): string {
    if (!this.config.enabled || !this.secrets.current) throw new Error("MCP ist nicht aktiviert.");
    const credentials = this.secrets.current;
    return `media-mcp:v1:${Buffer.from(JSON.stringify({ v: 1, url: `${credentials.relayUrl}/mcp/${credentials.installationId}`, installationId: credentials.installationId, kind: "downloader", name: this.config.name, token: credentials.clientToken })).toString("base64url")}`;
  }
  async shutdown(): Promise<void> {
    this.closed = true;
    if (this.revocationTimer) clearTimeout(this.revocationTimer);
    this.revocationTimer = null;
    ++this.revision;
    await this.stopAgent();
  }
}
