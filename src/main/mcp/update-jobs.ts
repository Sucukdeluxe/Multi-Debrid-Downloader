import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { McpScope } from "../../shared/mcp";
import type { UpdateCheckResult, UpdateInstallProgress, UpdateInstallResult } from "../../shared/types";

type UpdateState = "accepted" | "checking" | "downloading" | "verifying" | "installing" | "awaiting_restart" | "completed" | "failed" | "interrupted";
interface UpdateJob {
  id: string;
  requestKey: string;
  expectedVersion: string;
  fromVersion: string;
  state: UpdateState;
  createdAt: number;
  updatedAt: number;
  progress: UpdateInstallProgress | null;
  message: string;
  verifiedVersion?: string;
  installerSha256?: string;
}
export interface DirectInstaller { file: string; sha256: string; expectedVersion: string; validate(): void; }
export interface McpUpdateJobOptions {
  directory: string;
  version(): string;
  scopes(): McpScope[];
  authorizationId?(): string;
  supported(): boolean;
  running(): boolean;
  check(): Promise<UpdateCheckResult>;
  install(progress: (value: UpdateInstallProgress) => void, expectedVersion: string, beforeLaunch: () => Promise<void>): Promise<UpdateInstallResult>;
  installFile?(source: DirectInstaller, progress: (value: UpdateInstallProgress) => void, beforeLaunch: () => Promise<void>): Promise<UpdateInstallResult>;
  quit(): void;
}

const terminal = (state: UpdateState) => ["completed", "failed", "interrupted"].includes(state);
const validVersion = (value: unknown): value is string => typeof value === "string" && /^\d{1,6}\.\d{1,6}\.\d{1,6}$/.test(value);

export class McpUpdateJobs {
  private job: UpdateJob | null = null;
  private ready: Promise<void>;
  private writes = Promise.resolve();
  private executing = false;
  private loadError: string | null = null;
  private file: string;

  constructor(private options: McpUpdateJobOptions) {
    this.file = path.join(options.directory, "update-job.json");
    this.ready = this.load().catch(() => { this.loadError = "Gespeicherter Update-Auftrag konnte nicht geprüft werden. Keine neue Installation möglich."; });
  }

  private async load(): Promise<void> {
    try {
      if ((await fs.stat(this.file)).size > 32_768) throw new Error("Ungültiger Update-Auftrag.");
      const value = JSON.parse(await fs.readFile(this.file, "utf8")) as UpdateJob;
      if (!value || !/^[a-f0-9-]{36}$/.test(value.id) || !/^[A-Za-z0-9_-]{8,128}$/.test(value.requestKey) || !validVersion(value.expectedVersion) || !validVersion(value.fromVersion) || !Number.isFinite(value.createdAt) || !Number.isFinite(value.updatedAt) || !["accepted", "checking", "downloading", "verifying", "installing", "awaiting_restart", "completed", "failed", "interrupted"].includes(value.state)) throw new Error("Ungültiger Update-Auftrag.");
      this.job = value;
      if (!terminal(value.state)) {
        if (["installing", "awaiting_restart"].includes(value.state) && this.options.version() === value.expectedVersion) {
          value.state = "completed";
          value.verifiedVersion = this.options.version();
          value.message = "Zielversion nach dem Neustart bestätigt.";
        } else {
          value.state = "interrupted";
          value.message = "Update-Auftrag unterbrochen; Zielversion nicht bestätigt. Kein automatischer Wiederholungsversuch.";
        }
        await this.persist();
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  private persist(): Promise<void> {
    if (!this.job) return Promise.resolve();
    this.job.updatedAt = Date.now();
    const data = JSON.stringify(this.job);
    const write = this.writes.then(async () => {
      await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
      const temporary = `${this.file}.${randomUUID()}.tmp`;
      try {
        const handle = await fs.open(temporary, "wx", 0o600);
        try { await handle.writeFile(data); await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temporary, this.file);
      } finally { await fs.rm(temporary, { force: true }); }
    });
    this.writes = write.catch(() => {});
    return write;
  }

  public async status() {
    await this.ready;
    return {
      currentVersion: this.options.version(),
      supported: this.options.supported(),
      unattendedAllowed: this.options.scopes().includes("updates"),
      downloadsRunning: this.options.running(),
      error: this.loadError,
      job: this.job ? structuredClone(this.job) : null
    };
  }

  public async start(expectedVersion: string, requestKey: string, allowInterrupt: boolean, signal: AbortSignal) {
    return this.begin(expectedVersion, requestKey, allowInterrupt, signal);
  }

  public async startDirect(source: DirectInstaller, requestKey: string, allowInterrupt: boolean, signal: AbortSignal) {
    if (!this.options.installFile || !/^[a-f0-9]{64}$/.test(source.sha256)) throw new Error("Direkte Update-Installation nicht verfügbar.");
    source.validate();
    return this.begin(source.expectedVersion, requestKey, allowInterrupt, signal, source);
  }

  private async begin(expectedVersion: string, requestKey: string, allowInterrupt: boolean, signal: AbortSignal, source?: DirectInstaller) {
    await this.ready;
    signal.throwIfAborted();
    if (this.loadError) throw new Error(this.loadError);
    if (!validVersion(expectedVersion) || !/^[A-Za-z0-9_-]{8,128}$/.test(requestKey)) throw new Error("Ungültige Zielversion oder Auftragsreferenz.");
    if (this.job?.requestKey === requestKey) {
      if (this.job.expectedVersion !== expectedVersion) throw new Error("Auftragsreferenz gehört zu einer anderen Zielversion.");
      if ((this.job.installerSha256 || "") !== (source?.sha256 || "")) throw new Error("Auftragsreferenz gehört zu einem anderen Installationspaket.");
      return this.status();
    }
    if (this.executing || (this.job && !terminal(this.job.state))) throw new Error("Ein Update-Auftrag läuft bereits. Zuerst update_status abfragen.");
    if (!this.options.supported()) throw new Error("Unbeaufsichtigte Updates benötigen die installierte Windows-Version und das offizielle Update-Repository.");
    if (this.options.running() && !allowInterrupt) throw new Error("Downloads laufen. Für die kurze Unterbrechung beim Installerstart allowInterrupt ausdrücklich aktivieren.");
    const unattended = this.options.scopes().includes("updates");
    const authorizationId = this.options.authorizationId?.();
    const authorize = () => {
      source?.validate();
      const scopes = this.options.scopes();
      if (this.options.authorizationId?.() !== authorizationId) throw new Error("MCP-Freigabe wurde geändert oder der Schlüssel erneuert.");
      if (!scopes.includes("control") || (unattended && !scopes.includes("updates"))) throw new Error("MCP-Update-Berechtigung wurde entzogen.");
      if (!this.options.supported()) throw new Error("Update-Quelle oder Installationsmodus wurde geändert.");
      if (this.options.running() && !allowInterrupt) throw new Error("Downloads wurden inzwischen gestartet; Update nicht installiert.");
    };
    authorize();
    this.executing = true;
    this.job = { id: randomUUID(), requestKey, expectedVersion, fromVersion: this.options.version(), state: "accepted", createdAt: Date.now(), updatedAt: Date.now(), progress: null, message: "Update-Auftrag angenommen.", ...(source ? { installerSha256: source.sha256 } : {}) };
    try { await this.persist(); } catch (error) { this.executing = false; this.job = null; throw error; }
    void this.execute(authorize, source).finally(() => { this.executing = false; });
    return this.status();
  }

  private async execute(authorize: () => void, source?: DirectInstaller): Promise<void> {
    const job = this.job!;
    try {
      job.state = "checking";
      await this.persist();
      authorize();
      if (!source) {
        const check = await this.options.check();
        if (check.error) throw new Error(check.error);
        if (!check.updateAvailable || check.latestVersion !== job.expectedVersion) throw new Error("Die angebotene stabile Version stimmt nicht mit der angeforderten Zielversion überein.");
      }
      authorize();
      job.state = "downloading";
      await this.persist();
      const progress = (progress: UpdateInstallProgress) => {
        job.progress = progress;
        if (progress.stage === "verifying") job.state = "verifying";
      };
      const beforeLaunch = async () => {
        authorize();
        job.state = "installing";
        await this.persist();
        authorize();
      };
      const result = source
        ? await this.options.installFile!(source, progress, beforeLaunch)
        : await this.options.install(progress, job.expectedVersion, beforeLaunch);
      if (!result.started) throw new Error(result.message);
      job.state = "awaiting_restart";
      job.message = "Geprüfter Installer gestartet. Verbindung wird beim Neustart getrennt; danach update_status abfragen.";
      try { await this.persist(); } catch { job.message += " Abschlussstatus konnte nicht gespeichert werden; nach dem Neustart Zielversion prüfen."; }
      setTimeout(() => this.options.quit(), 1500).unref();
    } catch (error) {
      job.state = "failed";
      job.message = error instanceof Error ? error.message.slice(0, 2000) : "Update fehlgeschlagen.";
      try { await this.persist(); } catch { }
    }
  }
}
