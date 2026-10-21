import path from "node:path";
import { Worker } from "node:worker_threads";

type ProbeMode = "inspect" | "file-test" | "windows-detail" | "native-file-test" | "defender-trace";
type ProbeState = { state: "idle" | "running" | "completed" | "failed"; mode?: ProbeMode; startedAt?: number; completedAt?: number; result?: unknown; error?: string };
let active: Worker | null = null;
let state: ProbeState = { state: "idle" };

export function getStorageProbe(): ProbeState { return structuredClone(state); }

export function startStorageProbe(mode: ProbeMode): ProbeState {
  if (active) throw Error("Eine Speicherprüfung läuft bereits.");
  if (!["inspect", "file-test", "windows-detail", "native-file-test", "defender-trace"].includes(mode)) throw Error("Ungültige Speicherprüfung.");
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  const file = resources ? path.join(resources, "storage-probe-worker.cjs") : path.resolve(__dirname, "../../../resources/storage-probe-worker.cjs");
  const worker = new Worker(file, { workerData: { mode } });
  active = worker;
  state = { state: "running", mode, startedAt: Date.now() };
  worker.on("message", (message: { result?: unknown; error?: string }) => {
    if (active !== worker) return;
    state = { ...state, state: message.error ? "failed" : "completed", completedAt: Date.now(), ...(message.error ? { error: message.error } : { result: message.result }) };
  });
  worker.on("error", () => { if (active === worker) state = { ...state, state: "failed", error: "Speicherprüfung fehlgeschlagen.", completedAt: Date.now() }; });
  worker.on("exit", () => {
    if (active !== worker) return;
    if (state.state === "running") state = { ...state, state: "failed", error: "Speicherprüfung ohne Ergebnis beendet.", completedAt: Date.now() };
    active = null;
  });
  return getStorageProbe();
}

export function cancelStorageProbe() { active?.postMessage("cancel"); return { requested: Boolean(active) }; }
