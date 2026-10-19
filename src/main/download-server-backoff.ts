export class RealDebridDownloadBackoffError extends Error {
  readonly retryAfterMs: number;

  constructor(readonly status: number, retryAfter: string | null, now = Date.now()) {
    super(`Real-Debrid Downloadserver: HTTP ${status}`);
    this.name = "RealDebridDownloadBackoffError";
    const value = retryAfter?.trim() || "";
    const delay = /^\d+(?:\.\d+)?$/.test(value)
      ? Number(value) * 1000
      : value ? Date.parse(value) - now : 0;
    this.retryAfterMs = Number.isFinite(delay) ? Math.min(86_400_000, Math.max(0, delay)) : 0;
  }
}

export function getRealDebridDownloadRetryDelay(error: RealDebridDownloadBackoffError, attempt: number): number {
  const base = error.status === 429 ? 30_000 : 5_000;
  const backoff = Math.min(60_000, base * 2 ** Math.max(0, Math.min(4, attempt - 1)));
  return Math.max(backoff, error.retryAfterMs);
}
