import type { AppSettings, DebridAccountStatus } from "../shared/types";
import { parseMegaDebridAccounts, type MegaDebridAccountEntry } from "../shared/mega-debrid-accounts";
import { parseDebridLinkApiKeys, type DebridLinkApiKeyEntry } from "../shared/debrid-link-keys";
import { logger } from "./logger";
import { compactErrorText } from "./utils";

const MEGA_DEBRID_API = "https://www.mega-debrid.eu/api.php";
const DEBRID_LINK_API = "https://debrid-link.com/api/v2";
const REAL_DEBRID_USER_API = "https://api.real-debrid.com/rest/1.0/user";
const CHECK_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const CHECK_TIMEOUT_MS = 20000;

export const REAL_DEBRID_STATUS_ID = "svc-realdebrid";

export interface RealDebridSessionProbeResult {
  valid: boolean;
  isPremium?: boolean;
  premiumUntilMs?: number | null;
  username?: string;
  email?: string;
  message?: string;
}

export type RealDebridSessionProbe = (signal?: AbortSignal) => Promise<RealDebridSessionProbeResult>;

function timeoutSignal(signal: AbortSignal | undefined, ms: number): AbortSignal {
  const timeout = AbortSignal.timeout(ms);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

function parseJsonSafe(text: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(text) as unknown;
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function formatRemaining(premiumUntilMs: number | null, now: number): string {
  if (premiumUntilMs == null) {
    return "Premium-Status unbekannt";
  }
  if (premiumUntilMs <= 0) {
    return "Kein Premium";
  }
  const remainingMs = premiumUntilMs - now;
  if (remainingMs <= 0) {
    return "Premium abgelaufen";
  }
  const days = Math.floor(remainingMs / (24 * 60 * 60 * 1000));
  if (days >= 1) {
    return `Premium noch ${days} Tag${days === 1 ? "" : "e"}`;
  }
  const hours = Math.max(1, Math.floor(remainingMs / (60 * 60 * 1000)));
  return `Premium noch ${hours} Std`;
}

function maskSecret(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }
  if (trimmed.length <= 6) {
    return "*".repeat(trimmed.length);
  }
  return `${trimmed.slice(0, 3)}${"*".repeat(Math.max(4, trimmed.length - 6))}${trimmed.slice(-3)}`;
}

export async function checkRealDebridAccount(
  settings: AppSettings,
  signal?: AbortSignal,
  now = Date.now(),
  probeWebSession?: RealDebridSessionProbe
): Promise<DebridAccountStatus> {
  const token = String(settings.token || "").trim();
  const useWebLogin = Boolean(settings.realDebridUseWebLogin);
  const base: DebridAccountStatus = {
    accountId: REAL_DEBRID_STATUS_ID,
    provider: "realdebrid",
    label: "Real-Debrid",
    maskedLogin: useWebLogin ? "Browser-Login" : maskSecret(token),
    valid: false,
    isPremium: false,
    premiumUntilMs: null,
    message: "",
    checkedAt: now
  };

  if (useWebLogin) {
    if (!probeWebSession) {
      return { ...base, message: "Browser-Sitzung ist nicht prüfbar" };
    }
    try {
      const result = await probeWebSession(signal);
      if (!result.valid) {
        return { ...base, message: result.message || "Browser-Sitzung abgelaufen" };
      }
      const premiumUntilMs = typeof result.premiumUntilMs === "number" ? result.premiumUntilMs : null;
      return {
        ...base,
        valid: true,
        isPremium: Boolean(result.isPremium),
        premiumUntilMs,
        email: String(result.email || result.username || "").trim() || undefined,
        message: result.message || (result.isPremium ? formatRemaining(premiumUntilMs, now) : "Kein Premium (Free)")
      };
    } catch (error) {
      const errText = compactErrorText(error);
      const aborted = signal?.aborted || /aborted/i.test(errText);
      return { ...base, message: aborted ? "Prüfung abgebrochen" : `Prüfung fehlgeschlagen: ${errText}` };
    }
  }

  if (!token) {
    return { ...base, message: "Kein API-Token hinterlegt" };
  }

  try {
    const response = await fetch(REAL_DEBRID_USER_API, {
      headers: {
        Authorization: `Bearer ${token}`,
        "User-Agent": CHECK_USER_AGENT
      },
      signal: timeoutSignal(signal, CHECK_TIMEOUT_MS)
    });
    const text = await response.text();
    const payload = parseJsonSafe(text);
    if (!response.ok || !payload) {
      if (response.status === 401 || response.status === 403) {
        return { ...base, message: "Ungültiger API-Token" };
      }
      return { ...base, message: `Prüfung fehlgeschlagen (HTTP ${response.status})` };
    }
    const expiration = Date.parse(String(payload.expiration || ""));
    const premiumUntilMs = Number.isFinite(expiration) ? expiration : null;
    const isPremium = String(payload.type || "").toLowerCase() === "premium"
      && (premiumUntilMs == null || premiumUntilMs > now);
    return {
      ...base,
      valid: true,
      isPremium,
      premiumUntilMs,
      email: String(payload.email || payload.username || "").trim() || undefined,
      message: isPremium ? formatRemaining(premiumUntilMs, now) : "Kein Premium (Free)"
    };
  } catch (error) {
    const errText = compactErrorText(error);
    const aborted = signal?.aborted || /aborted/i.test(errText);
    return { ...base, message: aborted ? "Prüfung abgebrochen" : `Prüfung fehlgeschlagen: ${errText}` };
  }
}

export async function checkMegaDebridAccount(
  account: MegaDebridAccountEntry,
  signal?: AbortSignal,
  now = Date.now()
): Promise<DebridAccountStatus> {
  const base: DebridAccountStatus = {
    accountId: account.id,
    provider: "megadebrid",
    label: account.label,
    maskedLogin: account.maskedLogin,
    valid: false,
    isPremium: false,
    premiumUntilMs: null,
    message: "",
    checkedAt: now
  };
  try {
    const url = `${MEGA_DEBRID_API}?action=connectUser&login=${encodeURIComponent(account.login)}&password=${encodeURIComponent(account.password)}`;
    const response = await fetch(url, {
      headers: { "User-Agent": CHECK_USER_AGENT },
      signal: timeoutSignal(signal, CHECK_TIMEOUT_MS)
    });
    const text = await response.text();
    const payload = parseJsonSafe(text);
    if (!response.ok || !payload) {
      return { ...base, message: `Login fehlgeschlagen (HTTP ${response.status})` };
    }
    if (payload.response_code !== "ok") {
      const reason = String(payload.response_text || payload.response_code || "Login abgelehnt");
      return { ...base, message: `Ungueltiger Login: ${reason}` };
    }
    const vipEndRaw = Number(payload.vip_end || 0);
    const premiumUntilMs = Number.isFinite(vipEndRaw) && vipEndRaw > 0 ? vipEndRaw * 1000 : 0;
    const isPremium = premiumUntilMs > now;
    const email = String(payload.email || "").trim() || undefined;
    return {
      ...base,
      valid: true,
      isPremium,
      premiumUntilMs,
      email,
      message: formatRemaining(premiumUntilMs, now)
    };
  } catch (error) {
    const errText = compactErrorText(error);
    const aborted = signal?.aborted || /aborted/i.test(errText);
    return {
      ...base,
      message: aborted ? "Pruefung abgebrochen" : `Pruefung fehlgeschlagen: ${errText}`
    };
  }
}

export async function checkDebridLinkKey(
  key: DebridLinkApiKeyEntry,
  signal?: AbortSignal,
  now = Date.now()
): Promise<DebridAccountStatus> {
  const base: DebridAccountStatus = {
    accountId: key.id,
    provider: "debridlink",
    label: key.label,
    maskedLogin: key.masked,
    valid: false,
    isPremium: false,
    premiumUntilMs: null,
    message: "",
    checkedAt: now
  };
  try {
    const response = await fetch(`${DEBRID_LINK_API}/account/infos`, {
      headers: {
        Authorization: `Bearer ${key.token}`,
        "User-Agent": CHECK_USER_AGENT
      },
      signal: timeoutSignal(signal, CHECK_TIMEOUT_MS)
    });
    const text = await response.text();
    const payload = parseJsonSafe(text);
    if (!response.ok || !payload) {
      if (response.status === 401 || response.status === 403) {
        return { ...base, message: "Ungueltiger API-Key (nicht autorisiert)" };
      }
      return { ...base, message: `Pruefung fehlgeschlagen (HTTP ${response.status})` };
    }
    if (payload.success === false) {
      const reason = String(payload.error || "Key abgelehnt");
      return { ...base, message: `Ungueltiger API-Key: ${reason}` };
    }
    const value = (payload.value && typeof payload.value === "object" ? payload.value : payload) as Record<string, unknown>;
    const premiumLeftSec = Number(value.premiumLeft || 0);
    const accountType = Number(value.accountType || 0);
    const premiumUntilMs = Number.isFinite(premiumLeftSec) && premiumLeftSec > 0 ? now + premiumLeftSec * 1000 : 0;
    const isPremium = premiumUntilMs > now || accountType > 0;
    const username = String(value.username || "").trim() || undefined;
    return {
      ...base,
      valid: true,
      isPremium,
      premiumUntilMs: premiumUntilMs > 0 ? premiumUntilMs : (accountType > 0 ? null : 0),
      email: username,
      message: premiumUntilMs > 0
        ? formatRemaining(premiumUntilMs, now)
        : (accountType > 0 ? "Premium aktiv" : "Kein Premium (Free)")
    };
  } catch (error) {
    const errText = compactErrorText(error);
    const aborted = signal?.aborted || /aborted/i.test(errText);
    return {
      ...base,
      message: aborted ? "Pruefung abgebrochen" : `Pruefung fehlgeschlagen: ${errText}`
    };
  }
}

export async function checkAllDebridAccounts(
  settings: AppSettings,
  signal?: AbortSignal,
  probeRealDebridWebSession?: RealDebridSessionProbe
): Promise<DebridAccountStatus[]> {
  const now = Date.now();
  const megaAccounts = parseMegaDebridAccounts(settings.megaCredentials || "", settings.megaPassword || "");
  const debridLinkKeys = parseDebridLinkApiKeys(settings.debridLinkApiKeys || "");

  const taskFns: Array<() => Promise<DebridAccountStatus>> = [
    ...(settings.realDebridUseWebLogin || String(settings.token || "").trim()
      ? [() => checkRealDebridAccount(settings, signal, now, probeRealDebridWebSession)]
      : []),
    ...megaAccounts.map((account) => () => checkMegaDebridAccount(account, signal, now)),
    ...debridLinkKeys.map((key) => () => checkDebridLinkKey(key, signal, now))
  ];

  const results = await runWithConcurrency(taskFns, CHECK_CONCURRENCY);
  logger.info(
    `Account-Check abgeschlossen: ${results.length} Accounts geprueft ` +
    `(${results.filter((r) => r.valid).length} gueltig, ${results.filter((r) => r.isPremium).length} premium)`
  );
  return results;
}

const CHECK_CONCURRENCY = 4;

async function runWithConcurrency<T>(taskFns: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const results: T[] = new Array(taskFns.length);
  let nextIndex = 0;
  const worker = async (): Promise<void> => {
    while (nextIndex < taskFns.length) {
      const current = nextIndex;
      nextIndex += 1;
      results[current] = await taskFns[current]();
    }
  };
  const workers = Array.from({ length: Math.min(limit, taskFns.length) }, () => worker());
  await Promise.all(workers);
  return results;
}
