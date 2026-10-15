import fs from "node:fs";
import path from "node:path";
import { runtimePerformance } from "./runtime-performance";
import { logger } from "./logger";

const writes = new Map<string, Promise<void>>();
const waiting: Array<() => void> = [];
const MAX_PENDING_BYTES = 16 * 1024 * 1024;
let activeWrites = 0;
let pendingBytes = 0;
let droppedBytes = 0;
let overflowReported = false;

async function acquireWriteSlot(): Promise<() => void> {
  if (activeWrites >= 2) await new Promise<void>(resolve => waiting.push(resolve));
  else activeWrites++;
  return () => {
    const next = waiting.shift();
    if (next) next();
    else activeWrites--;
  };
}

export function getDiagnosticLogWriterState() {
  return { files: writes.size, activeWrites, waiting: waiting.length, pendingBytes, droppedBytes, maxPendingBytes: MAX_PENDING_BYTES };
}

export function hasPendingDiagnosticLogWrites(filePath: string): boolean {
  return writes.has(filePath);
}

export function appendDiagnosticLog(filePath: string, text: string, maxBytes?: number): Promise<void> {
  const bytes = Buffer.byteLength(text, "utf8");
  if (pendingBytes + bytes > MAX_PENDING_BYTES) {
    droppedBytes += bytes;
    if (!overflowReported) {
      overflowReported = true;
      logger.warn("Diagnoseprotokolle: Schreibwarteschlange voll; weitere Logdaten werden verworfen, bis wieder Platz frei ist.");
    }
    return Promise.resolve();
  }
  pendingBytes += bytes;
  const previous = writes.get(filePath) ?? Promise.resolve();
  const task = previous.then(async () => {
    const release = await acquireWriteSlot();
    try {
      await runtimePerformance.measure("log.write", async () => {
        if (maxBytes !== undefined) {
          try {
            if ((await fs.promises.stat(filePath)).size >= maxBytes) {
              await fs.promises.rm(`${filePath}.old`, { force: true });
              await fs.promises.rename(filePath, `${filePath}.old`);
            }
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        try {
          await fs.promises.appendFile(filePath, text, { encoding: "utf8", mode: 0o600 });
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          await fs.promises.mkdir(path.dirname(filePath), { recursive: true });
          await fs.promises.appendFile(filePath, text, { encoding: "utf8", mode: 0o600 });
        }
      });
    } finally {
      release();
    }
  }).catch(() => {}).finally(() => {
    pendingBytes -= bytes;
    if (!pendingBytes) overflowReported = false;
    if (writes.get(filePath) === task) writes.delete(filePath);
  });
  writes.set(filePath, task);
  return task;
}

export function finishDiagnosticLog(filePath: string, text: string): void | Promise<void> {
  if (writes.has(filePath)) return appendDiagnosticLog(filePath, text);
  try { fs.appendFileSync(filePath, text, "utf8"); } catch {}
}

export async function flushDiagnosticLogWrites(filePath?: string): Promise<void> {
  if (filePath) { await writes.get(filePath); return; }
  while (writes.size) await Promise.all([...writes.values()]);
}
