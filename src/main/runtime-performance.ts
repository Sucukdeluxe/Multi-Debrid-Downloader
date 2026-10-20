import { monitorEventLoopDelay, performance, PerformanceObserver, type IntervalHistogram } from "node:perf_hooks";

export type RuntimeOperation =
  | `io.${string}`
  | `gc.${string}`
  | "log.write"
  | "settings.read" | "settings.encode" | "settings.write" | "settings.commit"
  | "session.encode" | "session.write" | "session.sync" | "session.backup" | "session.commit"
  | "statistics.encode" | "statistics.write" | "statistics.commit"
  | "proxy.allocate" | "proxy.write" | "proxy.readback" | "proxy.readback.wait" | "proxy.flush" | "proxy.commit"
  | "proxy.wait" | "proxy.response";

interface OperationSummary {
  count: number;
  failures: number;
  totalMs: number;
  maxMs: number;
}

interface OperationSample {
  operation: RuntimeOperation;
  startedAt: number;
  durationMs: number;
  synchronous: boolean;
  failed: boolean;
  callSite?: string[];
}

interface LoopSample {
  at: number;
  elapsedMs: number;
  timerDelayMs: number;
  maxDelayMs: number;
  p99DelayMs: number;
  utilization: number;
  cpuPercent: number;
  rssBytes: number;
}

const rounded = (value: number) => Math.round(value * 100) / 100;

const INTERNAL_FRAME = /RuntimePerformance\.|captureCallSite|\bwrapped\b|node:internal|\(node:|^Error:?$/;

export function captureCallSite(): string[] {
  const limit = Error.stackTraceLimit;
  Error.stackTraceLimit = 16;
  const stack = new Error().stack || "";
  Error.stackTraceLimit = limit;
  return stack.split(/\r?\n/)
    .map(line => line.trim().replace(/^at /, ""))
    .filter(line => line && !INTERNAL_FRAME.test(line))
    .slice(0, 4)
    .map(line => line.replace(/\((?:.*[\\/])?([^\\/()]+:\d+:\d+)\)$/, "($1)").replace(/^.*[\\/]([^\\/()]+:\d+:\d+)$/, "$1").slice(0, 200));
}

export class RuntimePerformance {
  private timer: NodeJS.Timeout | null = null;
  private histogram: IntervalHistogram | null = null;
  private loopSamples: LoopSample[] = [];
  private slowOperations: OperationSample[] = [];
  private blockingOperations: OperationSample[] = [];
  private operations = new Map<RuntimeOperation, OperationSummary>();
  private active = new Map<number, { operation: RuntimeOperation; startedAt: number; clock: number }>();
  private sequence = 0;
  private gcObserver: PerformanceObserver | null = null;

  public start(onDelay?: (sample: LoopSample) => void, intervalMs = 5000): void {
    if (this.timer) return;
    const interval = Math.max(50, intervalMs);
    const histogram = monitorEventLoopDelay({ resolution: 20 });
    this.histogram = histogram;
    histogram.enable();
    let lastClock = performance.now();
    let lastCpu = process.cpuUsage();
    let lastUtilization = performance.eventLoopUtilization();
    this.timer = setInterval(() => {
      const now = performance.now();
      const cpu = process.cpuUsage();
      const utilization = performance.eventLoopUtilization();
      const elapsedMs = now - lastClock;
      const timerDelayMs = Math.max(0, elapsedMs - interval);
      const sample: LoopSample = {
        at: Date.now(),
        elapsedMs: rounded(elapsedMs),
        timerDelayMs: rounded(timerDelayMs),
        maxDelayMs: rounded(Math.max(timerDelayMs, histogram.max / 1e6)),
        p99DelayMs: rounded(histogram.percentile(99) / 1e6),
        utilization: rounded(performance.eventLoopUtilization(utilization, lastUtilization).utilization),
        cpuPercent: rounded(((cpu.user - lastCpu.user) + (cpu.system - lastCpu.system)) / (elapsedMs * 10)),
        rssBytes: process.memoryUsage.rss()
      };
      lastClock = now;
      lastCpu = cpu;
      lastUtilization = utilization;
      histogram.reset();
      this.loopSamples.push(sample);
      if (this.loopSamples.length > 120) this.loopSamples.shift();
      if (sample.maxDelayMs >= 1000) {
        try { onDelay?.(sample); } catch {}
      }
    }, interval);
    this.timer.unref();
    try {
      const kinds: Record<number, string> = { 1: "minor", 2: "major", 4: "incremental", 8: "weakcb" };
      this.gcObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const kind = kinds[Number((entry as { detail?: { kind?: number } }).detail?.kind)] || "other";
          const clock = performance.now() - entry.duration;
          this.finish(`gc.${kind}`, Date.now() - entry.duration, clock, true, false);
        }
      });
      this.gcObserver.observe({ entryTypes: ["gc"] });
    } catch {
      this.gcObserver = null;
    }
  }

  public stop(): void {
    this.gcObserver?.disconnect();
    this.gcObserver = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.histogram?.disable();
    this.histogram = null;
  }

  private finish(operation: RuntimeOperation, startedAt: number, clock: number, synchronous: boolean, failed: boolean, callSite?: () => string[]): void {
    const durationMs = performance.now() - clock;
    const entry = this.operations.get(operation) ?? { count: 0, failures: 0, totalMs: 0, maxMs: 0 };
    entry.count += 1;
    entry.failures += Number(failed);
    entry.totalMs += durationMs;
    entry.maxMs = Math.max(entry.maxMs, durationMs);
    this.operations.set(operation, entry);
    if (durationMs >= 100) {
      const sample: OperationSample = { operation, startedAt, durationMs: rounded(durationMs), synchronous, failed };
      if (synchronous && callSite) sample.callSite = callSite();
      this.slowOperations.push(sample);
      if (this.slowOperations.length > 64) this.slowOperations.shift();
      if (synchronous) {
        this.blockingOperations.push(sample);
        if (this.blockingOperations.length > 32) this.blockingOperations.shift();
      }
    }
  }

  public measureSync<T>(operation: RuntimeOperation, action: () => T): T {
    if (!this.timer) return action();
    const startedAt = Date.now();
    const clock = performance.now();
    let failed = true;
    try {
      const result = action();
      failed = false;
      return result;
    } finally {
      this.finish(operation, startedAt, clock, true, failed, captureCallSite);
    }
  }

  public async measure<T>(operation: RuntimeOperation, action: () => Promise<T>): Promise<T> {
    if (!this.timer) return action();
    const startedAt = Date.now();
    const clock = performance.now();
    const id = this.sequence++;
    this.active.set(id, { operation, startedAt, clock });
    let failed = true;
    try {
      const result = await action();
      failed = false;
      return result;
    } finally {
      this.active.delete(id);
      this.finish(operation, startedAt, clock, false, failed);
    }
  }

  public snapshot() {
    const clock = performance.now();
    const active = new Map<RuntimeOperation, { operation: RuntimeOperation; count: number; startedAt: number; elapsedMs: number }>();
    for (const item of this.active.values()) {
      const entry = active.get(item.operation) ?? { operation: item.operation, count: 0, startedAt: item.startedAt, elapsedMs: 0 };
      entry.count += 1;
      entry.startedAt = Math.min(entry.startedAt, item.startedAt);
      entry.elapsedMs = rounded(Math.max(entry.elapsedMs, clock - item.clock));
      active.set(item.operation, entry);
    }
    return {
      enabled: Boolean(this.timer),
      sampledAt: Date.now(),
      loop: this.loopSamples.map((sample) => ({ ...sample })),
      operations: [...this.operations].map(([operation, summary]) => ({ operation, count: summary.count, failures: summary.failures, totalMs: rounded(summary.totalMs), maxMs: rounded(summary.maxMs) })),
      active: [...active.values()],
      slowOperations: this.slowOperations.map((sample) => ({ ...sample })),
      blockingOperations: this.blockingOperations.map((sample) => ({ ...sample }))
    };
  }
}

export const runtimePerformance = new RuntimePerformance();
