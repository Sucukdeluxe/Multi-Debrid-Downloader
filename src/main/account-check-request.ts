const CHECK_TIMEOUT_MS = 20_000;
const CHECK_ATTEMPTS = 3;
const TRANSPORT_FAILURE = /proxy|fetch failed|failed to fetch|unable to fetch|network|econn|enotfound|eai_again|etimedout|und_err|socket hang up|tunneling socket|timeout|HTTP 407|connection (?:closed|refused|reset|timed out)/i;

export function isAccountTransportFailure(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current != null && !seen.has(current)) {
    seen.add(current);
    if (TRANSPORT_FAILURE.test(String(current))) return true;
    if (typeof current !== "object") break;
    const detail = current as { code?: unknown; cause?: unknown };
    if (TRANSPORT_FAILURE.test(String(detail.code ?? ""))) return true;
    current = detail.cause;
  }
  return false;
}

async function waitForRetry(delay: number, signal: AbortSignal): Promise<void> {
  signal.throwIfAborted();
  await new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delay);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export async function fetchAccountCheck(
  url: string,
  init: RequestInit,
  signal?: AbortSignal
): Promise<{ response: Response; text: string }> {
  const timeout = AbortSignal.timeout(CHECK_TIMEOUT_MS);
  const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout;
  const deadline = Date.now() + CHECK_TIMEOUT_MS;
  for (let attempt = 1; ; attempt += 1) {
    requestSignal.throwIfAborted();
    let delay = 400 * 2 ** (attempt - 1);
    try {
      const response = await fetch(url, { ...init, signal: requestSignal });
      const text = await response.text();
      if (attempt >= CHECK_ATTEMPTS || !(response.status === 408 || response.status === 429 || response.status >= 500)) {
        return { response, text };
      }
      const retryAfter = response.headers?.get("retry-after")?.trim();
      if (retryAfter) {
        const retryDelay = /^\d+(?:\.\d+)?$/.test(retryAfter)
          ? Number(retryAfter) * 1000
          : Date.parse(retryAfter) - Date.now();
        if (Number.isFinite(retryDelay)) delay = Math.max(delay, retryDelay);
      }
      if (Date.now() + delay >= deadline) return { response, text };
    } catch (error) {
      if (requestSignal.aborted || attempt >= CHECK_ATTEMPTS || !isAccountTransportFailure(error)) throw error;
    }
    await waitForRetry(delay, requestSignal);
  }
}
