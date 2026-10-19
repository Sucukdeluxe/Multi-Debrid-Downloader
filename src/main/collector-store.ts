import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  COLLECTOR_MAX_PERSISTENCE_BYTES,
  validateCollectorPersistenceState,
  type CollectorPersistenceState
} from "../shared/collector";
import { logger } from "./logger";

const writeDelayMs = 300;
const renameRetryDelaysMs = [15, 40, 90];

interface CollectorPersistenceFile extends CollectorPersistenceState {
  version: 1;
  updatedAt: number;
}

function emptyState(): CollectorPersistenceState {
  return { packages: [], collapsedPackageIds: [] };
}

function cloneState(state: CollectorPersistenceState): CollectorPersistenceState {
  return structuredClone(state);
}

function renameErrorCode(error: unknown): string {
  return error && typeof error === "object" && "code" in error
    ? String((error as NodeJS.ErrnoException).code || "")
    : "";
}

function isTransientRenameError(error: unknown): boolean {
  return ["EPERM", "EACCES", "EBUSY"].includes(renameErrorCode(error));
}

function renameSyncWithRetry(tempPath: string, filePath: string): void {
  for (let attempt = 0; ; attempt += 1) {
    try {
      fs.renameSync(tempPath, filePath);
      return;
    } catch (error) {
      if (!isTransientRenameError(error) || attempt >= renameRetryDelaysMs.length) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, renameRetryDelaysMs[attempt]);
    }
  }
}

async function renameWithRetry(tempPath: string, filePath: string): Promise<void> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await fsp.rename(tempPath, filePath);
      return;
    } catch (error) {
      if (!isTransientRenameError(error) || attempt >= renameRetryDelaysMs.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, renameRetryDelaysMs[attempt]));
    }
  }
}

function parsePersistenceFile(filePath: string): CollectorPersistenceFile | null {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size > COLLECTOR_MAX_PERSISTENCE_BYTES) return null;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    if (Object.keys(parsed).some((key) => !["version", "packages", "collapsedPackageIds", "updatedAt"].includes(key))) return null;
    if (parsed.version !== 1 || typeof parsed.updatedAt !== "number" || !Number.isSafeInteger(parsed.updatedAt) || parsed.updatedAt < 0) return null;
    const state = validateCollectorPersistenceState({
      packages: parsed.packages,
      collapsedPackageIds: parsed.collapsedPackageIds
    });
    return { version: 1, updatedAt: parsed.updatedAt, ...state };
  } catch {
    return null;
  }
}

function serializeState(state: CollectorPersistenceState, updatedAt: number): string {
  const payload: CollectorPersistenceFile = {
    version: 1,
    packages: state.packages,
    collapsedPackageIds: state.collapsedPackageIds,
    updatedAt
  };
  return JSON.stringify(payload);
}

function atomicWriteSync(filePath: string, payload: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(tempPath, "w");
    fs.writeFileSync(descriptor, payload, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    renameSyncWithRetry(tempPath, filePath);
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try { fs.rmSync(tempPath, { force: true }); } catch {}
    throw error;
  }
}

async function atomicWrite(filePath: string, payload: string, isCurrent: () => boolean): Promise<boolean> {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  let handle: Awaited<ReturnType<typeof fsp.open>> | null = null;
  try {
    handle = await fsp.open(tempPath, "w");
    await handle.writeFile(payload, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;
    if (!isCurrent()) {
      await fsp.rm(tempPath, { force: true });
      return false;
    }
    await renameWithRetry(tempPath, filePath);
    return isCurrent();
  } catch (error) {
    if (handle) await handle.close().catch(() => {});
    await fsp.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

export class CollectorStore {
  private state: CollectorPersistenceState;
  private updatedAt = 0;
  private revision = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private activeWrite: Promise<void> | null = null;
  private retryAttempt = 0;

  public constructor(
    private readonly filePath: string,
    private readonly writeFile: typeof atomicWrite = atomicWrite
  ) {
    const primary = parsePersistenceFile(filePath);
    const backup = parsePersistenceFile(`${filePath}.bak`);
    const loaded = primary && (!backup || primary.updatedAt >= backup.updatedAt) ? primary : backup;
    this.state = loaded
      ? cloneState({ packages: loaded.packages, collapsedPackageIds: loaded.collapsedPackageIds })
      : emptyState();
    this.updatedAt = loaded?.updatedAt || 0;
    if (loaded === backup && backup && (!primary || backup.updatedAt > primary.updatedAt)) {
      try {
        this.writeSync();
      } catch {}
    }
  }

  public getState(): CollectorPersistenceState {
    return cloneState(this.state);
  }

  public update(state: CollectorPersistenceState): void {
    const nextState = validateCollectorPersistenceState(state);
    const nextUpdatedAt = Math.max(Date.now(), this.updatedAt + 1);
    if (Buffer.byteLength(serializeState(nextState, nextUpdatedAt), "utf8") > COLLECTOR_MAX_PERSISTENCE_BYTES) {
      throw new Error("Linksammler-Speicherzustand ist zu groß");
    }
    this.state = nextState;
    this.revision += 1;
    this.updatedAt = nextUpdatedAt;
    this.scheduleWrite(this.retryAttempt > 0 ? this.retryDelayMs() : writeDelayMs);
  }

  public flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.writeSync();
  }

  private retryDelayMs(): number {
    return Math.min(60_000, 1_000 * 2 ** Math.max(0, this.retryAttempt - 1));
  }

  private scheduleWrite(delayMs = writeDelayMs): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      this.enqueueWrite();
    }, delayMs);
    this.timer.unref?.();
  }

  private enqueueWrite(): void {
    const revision = this.revision;
    const state = cloneState(this.state);
    const updatedAt = this.updatedAt;
    const preceding = this.activeWrite || Promise.resolve();
    const write = preceding.catch(() => {}).then(async () => {
      const payload = serializeState(state, updatedAt);
      const isCurrent = () => revision === this.revision;
      const backupCurrent = await this.writeFile(`${this.filePath}.bak`, payload, isCurrent);
      if (!backupCurrent) return;
      const primaryCurrent = await this.writeFile(this.filePath, payload, isCurrent);
      if (!primaryCurrent) this.writeSync();
      else this.retryAttempt = 0;
    }).catch((error) => {
      if (revision === this.revision) {
        this.retryAttempt += 1;
        const retryMs = this.retryDelayMs();
        logger.warn(`Linksammler-Speicherung fehlgeschlagen, neuer Versuch in ${retryMs} ms: ${String(error)}`);
        this.scheduleWrite(retryMs);
      }
    }).finally(() => {
      if (this.activeWrite === write) this.activeWrite = null;
      if (revision !== this.revision && !this.timer) {
        try {
          this.writeSync();
        } catch {}
      }
    });
    this.activeWrite = write;
  }

  private writeSync(): void {
    const payload = serializeState(this.state, this.updatedAt || Date.now());
    atomicWriteSync(`${this.filePath}.bak`, payload);
    atomicWriteSync(this.filePath, payload);
  }
}
