export interface RealDebridAccountBase {
  id: string;
  kind: "api" | "web";
  index: number;
  label: string;
  maskedLogin: string;
  enabled: boolean;
}

export interface RealDebridApiAccountEntry extends RealDebridAccountBase {
  kind: "api";
  token: string;
}

export interface RealDebridWebAccountEntry extends RealDebridAccountBase {
  kind: "web";
}

export type RealDebridAccountEntry = RealDebridApiAccountEntry | RealDebridWebAccountEntry;

export type RealDebridApiCredential = {
  id: string;
  token: string;
};

export type RealDebridAccountSettings = {
  realDebridApiTokens?: string;
  realDebridWebAccountIds?: string[];
  realDebridDisabledAccountIds?: string[];
};

const API_ACCOUNT_ID_RE = /^rda_[A-Za-z0-9_-]{1,96}$/;
const WEB_ACCOUNT_ID_RE = /^rdw_[A-Za-z0-9_-]{1,96}$/;

export function isRealDebridApiAccountId(value: string): boolean {
  return API_ACCOUNT_ID_RE.test(String(value || "").trim());
}

export function isRealDebridWebAccountId(value: string): boolean {
  return WEB_ACCOUNT_ID_RE.test(String(value || "").trim());
}

function normalizeCredentials(values: readonly RealDebridApiCredential[]): RealDebridApiCredential[] {
  const ids = new Set<string>();
  const tokens = new Set<string>();
  const result: RealDebridApiCredential[] = [];
  for (const value of values) {
    const id = String(value?.id || "").trim();
    const token = String(value?.token || "").trim();
    if (!isRealDebridApiAccountId(id) || !token || /[\r\n]/.test(token) || ids.has(id) || tokens.has(token)) {
      continue;
    }
    ids.add(id);
    tokens.add(token);
    result.push({ id, token });
  }
  return result;
}

function parsePersistedCredentials(raw: string): RealDebridApiCredential[] | null {
  try {
    const parsed = JSON.parse(raw) as { version?: unknown; accounts?: unknown };
    if (parsed?.version !== 1 || !Array.isArray(parsed.accounts)) {
      return null;
    }
    return normalizeCredentials(parsed.accounts as RealDebridApiCredential[]);
  } catch {
    return null;
  }
}

function parseLegacyCredentials(raw: string): RealDebridApiCredential[] {
  const tokens = new Set<string>();
  const result: RealDebridApiCredential[] = [];
  for (const value of raw.split(/[\n,]+/)) {
    const token = value.trim();
    if (!token || /\r/.test(token) || tokens.has(token)) {
      continue;
    }
    tokens.add(token);
    result.push({ id: `rda_legacy_${result.length + 1}`, token });
  }
  return result;
}

export function parseRealDebridApiAccounts(raw: string): RealDebridApiAccountEntry[] {
  const normalizedRaw = String(raw || "").trim();
  const credentials = normalizedRaw
    ? parsePersistedCredentials(normalizedRaw) ?? parseLegacyCredentials(normalizedRaw)
    : [];
  return credentials.map((entry, index) => ({
    ...entry,
    kind: "api",
    index,
    label: `API-Token ${index + 1}`,
    maskedLogin: "Geschützter API-Token",
    enabled: true
  }));
}

export function serializeRealDebridApiAccounts(accounts: readonly RealDebridApiCredential[]): string {
  const normalized = normalizeCredentials(accounts);
  return normalized.length > 0 ? JSON.stringify({ version: 1, accounts: normalized }) : "";
}

export function normalizeRealDebridWebAccountIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of raw) {
    const id = String(value || "").trim();
    if (!isRealDebridWebAccountId(id) || seen.has(id)) {
      continue;
    }
    seen.add(id);
    result.push(id);
  }
  return result;
}

export function getRealDebridAccounts(settings: RealDebridAccountSettings): RealDebridAccountEntry[] {
  const disabled = new Set(Array.isArray(settings.realDebridDisabledAccountIds) ? settings.realDebridDisabledAccountIds : []);
  const apiAccounts = parseRealDebridApiAccounts(settings.realDebridApiTokens || "").map((entry) => ({
    ...entry,
    enabled: !disabled.has(entry.id)
  }));
  const webAccounts = normalizeRealDebridWebAccountIds(settings.realDebridWebAccountIds).map((id, index) => ({
    id,
    kind: "web" as const,
    index,
    label: `Browser-Login ${index + 1}`,
    maskedLogin: "Geschützter Browser-Login",
    enabled: !disabled.has(id)
  }));
  return [...apiAccounts, ...webAccounts];
}

export function getRealDebridAccountIds(settings: RealDebridAccountSettings): string[] {
  return getRealDebridAccounts(settings).map((entry) => entry.id);
}
