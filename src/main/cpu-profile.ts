import { Session } from "node:inspector/promises";

interface ProfileNode {
  id: number;
  callFrame: { functionName: string; url: string; lineNumber: number; columnNumber: number };
  children?: number[];
}

export interface CpuProfile {
  nodes: ProfileNode[];
  startTime: number;
  endTime: number;
  samples?: number[];
  timeDeltas?: number[];
}

export interface CpuProfileEntry {
  function: string;
  location: string;
  ms: number;
  percent: number;
}

export interface CpuProfileSummary {
  durationMs: number;
  busyPercent: number;
  samples: number;
  topSelf: CpuProfileEntry[];
  topTotal: CpuProfileEntry[];
}

const IDLE_FRAMES = new Set(["(idle)", "(program)", "(root)"]);
let capturing = false;

function waitSeconds(seconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error("CPU-Profil abgebrochen."));
      return;
    }
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, seconds * 1000);
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(new Error("CPU-Profil abgebrochen."));
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function captureCpuProfile(seconds: number, signal: AbortSignal): Promise<CpuProfile> {
  if (capturing) throw new Error("Ein CPU-Profil läuft bereits.");
  capturing = true;
  const session = new Session();
  session.connect();
  try {
    await session.post("Profiler.enable");
    await session.post("Profiler.setSamplingInterval", { interval: 1000 });
    await session.post("Profiler.start");
    let stopped = false;
    try {
      await waitSeconds(Math.max(1, Math.min(60, Math.floor(seconds))), signal);
      const result = await session.post("Profiler.stop");
      stopped = true;
      return result.profile as unknown as CpuProfile;
    } finally {
      if (!stopped) await session.post("Profiler.stop").catch(() => undefined);
    }
  } finally {
    await session.post("Profiler.disable").catch(() => undefined);
    session.disconnect();
    capturing = false;
  }
}

function frameLabel(node: ProfileNode): { name: string; location: string } {
  const frame = node.callFrame;
  const file = frame.url ? frame.url.split(/[\/]/).slice(-2).join("/") : "";
  return { name: frame.functionName || "(anonymous)", location: file ? `${file}:${frame.lineNumber + 1}` : "" };
}

export function summarizeCpuProfile(profile: CpuProfile, limit = 40): CpuProfileSummary {
  const nodes = new Map(profile.nodes.map((node) => [node.id, node]));
  const parents = new Map<number, number>();
  for (const node of profile.nodes) for (const child of node.children || []) parents.set(child, node.id);
  const selfMicros = new Map<number, number>();
  const samples = profile.samples || [];
  const deltas = profile.timeDeltas || [];
  samples.forEach((id, index) => selfMicros.set(id, (selfMicros.get(id) || 0) + Math.max(0, deltas[index] || 0)));
  const durationMicros = Math.max(1, profile.endTime - profile.startTime);
  const self = new Map<string, number>();
  const total = new Map<string, number>();
  let busyMicros = 0;
  for (const [id, micros] of selfMicros) {
    const node = nodes.get(id);
    if (!node) continue;
    const { name, location } = frameLabel(node);
    if (IDLE_FRAMES.has(name)) continue;
    busyMicros += micros;
    const key = `${name}\u0000${location}`;
    self.set(key, (self.get(key) || 0) + micros);
    const seen = new Set<string>();
    for (let current: number | undefined = id; current !== undefined; current = parents.get(current)) {
      const ancestor = nodes.get(current);
      if (!ancestor) break;
      const label = frameLabel(ancestor);
      if (IDLE_FRAMES.has(label.name)) continue;
      const ancestorKey = `${label.name}\u0000${label.location}`;
      if (seen.has(ancestorKey)) continue;
      seen.add(ancestorKey);
      total.set(ancestorKey, (total.get(ancestorKey) || 0) + micros);
    }
  }
  const top = (values: Map<string, number>): CpuProfileEntry[] => Array.from(values)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([key, micros]) => {
      const [name, location] = key.split("\u0000");
      return { function: name, location, ms: Math.round(micros / 1000), percent: Math.round((micros / durationMicros) * 1000) / 10 };
    });
  return {
    durationMs: Math.round(durationMicros / 1000),
    busyPercent: Math.round((busyMicros / durationMicros) * 1000) / 10,
    samples: samples.length,
    topSelf: top(self),
    topTotal: top(total)
  };
}
