import { EventEmitter } from "node:events";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { Worker } from "node:worker_threads";

type SerializedError = { message: string; code?: string | number; errno?: number; syscall?: string; path?: string; killed?: boolean; signal?: string };
type HostMessage = { type: string; id: number; pid?: number; data?: string; code?: number | null; signal?: NodeJS.Signals | null; error?: SerializedError | null; stdout?: string; stderr?: string };

export type HostedSpawnOptions = { windowsHide?: boolean; stdio?: "pipe" | "ignore" | Array<"pipe" | "ignore">; cwd?: string; env?: NodeJS.ProcessEnv };
export type HostedExecOptions = { windowsHide?: boolean; timeout?: number; maxBuffer?: number; encoding?: BufferEncoding; cwd?: string };
export type HostedExecCallback = (error: (Error & { code?: string | number | null; killed?: boolean; signal?: string | null }) | null, stdout: string, stderr: string) => void;

export interface HostedChildProcess extends EventEmitter {
  pid: number | undefined;
  readonly stdout: EventEmitter;
  readonly stderr: EventEmitter;
  readonly stdin: { write(data: string): boolean; end(): void };
  kill(signal?: NodeJS.Signals): boolean;
}

class WorkerChild extends EventEmitter implements HostedChildProcess {
  pid: number | undefined;
  readonly stdout = new EventEmitter();
  readonly stderr = new EventEmitter();
  readonly stdin: { write(data: string): boolean; end(): void };

  constructor(private readonly id: number, private readonly send: (message: object) => void) {
    super();
    this.stdin = {
      write: data => { send({ type: "stdin", id, data: String(data) }); return true; },
      end: () => send({ type: "stdin-end", id })
    };
  }

  kill(signal?: NodeJS.Signals): boolean {
    this.send({ type: "kill", id: this.id, signal });
    return true;
  }

  fail(error: Error): void {
    if (this.listenerCount("error")) this.emit("error", error);
  }
}

let worker: Worker | null = null;
let sequence = 0;
const children = new Map<number, WorkerChild>();
const execs = new Map<number, HostedExecCallback>();

function restoreError(error: SerializedError): Error & { code?: string | number; killed?: boolean; signal?: string } {
  return Object.assign(new Error(error.message), { code: error.code, errno: error.errno, syscall: error.syscall, path: error.path, killed: error.killed, signal: error.signal });
}

function workerFile(): string {
  const runtime = process as NodeJS.Process & { resourcesPath?: string; defaultApp?: boolean };
  if (runtime.resourcesPath && !runtime.defaultApp) return path.join(runtime.resourcesPath, "process-host-worker.cjs");
  const source = path.basename(path.dirname(__dirname)) === "src";
  return path.resolve(__dirname, source ? "../.." : "../../..", "resources", "process-host-worker.cjs");
}

function failAll(error: Error): void {
  const pending = [...children.values()];
  const callbacks = [...execs.values()];
  children.clear();
  execs.clear();
  for (const child of pending) {
    child.fail(error);
    child.emit("close", null, null);
  }
  for (const callback of callbacks) callback(error, "", "");
}

function dispatch(message: HostMessage): void {
  if (message.type === "exec") {
    const callback = execs.get(message.id);
    execs.delete(message.id);
    callback?.(message.error ? restoreError(message.error) : null, message.stdout || "", message.stderr || "");
    return;
  }
  const child = children.get(message.id);
  if (!child) return;
  if (message.type === "spawn") {
    child.pid = message.pid;
    child.emit("spawn");
  } else if (message.type === "stdout") child.stdout.emit("data", message.data);
  else if (message.type === "stderr") child.stderr.emit("data", message.data);
  else if (message.type === "error" && message.error) child.fail(restoreError(message.error));
  else if (message.type === "close") {
    children.delete(message.id);
    child.emit("exit", message.code ?? null, message.signal ?? null);
    child.emit("close", message.code ?? null, message.signal ?? null);
  }
}

function hostWorker(): Worker {
  if (worker) return worker;
  const created = new Worker(workerFile());
  created.on("message", dispatch);
  const lost = (): void => {
    if (worker !== created) return;
    worker = null;
    failAll(Object.assign(new Error("Prozesshost wurde beendet."), { code: "EPROCESSHOST" }));
  };
  created.on("error", lost);
  created.on("exit", lost);
  created.unref();
  worker = created;
  return created;
}

export function processHostEnabled(): boolean {
  if (process.env.MDD_PROCESS_HOST === "inline") return false;
  return Boolean(process.versions.electron) || process.env.MDD_PROCESS_HOST === "worker";
}

export function spawnHosted(command: string, args: string[], options: HostedSpawnOptions = {}): HostedChildProcess {
  if (!processHostEnabled()) return spawn(command, args, options) as unknown as HostedChildProcess;
  const host = hostWorker();
  const id = ++sequence;
  const child = new WorkerChild(id, message => { if (worker === host) host.postMessage(message); });
  children.set(id, child);
  host.postMessage({ type: "spawn", id, command, args, options });
  return child;
}

export function execFileHosted(file: string, args: string[], options: HostedExecOptions, callback: HostedExecCallback): void {
  if (!processHostEnabled()) {
    execFile(file, args, options, (error, stdout, stderr) => callback(error, String(stdout ?? ""), String(stderr ?? "")));
    return;
  }
  const host = hostWorker();
  const id = ++sequence;
  execs.set(id, callback);
  host.postMessage({ type: "exec", id, file, args, options });
}
