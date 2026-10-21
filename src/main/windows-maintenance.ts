import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { Worker } from "node:worker_threads";

type UpdateIdentity = { id: string; revision: number };
export type MaintenanceRequest = {
  action: "scan" | "install" | "package" | "restore" | "abort" | "reboot";
  requestKey: string;
  expectedBuild: string;
  backupConfirmed: boolean;
  scanId?: string;
  updates?: UpdateIdentity[];
  sourceJobId?: string;
  package?: { kb: string; url: string; sha256: string; size: number };
};
type Job = { id: string; action: MaintenanceRequest["action"]; state: string; startedAt: string; pid?: number; bootAt?: number; error?: string; result?: { updates?: UpdateIdentity[]; rebootRequired?: boolean; [key: string]: unknown } };
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const terminal = new Set(["completed", "failed"]);
const packageUrl = /^https:\/\/catalog\.s\.download\.windowsupdate\.com\/[a-z]\/msdownload\/update\/software\/[a-z]+\/\d{4}\/\d{2}\/windows10\.0-kb(\d{7})-x64_[0-9a-f]{40}\.msu$/;

function validate(request: MaintenanceRequest) {
  if (!request || Object.keys(request).some(key => !["action", "requestKey", "expectedBuild", "backupConfirmed", "scanId", "updates", "sourceJobId", "package"].includes(key))) throw Error("Ungültige Wartungsparameter.");
  if (!["scan", "install", "package", "restore", "abort", "reboot"].includes(request.action) || request.expectedBuild !== "20348" || request.backupConfirmed !== true || !/^[a-zA-Z0-9_-]{1,100}$/.test(request.requestKey)) throw Error("Wartung erfordert Windows Server 2022 und eine bestätigte VM-Sicherung.");
  if (request.action === "scan" && (request.updates || request.scanId || request.sourceJobId)) throw Error("Ungültiger Suchauftrag.");
  if (request.action === "package") {
    const item = request.package;
    const match = packageUrl.exec(item?.url || "");
    if (!item || typeof item !== "object" || Object.keys(item).some(key => !["kb", "url", "sha256", "size"].includes(key)) || !match || item.kb !== `KB${match[1]}` || !/^[0-9a-f]{64}$/.test(item.sha256) || !Number.isSafeInteger(item.size) || item.size < 1 || item.size > 4294967296 || request.scanId || request.updates || request.sourceJobId) throw Error("Ungültiges Updatepaket.");
  } else if (request.package !== undefined) throw Error("Ungültige Wartungsparameter.");
  if (request.action === "install") {
    if (!uuid.test(request.scanId || "") || request.sourceJobId || !Array.isArray(request.updates) || !request.updates.length || request.updates.length > 100) throw Error("Konkrete Updateauswahl fehlt.");
    const keys = new Set<string>();
    for (const update of request.updates) {
      if (Object.keys(update).some(key => !["id", "revision"].includes(key)) || !uuid.test(update.id) || !Number.isSafeInteger(update.revision) || update.revision < 1 || keys.has(update.id.toLowerCase())) throw Error("Ungültige Updateidentität.");
      keys.add(update.id.toLowerCase());
    }
  }
  if (["reboot", "restore"].includes(request.action) && (!uuid.test(request.sourceJobId || "") || request.scanId || request.updates)) throw Error("Ausgangsauftrag fehlt.");
  if (request.action === "abort" && (!uuid.test(request.sourceJobId || "") || (request.scanId && !uuid.test(request.scanId)) || request.updates)) throw Error("Abbruchauftrag fehlt.");
}

export function launchMaintenance(directory: string): Promise<void> {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || path.resolve(__dirname, "../../../resources");
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(resources, "windows-maintenance-worker.cjs"), { workerData: { directory } });
    worker.once("message", message => { worker.unref(); message.error ? reject(Error(message.error)) : resolve(); });
    worker.once("error", reject);
    worker.once("exit", code => { if (code) reject(Error("Wartungsstarter fehlgeschlagen.")); });
  });
}

export class WindowsMaintenance {
  private pending: Promise<unknown> = Promise.resolve();
  constructor(private readonly options: { root: string; platform?: string; launch?: (directory: string) => Promise<void> }) {}

  async get(id?: string): Promise<Job | { state: "idle"; id: "" }> {
    if (!id) {
      try { id = (JSON.parse(await fs.readFile(path.join(this.options.root, "current.json"), "utf8")) as { id: string }).id; }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return { state: "idle", id: "" }; throw error; }
    }
    if (!id || !uuid.test(id)) throw Error("Ungültiger Wartungsauftrag.");
    const job: Job = JSON.parse((await fs.readFile(path.join(this.options.root, id, "status.json"), "utf8")).replace(/^\uFEFF/, ""));
    if (job.state === "awaiting-reboot" && job.bootAt && Date.now() - os.uptime() * 1000 > job.bootAt + 60000) return { ...job, state: "completed", result: { ...job.result, rebootObserved: true } };
    return job;
  }

  start(request: MaintenanceRequest): Promise<Job> {
    const next = this.pending.then(() => this.startExclusive(request));
    this.pending = next.catch(() => {});
    return next;
  }

  private async startExclusive(request: MaintenanceRequest): Promise<Job> {
    validate(request);
    if ((this.options.platform || process.platform) !== "win32") throw Error("Windows-Wartung ist nur unter Windows verfügbar.");
    await fs.mkdir(this.options.root, { recursive: true });
    const entries = await fs.readdir(this.options.root);
    for (const entry of entries.filter(name => uuid.test(name))) {
      const previous = JSON.parse(await fs.readFile(path.join(this.options.root, entry, "request.json"), "utf8"));
      if (previous.requestKey === request.requestKey) {
        const { id: _id, ...original } = previous;
        if (JSON.stringify(original) !== JSON.stringify(request)) throw Error("Anfrageschlüssel wurde bereits anders verwendet.");
        return await this.get(entry) as Job;
      }
    }
    const current = await this.get();
    const abortsCurrent = request.action === "abort" && "id" in current && current.id === request.sourceJobId;
    if (current.state !== "idle" && !terminal.has(current.state) && !abortsCurrent) throw Error("Ein Wartungsauftrag läuft noch oder sein Abschluss ist ungeklärt.");
    if (request.action === "install") {
      const source = await this.get(request.scanId);
      if (!("action" in source) || source.action !== "scan" || source.state !== "completed" || !request.updates!.every(update => source.result?.updates?.some(known => known.id.toLowerCase() === update.id.toLowerCase() && known.revision === update.revision))) throw Error("Updateauswahl stimmt nicht mit dem abgeschlossenen Suchlauf überein.");
    }
    if (request.action === "reboot") {
      const source = await this.get(request.sourceJobId);
      if (!("action" in source) || !["install", "package"].includes(source.action) || !terminal.has(source.state) || source.result?.rebootRequired !== true) throw Error("Keine abgeschlossene Installation mit erforderlichem Neustart.");
    }
    if (["restore", "abort"].includes(request.action)) {
      const source = await this.get(request.sourceJobId);
      const serviceSource = request.action === "abort" && request.scanId ? await this.get(request.scanId) : source;
      if (!("result" in source) || !("result" in serviceSource) || !serviceSource.result?.servicesBefore || (request.action === "abort" && source.state !== "installing")) throw Error("Kein passender Wartungsauftrag vorhanden.");
    }
    const id = crypto.randomUUID();
    const directory = path.join(this.options.root, id);
    await fs.mkdir(directory);
    const job: Job = { id, action: request.action, state: "queued", startedAt: new Date().toISOString(), bootAt: Date.now() - os.uptime() * 1000 };
    await fs.writeFile(path.join(directory, "request.json"), JSON.stringify({ id, ...request }), { flag: "wx" });
    await fs.writeFile(path.join(directory, "status.json"), JSON.stringify(job), { flag: "wx" });
    await fs.writeFile(path.join(this.options.root, "current.tmp"), JSON.stringify({ id }));
    await fs.rename(path.join(this.options.root, "current.tmp"), path.join(this.options.root, "current.json"));
    try { await (this.options.launch || launchMaintenance)(directory); }
    catch (error) { job.state = "failed"; job.error = error instanceof Error ? error.message : "Wartung konnte nicht gestartet werden."; await fs.writeFile(path.join(directory, "status.json"), JSON.stringify(job)); }
    return await this.get(id) as Job;
  }
}
