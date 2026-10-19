import crypto from "node:crypto";
import type { McpFiles } from "./files";
import { redact } from "./security";

type Source = Awaited<ReturnType<McpFiles["openBinary"]>>;
interface Transfer {
  id: string;
  principal: string;
  source: Source;
  state: "preparing" | "ready" | "failed";
  sha256: string | null;
  checkedBytes: number;
  expiresAt: number;
  touchedAt: number;
  abort: AbortController;
  task: Promise<void>;
  readers: number;
  closing: boolean;
}
const chunkBytes = 1_048_576;

export function formatTransferResult(value: unknown, secrets: string[]): unknown {
  if (Array.isArray(value)) {
    if (value.length > 4) throw new Error("Ungültige Transferliste.");
    return value.map(entry => formatTransferResult(entry, secrets));
  }
  const entry = value as Record<string, unknown>;
  const integer = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;
  if (!entry || typeof entry.transferId !== "string" || !/^[a-f0-9-]{36}$/.test(entry.transferId) || !integer(entry.bytes)) throw new Error("Ungültige Transferdaten.");
  if (Object.hasOwn(entry, "offset")) {
    if (!integer(entry.offset) || !integer(entry.bytesRead) || Number(entry.bytesRead) > chunkBytes || (entry.nextOffset !== null && !integer(entry.nextOffset)) || typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Ungültige Transferdaten.");
    return { transferId: entry.transferId, bytes: entry.bytes, offset: entry.offset, bytesRead: entry.bytesRead, nextOffset: entry.nextOffset, sha256: entry.sha256 };
  }
  if (!["preparing", "ready", "failed"].includes(String(entry.state)) || (entry.sha256 !== null && (typeof entry.sha256 !== "string" || !/^[a-f0-9]{64}$/.test(entry.sha256))) || !integer(entry.checkedBytes) || !integer(entry.expiresAt) || entry.chunkBytes !== chunkBytes || typeof entry.fileName !== "string" || (entry.reference !== undefined && (typeof entry.reference !== "string" || !/^media-mcp-file:v1:[A-Za-z0-9_-]{1,2048}$/.test(entry.reference)))) throw new Error("Ungültige Transferdaten.");
  return { transferId: entry.transferId, bytes: entry.bytes, state: entry.state, sha256: entry.sha256, checkedBytes: entry.checkedBytes, expiresAt: entry.expiresAt, chunkBytes, fileName: redact(entry.fileName, secrets), ...(entry.reference ? { reference: entry.reference } : {}) };
}

export class McpFileTransfers {
  private entries = new Map<string, Transfer>();
  private opening = 0;
  private closed = false;
  private timer: NodeJS.Timeout;
  constructor(private files: McpFiles, private now: () => number = Date.now) {
    this.timer = setInterval(() => this.sweep(), 30_000);
    this.timer.unref?.();
  }
  private expired(entry: Transfer): boolean { return this.now() >= entry.expiresAt || this.now() - entry.touchedAt >= 600_000; }
  private sweep(): void { for (const entry of this.entries.values()) if (this.expired(entry)) void this.release(entry); }
  private describe(entry: Transfer) {
    return { transferId: entry.id, fileName: entry.source.fileName, bytes: entry.source.stat.size, state: entry.state, sha256: entry.sha256, checkedBytes: entry.checkedBytes, expiresAt: entry.expiresAt, chunkBytes };
  }
  private find(id: string, principal: string): Transfer {
    const entry = this.entries.get(id);
    if (this.closed || !entry || entry.principal !== principal || entry.closing || this.expired(entry)) {
      if (entry && this.expired(entry)) void this.release(entry);
      throw new Error("Dateitransfer nicht vorhanden oder abgelaufen.");
    }
    entry.touchedAt = this.now();
    return entry;
  }
  private async release(entry: Transfer): Promise<void> {
    if (entry.closing) return;
    entry.closing = true;
    entry.abort.abort();
    this.entries.delete(entry.id);
    await entry.task;
    await entry.source.handle.close().catch(() => {});
  }
  async open(root: string, relative: string, principal: string, signal: AbortSignal) {
    this.sweep();
    signal.throwIfAborted();
    if (this.closed || this.entries.size + this.opening >= 4) throw new Error("Dateitransferlimit erreicht. Bestehende Transfers zuerst schließen.");
    this.opening++;
    let source: Source | undefined;
    try {
      source = await this.files.openBinary(root, relative, true);
      signal.throwIfAborted();
      if (this.closed || !Number.isSafeInteger(source.stat.size)) throw new Error("Dateitransfer nicht verfügbar.");
      await source.validate();
      const entry: Transfer = { id: crypto.randomUUID(), principal, source, state: "preparing", sha256: null, checkedBytes: 0, expiresAt: this.now() + 3_600_000, touchedAt: this.now(), abort: new AbortController(), task: Promise.resolve(), readers: 0, closing: false };
      this.entries.set(entry.id, entry);
      entry.task = this.prepare(entry);
      return this.describe(entry);
    } catch (error) { await source?.handle.close().catch(() => {}); throw error; }
    finally { this.opening--; }
  }
  private async prepare(entry: Transfer): Promise<void> {
    try {
      const signal = AbortSignal.any([entry.abort.signal, AbortSignal.timeout(1_800_000)]);
      const hash = crypto.createHash("sha256");
      const buffer = Buffer.alloc(chunkBytes);
      while (entry.checkedBytes < entry.source.stat.size) {
        signal.throwIfAborted();
        const { bytesRead } = await entry.source.handle.read(buffer, 0, Math.min(buffer.length, entry.source.stat.size - entry.checkedBytes), entry.checkedBytes);
        if (!bytesRead) throw new Error("Datei während der Prüfung verändert.");
        hash.update(buffer.subarray(0, bytesRead));
        entry.checkedBytes += bytesRead;
      }
      signal.throwIfAborted();
      await entry.source.validate();
      signal.throwIfAborted();
      entry.sha256 = hash.digest("hex");
      entry.state = "ready";
    } catch { entry.state = "failed"; entry.sha256 = null; }
  }
  async get(id: string, principal: string) {
    const entry = this.find(id, principal);
    try { await entry.source.validate(); }
    catch { entry.state = "failed"; entry.sha256 = null; entry.abort.abort(); }
    return this.describe(entry);
  }
  list(principal: string) { this.sweep(); return [...this.entries.values()].filter(entry => entry.principal === principal).map(entry => this.describe(entry)); }
  async read(id: string, principal: string, offset: number, length: number, signal: AbortSignal) {
    const entry = this.find(id, principal);
    if (entry.state !== "ready") throw new Error("Dateitransfer ist noch nicht bereit oder die Quelldatei wurde verändert.");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > entry.source.stat.size || !Number.isSafeInteger(length) || length < 1 || length > chunkBytes) throw new Error("Ungültiger Transferbereich.");
    if (entry.readers >= 2) throw new Error("Zu viele gleichzeitige Lesezugriffe.");
    entry.readers++;
    try {
      signal.throwIfAborted();
      await entry.source.validate();
      const buffer = Buffer.alloc(Math.min(length, entry.source.stat.size - offset));
      let read = 0;
      while (read < buffer.length) {
        signal.throwIfAborted();
        const { bytesRead } = await entry.source.handle.read(buffer, read, buffer.length - read, offset + read);
        if (!bytesRead) throw new Error("Datei während des Transfers verändert.");
        read += bytesRead;
      }
      await entry.source.validate();
      signal.throwIfAborted();
      if (entry.closing) throw new Error("Dateitransfer beendet.");
      return { transferId: id, offset, bytesRead: read, nextOffset: offset + read < entry.source.stat.size ? offset + read : null, bytes: entry.source.stat.size, sha256: crypto.createHash("sha256").update(buffer).digest("hex"), base64: buffer.toString("base64") };
    } catch (error) {
      if (!signal.aborted) { entry.state = "failed"; entry.sha256 = null; entry.abort.abort(); }
      throw error;
    } finally { entry.readers--; }
  }
  async close(id: string, principal: string) { const entry = this.find(id, principal); await this.release(entry); return { closed: true }; }
  dispose(): void { this.closed = true; clearInterval(this.timer); for (const entry of this.entries.values()) void this.release(entry); }
}
