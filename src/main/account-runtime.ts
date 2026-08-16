import type { DebridProvider } from "../shared/types";

export interface AccountRuntimeSessionStats {
  attempts: number;
  successes: number;
  failures: number;
  lastUsedAt: number | null;
}

const accountRuntimeSession = new Map<string, AccountRuntimeSessionStats>();

function runtimeKey(provider: DebridProvider, accountId: string): string {
  return `${provider}:${accountId}`;
}

function updateAccountRuntimeSession(
  provider: DebridProvider,
  accountId: string,
  update: (current: AccountRuntimeSessionStats) => AccountRuntimeSessionStats
): void {
  if (!accountId) return;
  const key = runtimeKey(provider, accountId);
  const current = accountRuntimeSession.get(key) ?? { attempts: 0, successes: 0, failures: 0, lastUsedAt: null };
  accountRuntimeSession.set(key, update(current));
}

export function recordAccountRuntimeAttempt(provider: DebridProvider, accountId: string, at = Date.now()): void {
  updateAccountRuntimeSession(provider, accountId, (current) => ({
    ...current,
    attempts: current.attempts + 1,
    lastUsedAt: at
  }));
}

export function recordAccountRuntimeSuccess(provider: DebridProvider, accountId: string, at = Date.now()): void {
  updateAccountRuntimeSession(provider, accountId, (current) => ({
    ...current,
    successes: current.successes + 1,
    lastUsedAt: at
  }));
}

export function recordAccountRuntimeFailure(provider: DebridProvider, accountId: string, at = Date.now()): void {
  updateAccountRuntimeSession(provider, accountId, (current) => ({
    ...current,
    failures: current.failures + 1,
    lastUsedAt: at
  }));
}

export function getAccountRuntimeSessionStats(provider: DebridProvider, accountId: string): AccountRuntimeSessionStats {
  const current = accountRuntimeSession.get(runtimeKey(provider, accountId));
  return current ? { ...current } : { attempts: 0, successes: 0, failures: 0, lastUsedAt: null };
}

export function pruneAccountRuntimeSession(validKeys: ReadonlySet<string>): void {
  for (const key of accountRuntimeSession.keys()) {
    if (!validKeys.has(key)) accountRuntimeSession.delete(key);
  }
}

export function resetAccountRuntimeSessionForProvider(provider: DebridProvider): void {
  const prefix = `${provider}:`;
  for (const key of accountRuntimeSession.keys()) {
    if (key.startsWith(prefix)) accountRuntimeSession.delete(key);
  }
}
