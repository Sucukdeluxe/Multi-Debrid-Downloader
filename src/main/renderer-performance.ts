export class RendererPerformance {
  private samples: Record<string, number | boolean>[] = [];

  record(input: unknown): void {
    if (!input || typeof input !== "object") return;
    const value = input as Record<string, unknown>;
    const sample: Record<string, number | boolean> = { receivedAt: Date.now() };
    for (const key of ["at", "intervalMs", "timerDelayMs", "longTasks", "longTaskTotalMs", "longTaskMaxMs", "scrollEvents", "scrollFrames", "scrollFrameMaxMs", "stateUpdates"]) {
      if (typeof value[key] !== "number" || !Number.isFinite(value[key]) || Number(value[key]) < 0) return;
      sample[key] = Number(value[key]);
    }
    if (typeof value.visible !== "boolean" || typeof value.longTasksSupported !== "boolean") return;
    sample.visible = value.visible;
    sample.longTasksSupported = value.longTasksSupported;
    this.samples.push(sample);
    if (this.samples.length > 120) this.samples.shift();
  }

  snapshot() {
    return { samples: this.samples.map(sample => ({ ...sample })), sampledAt: Date.now() };
  }
}

export const rendererPerformance = new RendererPerformance();
