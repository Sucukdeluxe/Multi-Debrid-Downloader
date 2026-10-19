import type {
  AccountRuntimeEntry,
  DebridProvider,
  DownloadItem,
  RendererAccount
} from "../shared/types";
import { getAccountRuntimeSessionStats } from "./account-runtime";
import { getProviderRuntimeSnapshot, type ProviderRuntimeCooldown } from "./debrid";

const ACTIVE_DOWNLOAD_STATUSES = new Set(["validating", "downloading", "paused", "reconnect_wait"]);

function providerFamily(provider: DebridProvider | null): string {
  if (provider === "megadebrid" || provider === "megadebrid-api" || provider === "megadebrid-web") return "megadebrid";
  return provider || "";
}

function accountRuntimeKey(provider: DebridProvider, accountId: string): string {
  return `${provider}:${accountId}`;
}

function sanitizedCooldownReason(category: string): string {
  if (category === "invalid") return "Anmeldung ungültig";
  if (category === "rate_limit") return "Rate-Limit aktiv";
  if (category === "quota") return "Traffic- oder Kontolimit erreicht";
  if (category === "provider_or_link") return "Provider oder Link vorübergehend nicht verfügbar";
  return "Vorübergehender Cooldown";
}

function accountCooldown(
  account: RendererAccount,
  runtime: ReturnType<typeof getProviderRuntimeSnapshot>
): { cooldown: ProviderRuntimeCooldown | null; inFlight: number } {
  if (account.provider === "realdebrid") {
    const entry = runtime.realDebrid.accounts.find((candidate) => candidate.accountId === account.accountId);
    return { cooldown: entry?.cooldown ?? null, inFlight: entry?.inFlight ?? 0 };
  }
  if (account.provider === "megadebrid-api" || account.provider === "megadebrid-web") {
    const mode = account.provider === "megadebrid-api" ? "api" : "web";
    const entry = runtime.megaDebrid.accounts.find((candidate) => candidate.key === `${account.accountId}:${mode}`);
    return { cooldown: entry?.cooldown ?? null, inFlight: entry?.inFlight ?? 0 };
  }
  if (account.provider === "debridlink") {
    const entry = runtime.debridLink.keys.find((candidate) => candidate.keyId === account.accountId);
    return { cooldown: entry?.cooldown ?? null, inFlight: 0 };
  }
  return { cooldown: null, inFlight: 0 };
}

function attributedAccount(item: DownloadItem, accounts: readonly RendererAccount[]): RendererAccount | null {
  if (item.providerAccountId) {
    const exact = accounts.filter((account) => account.accountId === item.providerAccountId && account.provider === item.provider);
    if (exact.length === 1) return exact[0];
    const sameFamily = accounts.filter((account) => account.accountId === item.providerAccountId && providerFamily(account.provider) === providerFamily(item.provider));
    if (sameFamily.length === 1) return sameFamily[0];
  }
  const family = providerFamily(item.provider);
  const candidates = accounts.filter((account) => providerFamily(account.provider) === family);
  return candidates.length === 1 ? candidates[0] : null;
}

export function createAccountRuntimeEntries(
  accounts: readonly RendererAccount[],
  items: readonly DownloadItem[],
  now = Date.now()
): AccountRuntimeEntry[] {
  const providerRuntime = getProviderRuntimeSnapshot(now);
  const activeByAccount = new Map<string, { count: number; lastUsedAt: number }>();
  for (const item of items) {
    if (!ACTIVE_DOWNLOAD_STATUSES.has(item.status)) continue;
    const account = attributedAccount(item, accounts);
    if (!account) continue;
    const key = accountRuntimeKey(account.provider, account.accountId);
    const current = activeByAccount.get(key) ?? { count: 0, lastUsedAt: 0 };
    activeByAccount.set(key, {
      count: current.count + 1,
      lastUsedAt: Math.max(current.lastUsedAt, item.updatedAt || item.createdAt || now)
    });
  }

  return accounts.map((account) => {
    const stats = getAccountRuntimeSessionStats(account.provider, account.accountId);
    const active = activeByAccount.get(accountRuntimeKey(account.provider, account.accountId)) ?? { count: 0, lastUsedAt: 0 };
    const { cooldown, inFlight } = accountCooldown(account, providerRuntime);
    const dailyLimitReached = account.dailyLimitBytes > 0 && account.dailyUsageBytes >= account.dailyLimitBytes;
    const invalid = account.status?.valid === false;
    let state: AccountRuntimeEntry["state"] = "ready";
    let reason = "Bereit";
    if (!account.enabled) {
      state = "disabled";
      reason = "Account deaktiviert";
    } else if (dailyLimitReached) {
      state = "daily_limit";
      reason = "Tageslimit erreicht";
    } else if (cooldown && cooldown.remainingMs > 0) {
      state = "cooldown";
      reason = sanitizedCooldownReason(cooldown.category);
    } else if (active.count > 0) {
      state = "active";
      reason = active.count === 1 ? "1 aktiver Download" : `${active.count} aktive Downloads`;
    } else if (inFlight > 0) {
      state = "checking";
      reason = "Link wird geprüft";
    } else if (invalid) {
      state = "invalid";
      reason = "Accountprüfung fehlgeschlagen";
    }
    return {
      accountId: account.accountId,
      provider: account.provider,
      state,
      reason,
      activeDownloads: active.count,
      inFlight,
      attempts: stats.attempts,
      successes: stats.successes,
      failures: stats.failures,
      lastUsedAt: Math.max(stats.lastUsedAt ?? 0, active.lastUsedAt) || null,
      cooldownUntil: cooldown && cooldown.remainingMs > 0 ? cooldown.untilMs : null,
      dailyUsageBytes: account.dailyUsageBytes
    };
  });
}
