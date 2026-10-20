import { ExtractionLimiter } from "./extraction-limiter";
import { runtimePerformance } from "./runtime-performance";

type Stage = "downloadWrites" | "remux";
const limits = { downloadWrites: 8, remux: 1 };
const queues = {
  downloadWrites: new ExtractionLimiter("aborted", 32),
  remux: new ExtractionLimiter("aborted", 4)
};

export function getProcessingBudget() {
  return {
    downloadWrites: { ...queues.downloadWrites.snapshot(), limit: limits.downloadWrites },
    remux: { ...queues.remux.snapshot(), limit: limits.remux }
  };
}

export function setProcessingBudget(patch: Partial<typeof limits>) {
  for (const stage of ["downloadWrites", "remux"] as const) {
    const value = patch[stage];
    if (value !== undefined && (!Number.isInteger(value) || value < 1 || value > (stage === "remux" ? 4 : 32))) {
      throw new Error("Ungültiges I/O-Limit.");
    }
  }
  for (const stage of ["downloadWrites", "remux"] as const) {
    if (patch[stage] !== undefined) limits[stage] = patch[stage];
  }
  queues.downloadWrites.updateLimit(limits.downloadWrites);
  queues.remux.updateLimit(limits.remux);
  return getProcessingBudget();
}

export async function withProcessingBudget<T>(stage: Stage, signal: AbortSignal | undefined, action: () => Promise<T>): Promise<T> {
  const release = await runtimePerformance.measure(`io.${stage}.wait`, () => queues[stage].acquire(limits[stage], signal));
  try {
    if (signal?.aborted) throw new Error("aborted");
    return await action();
  } finally {
    release();
  }
}
