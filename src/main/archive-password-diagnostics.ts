import fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { CredentialProtector } from "./credential-protection";

export type ArchivePasswordAttemptEvent = {
  attemptId: string;
  archivePath: string;
  packageId?: string;
  backend: string;
  phase: "started" | "finished";
  attempt: number;
  total: number;
  password: string;
  outcome?: "success" | "wrong_password" | "crc_error" | "error" | "aborted" | "timeout";
  durationMs?: number;
};

type PasswordState = "encrypted" | "empty" | "encryption_unavailable" | "encryption_failed" | "password_too_long";
type AttemptMetadata = Omit<ArchivePasswordAttemptEvent, "password"> & {
  recordedAt: string;
  candidateId: string;
  passwordState: PasswordState;
};
type Envelope = { type: "safe-storage"; payload: string };
type Store = { version: 1; events: AttemptMetadata[]; candidates: Record<string, Envelope>; droppedEvents: number };
type Pending = { event: AttemptMetadata; envelope?: Envelope };
type Context = {
  baseDir: string;
  protector?: CredentialProtector;
  store: Store;
  loaded: boolean;
  pending: Pending[];
  processing?: Promise<void>;
  storageState: "available" | "empty" | "read_failed" | "write_failed" | "unsafe_path";
};

const MAX_EVENTS = 5000;
const MAX_FILE_BYTES = 4 * 1024 * 1024;
const MAX_PASSWORD_BYTES = 8192;
const MAX_ENVELOPE_BYTES = 32 * 1024;
const DIRECTORY_NAME = "archive-password-diagnostics";
const FILE_NAME = "attempts.json";
const outcomes = new Set(["success", "wrong_password", "crc_error", "error", "aborted", "timeout"]);
const passwordStates = new Set(["encrypted", "empty", "encryption_unavailable", "encryption_failed", "password_too_long"]);
const contexts = new Map<string, Context>();
let activeContext: Context | undefined;

function pathKey(value: string): string {
  const resolved = path.resolve(value);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function emptyStore(): Store {
  return { version: 1, events: [], candidates: Object.create(null), droppedEvents: 0 };
}

function contextFor(baseDir: string): Context {
  const key = pathKey(baseDir);
  let context = contexts.get(key);
  if (!context) {
    context = { baseDir: path.resolve(baseDir), store: emptyStore(), loaded: false, pending: [], storageState: "empty" };
    contexts.set(key, context);
  }
  return context;
}

function boundedText(value: unknown, maximum: number): string {
  return typeof value === "string" ? value.slice(0, maximum) : "";
}

function metadataFrom(value: unknown): AttemptMetadata | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  if (!source.attemptId || !source.archivePath || !source.backend
    || (source.phase !== "started" && source.phase !== "finished")
    || typeof source.candidateId !== "string" || !/^[a-f0-9-]{36}$/i.test(source.candidateId)
    || !passwordStates.has(String(source.passwordState))) return null;
  const event: AttemptMetadata = {
    attemptId: boundedText(source.attemptId, 128),
    archivePath: boundedText(source.archivePath, 2048),
    backend: boundedText(source.backend, 80),
    phase: source.phase,
    attempt: Math.max(0, Math.min(1_000_000, Math.floor(Number(source.attempt) || 0))),
    total: Math.max(0, Math.min(1_000_000, Math.floor(Number(source.total) || 0))),
    candidateId: source.candidateId,
    recordedAt: boundedText(source.recordedAt, 40),
    passwordState: source.passwordState as PasswordState
  };
  if (source.packageId) event.packageId = boundedText(source.packageId, 128);
  if (outcomes.has(String(source.outcome))) event.outcome = source.outcome as ArchivePasswordAttemptEvent["outcome"];
  if (Number.isFinite(source.durationMs)) event.durationMs = Math.max(0, Math.min(86_400_000, Number(source.durationMs)));
  return event;
}

function trimStore(store: Store): void {
  if (store.events.length > MAX_EVENTS) {
    store.droppedEvents += store.events.length - MAX_EVENTS;
    store.events.splice(0, store.events.length - MAX_EVENTS);
  }
  const used = new Set(store.events.map(event => event.candidateId));
  for (const key of Object.keys(store.candidates)) {
    if (!used.has(key)) delete store.candidates[key];
  }
}

async function safeDirectory(context: Context, create: boolean): Promise<string | null> {
  if (create) await fs.mkdir(context.baseDir, { recursive: true, mode: 0o700 });
  const base = await fs.realpath(context.baseDir);
  const directory = path.join(base, DIRECTORY_NAME);
  if (path.dirname(directory) !== base) throw new Error("unsafe_path");
  let stat = await fs.lstat(directory).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (!stat && create) {
    await fs.mkdir(directory, { mode: 0o700 });
    stat = await fs.lstat(directory);
  }
  if (!stat) return null;
  if (!stat.isDirectory() || stat.isSymbolicLink() || pathKey(await fs.realpath(directory)) !== pathKey(directory)) {
    throw new Error("unsafe_path");
  }
  return directory;
}

async function safeTarget(directory: string): Promise<string> {
  const target = path.join(directory, FILE_NAME);
  const stat = await fs.lstat(target).catch(error => {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  });
  if (stat && (!stat.isFile() || stat.isSymbolicLink() || stat.nlink > 1)) throw new Error("unsafe_path");
  return target;
}

async function load(context: Context): Promise<void> {
  if (context.loaded) return;
  context.loaded = true;
  try {
    const directory = await safeDirectory(context, false);
    if (!directory) return;
    const target = await safeTarget(directory);
    const before = await fs.lstat(target);
    const handle = await fs.open(target, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    try {
      const stat = await handle.stat();
      if (!stat.isFile() || stat.ino !== before.ino || stat.dev !== before.dev || stat.nlink > 1) throw new Error("unsafe_path");
      if (stat.size > MAX_FILE_BYTES) throw new Error("invalid_store");
      const buffer = Buffer.alloc(stat.size + 1);
      let length = 0;
      while (length < buffer.length) {
        const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
        if (!bytesRead) break;
        length += bytesRead;
      }
      const after = await fs.lstat(target);
      if (after.isSymbolicLink() || after.ino !== stat.ino || after.dev !== stat.dev) throw new Error("unsafe_path");
      if (length !== stat.size || after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error("invalid_store");
      const value = JSON.parse(buffer.subarray(0, length).toString("utf8"));
      if (value?.version !== 1 || !Array.isArray(value.events) || value.events.length > MAX_EVENTS
        || !value.candidates || typeof value.candidates !== "object" || Array.isArray(value.candidates)) throw new Error("invalid_store");
      const store = emptyStore();
      store.events = value.events.map(metadataFrom);
      if (store.events.some(event => !event)) throw new Error("invalid_store");
      store.droppedEvents = Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Number(value.droppedEvents) || 0));
      for (const [id, raw] of Object.entries(value.candidates)) {
        const envelope = raw as Envelope;
        if (!/^[a-f0-9-]{36}$/i.test(id) || envelope?.type !== "safe-storage"
          || typeof envelope.payload !== "string" || !envelope.payload.length
          || envelope.payload.length > MAX_ENVELOPE_BYTES || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.payload)) throw new Error("invalid_store");
        store.candidates[id] = { type: "safe-storage", payload: envelope.payload };
      }
      trimStore(store);
      store.droppedEvents += context.store.droppedEvents;
      context.store = store;
      context.storageState = "available";
    } finally {
      await handle.close();
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    context.storageState = (error as Error).message === "unsafe_path" ? "unsafe_path" : "read_failed";
  }
}

async function persist(context: Context): Promise<void> {
  if (context.storageState === "read_failed" || context.storageState === "unsafe_path") return;
  let temporary: string | undefined;
  try {
    trimStore(context.store);
    let payload = JSON.stringify(context.store);
    while (Buffer.byteLength(payload) > MAX_FILE_BYTES && context.store.events.length) {
      context.store.events.shift();
      context.store.droppedEvents += 1;
      trimStore(context.store);
      payload = JSON.stringify(context.store);
    }
    const directory = await safeDirectory(context, true);
    if (!directory) throw new Error("unsafe_path");
    const target = await safeTarget(directory);
    temporary = path.join(directory, `${FILE_NAME}.${randomUUID()}.tmp`);
    await fs.writeFile(temporary, payload, { flag: "wx", mode: 0o600 });
    if (await safeDirectory(context, false) !== directory) throw new Error("unsafe_path");
    await safeTarget(directory);
    await fs.rename(temporary, target);
    temporary = undefined;
    context.storageState = "available";
  } catch (error) {
    context.storageState = (error as Error).message === "unsafe_path" ? "unsafe_path" : "write_failed";
  } finally {
    if (temporary) {
      const directory = await safeDirectory(context, false).catch(() => null);
      if (directory === path.dirname(temporary)) await fs.rm(temporary, { force: true }).catch(() => undefined);
    }
  }
}

function schedule(context: Context): void {
  if (context.processing) return;
  const processing = (async () => {
    await load(context);
    while (context.pending.length) {
      const attemptKey = (event: AttemptMetadata): string => JSON.stringify([event.attemptId, event.archivePath, event.backend]);
      const candidates = new Map(context.store.events.map(event => [attemptKey(event), event.candidateId]));
      for (const pending of context.pending.splice(0)) {
        const key = attemptKey(pending.event);
        const previous = candidates.get(key);
        if (previous) pending.event.candidateId = previous;
        candidates.set(key, pending.event.candidateId);
        context.store.events.push(pending.event);
        if (pending.envelope) context.store.candidates[pending.event.candidateId] = pending.envelope;
      }
      trimStore(context.store);
      await persist(context);
    }
  })().catch(() => { context.storageState = "write_failed"; }).finally(() => {
    if (context.processing === processing) context.processing = undefined;
    if (context.pending.length) schedule(context);
  });
  context.processing = processing;
}

export function configureArchivePasswordDiagnostics(baseDir: string, protector: CredentialProtector): void {
  try {
    activeContext = contextFor(baseDir);
    activeContext.protector = protector;
    schedule(activeContext);
  } catch {
    activeContext = undefined;
  }
}

export function recordArchivePasswordAttempt(event: ArchivePasswordAttemptEvent): void {
  try {
    const context = activeContext;
    if (!context || !event || typeof event.password !== "string") return;
    let state: PasswordState = event.password ? "encryption_unavailable" : "empty";
    let envelope: Envelope | undefined;
    if (event.password) {
      if (Buffer.byteLength(event.password) > MAX_PASSWORD_BYTES) state = "password_too_long";
      else {
        try {
          if (context.protector?.isEncryptionAvailable()) {
            const payload = context.protector.encryptString(event.password).toString("base64");
            if (!payload.length || payload.length > MAX_ENVELOPE_BYTES) throw new Error("invalid_ciphertext");
            envelope = { type: "safe-storage", payload };
            state = "encrypted";
          }
        } catch {
          state = "encryption_failed";
        }
      }
    }
    const metadata = metadataFrom({ ...event, recordedAt: new Date().toISOString(), candidateId: randomUUID(), passwordState: state });
    if (!metadata) return;
    if (context.pending.length >= MAX_EVENTS) {
      context.pending.shift();
      context.store.droppedEvents += 1;
    }
    context.pending.push({ event: metadata, envelope });
    schedule(context);
  } catch {
  }
}

export async function flushArchivePasswordDiagnostics(): Promise<void> {
  try {
    await Promise.all([...contexts.values()].map(context => context.processing));
  } catch {
  }
}

export async function readArchivePasswordDiagnostics(baseDir: string, includePasswords = false): Promise<object> {
  try {
    const context = contextFor(baseDir);
    schedule(context);
    await context.processing;
    let unavailablePasswords = 0;
    const events = context.store.events.map(event => {
      const result: AttemptMetadata & { password?: string; passwordDisclosure?: string } = { ...event };
      if (includePasswords === true) {
        if (event.passwordState === "empty") result.password = "";
        else {
          try {
            const envelope = context.store.candidates[event.candidateId];
            if (!envelope || !context.protector?.isEncryptionAvailable()) throw new Error("unavailable");
            const password = context.protector.decryptString(Buffer.from(envelope.payload, "base64"));
            if (typeof password !== "string" || Buffer.byteLength(password) > MAX_PASSWORD_BYTES) throw new Error("unavailable");
            result.password = password;
          } catch {
            result.passwordDisclosure = "unavailable";
            unavailablePasswords += 1;
          }
        }
      }
      return result;
    });
    return {
      version: 1,
      storageState: context.storageState,
      configured: Boolean(context.protector),
      passwordsIncluded: includePasswords === true,
      unavailablePasswords,
      droppedEvents: context.store.droppedEvents,
      limits: { maxEvents: MAX_EVENTS, maxFileBytes: MAX_FILE_BYTES },
      events
    };
  } catch {
    return { version: 1, storageState: "read_failed", passwordsIncluded: includePasswords === true, events: [] };
  }
}
