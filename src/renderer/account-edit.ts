import { parseDebridLinkApiKeys, getDebridLinkApiKeyId } from "../shared/debrid-link-keys";
import { getMegaDebridAccountId, parseMegaDebridAccounts, serializeMegaDebridAccounts } from "../shared/mega-debrid-accounts";
import type { AppSettings, DebridAccountStatus, DebridProvider } from "../shared/types";

export type AccountService = "realdebrid" | "megadebrid-api" | "megadebrid-web" | "bestdebrid" | "alldebrid" | "ddownload" | "onefichier" | "debridlink" | "linksnappy";

export type AccountKind =
  | "realdebrid-api"
  | "realdebrid-web"
  | "megadebrid-api"
  | "megadebrid-web"
  | "bestdebrid-api"
  | "bestdebrid-web"
  | "alldebrid-api"
  | "alldebrid-web"
  | "ddownload-login"
  | "onefichier-api"
  | "debridlink-api"
  | "linksnappy-login";

export type SingleAccountKind = Exclude<AccountKind, "megadebrid-api" | "megadebrid-web" | "debridlink-api">;

export type AccountEditTarget =
  | {
      type: "single";
      rowKey: string;
      kind: SingleAccountKind;
      service: AccountService;
      provider: DebridProvider;
    }
  | {
      type: "mega";
      rowKey: string;
      kind: "megadebrid-api" | "megadebrid-web";
      service: "megadebrid-api" | "megadebrid-web";
      accountId: string;
    }
  | {
      type: "debridlink";
      rowKey: string;
      kind: "debridlink-api";
      service: "debridlink";
      keyId: string;
    };

export interface AccountEditState {
  target: AccountEditTarget;
  login: string;
  password: string;
  token: string;
  dailyLimitGb: string;
  originalDailyLimitBytes: number;
}

const BYTES_PER_GIB = 1024 * 1024 * 1024;

function formatDailyLimit(limitBytes: number): string {
  if (!Number.isFinite(limitBytes) || limitBytes <= 0) {
    return "";
  }
  const gib = limitBytes / BYTES_PER_GIB;
  const precision = gib >= 100 ? 0 : gib >= 10 ? 1 : 2;
  return gib.toFixed(precision).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function parseDailyLimit(value: string): number | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }
  return Math.floor(parsed * BYTES_PER_GIB);
}

function withoutRecordKeys<T>(record: Record<string, T>, ...keys: string[]): Record<string, T> {
  const blocked = new Set(keys);
  return Object.fromEntries(Object.entries(record || {}).filter(([key]) => !blocked.has(key)));
}

function resolveDailyLimit(value: string, originalBytes: number): number | null {
  return value === formatDailyLimit(originalBytes) ? (originalBytes > 0 ? originalBytes : null) : parseDailyLimit(value);
}

function updateTargetLimit(record: Record<string, number>, oldId: string, newId: string, value: string, originalBytes: number): Record<string, number> {
  const next = withoutRecordKeys(record || {}, oldId, newId);
  const limit = resolveDailyLimit(value, originalBytes);
  if (limit && limit > 0) {
    next[newId] = limit;
  }
  return next;
}

function migrateDisabledId(ids: readonly string[], oldId: string, newId: string): string[] {
  const wasDisabled = ids.includes(oldId);
  const next = ids.filter((id) => id !== oldId && id !== newId);
  if (wasDisabled) {
    next.push(newId);
  }
  return next;
}

function updateProviderLimit(settings: AppSettings, provider: DebridProvider, value: string, originalBytes: number): AppSettings["providerDailyLimitBytes"] {
  const next = { ...(settings.providerDailyLimitBytes || {}) };
  const limit = resolveDailyLimit(value, originalBytes);
  if (limit && limit > 0) {
    next[provider] = limit;
  } else {
    delete next[provider];
  }
  return next;
}

function createSingleEditState(target: Extract<AccountEditTarget, { type: "single" }>, settings: AppSettings): AccountEditState {
  const originalDailyLimitBytes = settings.providerDailyLimitBytes?.[target.provider] || 0;
  const base = {
    target,
    login: "",
    password: "",
    token: "",
    dailyLimitGb: formatDailyLimit(originalDailyLimitBytes),
    originalDailyLimitBytes
  };
  switch (target.kind) {
    case "realdebrid-api":
      return { ...base, token: settings.token };
    case "bestdebrid-api":
      return { ...base, token: settings.bestToken };
    case "alldebrid-api":
      return { ...base, token: settings.allDebridToken };
    case "onefichier-api":
      return { ...base, token: settings.oneFichierApiKey };
    case "ddownload-login":
      return { ...base, login: settings.ddownloadLogin, password: settings.ddownloadPassword };
    case "linksnappy-login":
      return { ...base, login: settings.linkSnappyLogin, password: settings.linkSnappyPassword };
    default:
      return base;
  }
}

export function createAccountEditState(target: AccountEditTarget, settings: AppSettings): AccountEditState {
  if (target.type === "single") {
    return createSingleEditState(target, settings);
  }
  if (target.type === "mega") {
    const account = parseMegaDebridAccounts(settings.megaCredentials || "", settings.megaPassword || "")
      .find((entry) => entry.id === target.accountId);
    if (!account) {
      throw new Error("Der ausgewählte Mega-Debrid-Account wurde nicht gefunden.");
    }
    return {
      target,
      login: account.login,
      password: account.password,
      token: "",
      dailyLimitGb: formatDailyLimit(settings.megaDebridAccountDailyLimitBytes?.[account.id] || 0),
      originalDailyLimitBytes: settings.megaDebridAccountDailyLimitBytes?.[account.id] || 0
    };
  }
  const key = parseDebridLinkApiKeys(settings.debridLinkApiKeys || "").find((entry) => entry.id === target.keyId);
  if (!key) {
    throw new Error("Der ausgewählte Debrid-Link-Key wurde nicht gefunden.");
  }
  return {
    target,
    login: "",
    password: "",
    token: key.token,
    dailyLimitGb: formatDailyLimit(settings.debridLinkApiKeyDailyLimitBytes?.[key.id] || 0),
    originalDailyLimitBytes: settings.debridLinkApiKeyDailyLimitBytes?.[key.id] || 0
  };
}

function validateDailyLimit(value: string): string | null {
  const normalized = value.trim().replace(",", ".");
  if (!normalized) {
    return null;
  }
  const parsed = Number(normalized);
  return Number.isFinite(parsed) && parsed >= 0 ? null : "Das Tageslimit muss eine positive Zahl oder 0 sein.";
}

export function validateAccountEdit(state: AccountEditState, settings: AppSettings): string | null {
  const limitError = validateDailyLimit(state.dailyLimitGb);
  if (limitError) {
    return limitError;
  }
  if (state.target.type === "mega") {
    const target = state.target;
    const login = state.login.trim();
    if (!login || !state.password.trim()) {
      return "Login und Passwort werden benötigt.";
    }
    if (/[:\r\n]/.test(login)) {
      return "Der Login darf keinen Doppelpunkt oder Zeilenumbruch enthalten.";
    }
    if (/[\r\n]/.test(state.password)) {
      return "Das Passwort darf keinen Zeilenumbruch enthalten.";
    }
    const accounts = parseMegaDebridAccounts(settings.megaCredentials || "", settings.megaPassword || "");
    if (!accounts.some((entry) => entry.id === target.accountId)) {
      return "Der ausgewählte Mega-Debrid-Account wurde nicht gefunden.";
    }
    if (accounts.some((entry) => entry.id !== target.accountId && entry.login.toLowerCase() === login.toLowerCase())) {
      return "Dieser Mega-Debrid-Login ist bereits vorhanden.";
    }
    return null;
  }
  if (state.target.type === "debridlink") {
    const target = state.target;
    const token = state.token.trim();
    if (!token) {
      return "Der API-Key wird benötigt.";
    }
    if (/[,\r\n]/.test(token)) {
      return "Beim Bearbeiten ist genau ein API-Key erlaubt.";
    }
    const keys = parseDebridLinkApiKeys(settings.debridLinkApiKeys || "");
    if (!keys.some((entry) => entry.id === target.keyId)) {
      return "Der ausgewählte Debrid-Link-Key wurde nicht gefunden.";
    }
    if (keys.some((entry) => entry.id !== target.keyId && entry.token === token)) {
      return "Dieser Debrid-Link-Key ist bereits vorhanden.";
    }
    return null;
  }
  if (["realdebrid-api", "bestdebrid-api", "alldebrid-api", "onefichier-api"].includes(state.target.kind) && !state.token.trim()) {
    return "Der Zugangstoken wird benötigt.";
  }
  if (["ddownload-login", "linksnappy-login"].includes(state.target.kind)) {
    if (!state.login.trim() || !state.password.trim()) {
      return "Login und Passwort werden benötigt.";
    }
  }
  return null;
}

function applySingleEdit(settings: AppSettings, state: AccountEditState & { target: Extract<AccountEditTarget, { type: "single" }> }): AppSettings {
  const providerDailyLimitBytes = updateProviderLimit(settings, state.target.provider, state.dailyLimitGb, state.originalDailyLimitBytes);
  const token = state.token.trim();
  const login = state.login.trim();
  switch (state.target.kind) {
    case "realdebrid-api":
      return { ...settings, token, realDebridUseWebLogin: false, providerDailyLimitBytes };
    case "realdebrid-web":
      return { ...settings, token: "", realDebridUseWebLogin: true, providerDailyLimitBytes };
    case "bestdebrid-api":
      return { ...settings, bestToken: token, bestDebridUseWebLogin: false, providerDailyLimitBytes };
    case "bestdebrid-web":
      return { ...settings, bestToken: "", bestDebridUseWebLogin: true, providerDailyLimitBytes };
    case "alldebrid-api":
      return { ...settings, allDebridToken: token, allDebridUseWebLogin: false, providerDailyLimitBytes };
    case "alldebrid-web":
      return { ...settings, allDebridToken: "", allDebridUseWebLogin: true, providerDailyLimitBytes };
    case "ddownload-login":
      return { ...settings, ddownloadLogin: login, ddownloadPassword: state.password, providerDailyLimitBytes };
    case "onefichier-api":
      return { ...settings, oneFichierApiKey: token, providerDailyLimitBytes };
    case "linksnappy-login":
      return { ...settings, linkSnappyLogin: login, linkSnappyPassword: state.password, providerDailyLimitBytes };
  }
}

function applyMegaEdit(settings: AppSettings, state: AccountEditState & { target: Extract<AccountEditTarget, { type: "mega" }> }): AppSettings {
  const accounts = parseMegaDebridAccounts(settings.megaCredentials || "", settings.megaPassword || "");
  const index = accounts.findIndex((entry) => entry.id === state.target.accountId);
  if (index < 0) {
    throw new Error("Der ausgewählte Mega-Debrid-Account wurde nicht gefunden.");
  }
  const oldId = state.target.accountId;
  const login = state.login.trim();
  const newId = getMegaDebridAccountId(login);
  const nextAccounts = accounts.map((entry, accountIndex) => accountIndex === index
    ? { login, password: state.password }
    : { login: entry.login, password: entry.password });
  const idChanged = oldId !== newId;
  const first = nextAccounts[0] || { login: "", password: "" };
  return {
    ...settings,
    megaCredentials: serializeMegaDebridAccounts(nextAccounts),
    megaLogin: first.login,
    megaPassword: first.password,
    megaDebridDisabledAccountIds: idChanged
      ? migrateDisabledId(settings.megaDebridDisabledAccountIds || [], oldId, newId)
      : [...(settings.megaDebridDisabledAccountIds || [])],
    megaDebridAccountDailyLimitBytes: updateTargetLimit(settings.megaDebridAccountDailyLimitBytes || {}, oldId, newId, state.dailyLimitGb, state.originalDailyLimitBytes),
    megaDebridAccountDailyUsageBytes: idChanged
      ? withoutRecordKeys(settings.megaDebridAccountDailyUsageBytes || {}, oldId, newId)
      : { ...(settings.megaDebridAccountDailyUsageBytes || {}) },
    megaDebridAccountTotalUsageBytes: idChanged
      ? withoutRecordKeys(settings.megaDebridAccountTotalUsageBytes || {}, oldId, newId)
      : { ...(settings.megaDebridAccountTotalUsageBytes || {}) },
    debridAccountStatuses: idChanged
      ? withoutRecordKeys(settings.debridAccountStatuses || {}, oldId, newId)
      : { ...(settings.debridAccountStatuses || {}) }
  };
}

function applyDebridLinkEdit(settings: AppSettings, state: AccountEditState & { target: Extract<AccountEditTarget, { type: "debridlink" }> }): AppSettings {
  const keys = parseDebridLinkApiKeys(settings.debridLinkApiKeys || "");
  const index = keys.findIndex((entry) => entry.id === state.target.keyId);
  if (index < 0) {
    throw new Error("Der ausgewählte Debrid-Link-Key wurde nicht gefunden.");
  }
  const oldId = state.target.keyId;
  const token = state.token.trim();
  const newId = getDebridLinkApiKeyId(token);
  const tokens = keys.map((entry, keyIndex) => keyIndex === index ? token : entry.token);
  const idChanged = oldId !== newId;
  return {
    ...settings,
    debridLinkApiKeys: tokens.join("\n"),
    debridLinkDisabledKeyIds: idChanged
      ? migrateDisabledId(settings.debridLinkDisabledKeyIds || [], oldId, newId)
      : [...(settings.debridLinkDisabledKeyIds || [])],
    debridLinkApiKeyDailyLimitBytes: updateTargetLimit(settings.debridLinkApiKeyDailyLimitBytes || {}, oldId, newId, state.dailyLimitGb, state.originalDailyLimitBytes),
    debridLinkApiKeyDailyUsageBytes: idChanged
      ? withoutRecordKeys(settings.debridLinkApiKeyDailyUsageBytes || {}, oldId, newId)
      : { ...(settings.debridLinkApiKeyDailyUsageBytes || {}) },
    debridLinkApiKeyTotalUsageBytes: idChanged
      ? withoutRecordKeys(settings.debridLinkApiKeyTotalUsageBytes || {}, oldId, newId)
      : { ...(settings.debridLinkApiKeyTotalUsageBytes || {}) },
    debridAccountStatuses: idChanged
      ? withoutRecordKeys(settings.debridAccountStatuses || {}, oldId, newId)
      : { ...(settings.debridAccountStatuses || {}) }
  };
}

export function applyAccountEdit(settings: AppSettings, state: AccountEditState): AppSettings {
  if (state.target.type === "single") {
    return applySingleEdit(settings, state as AccountEditState & { target: Extract<AccountEditTarget, { type: "single" }> });
  }
  if (state.target.type === "mega") {
    return applyMegaEdit(settings, state as AccountEditState & { target: Extract<AccountEditTarget, { type: "mega" }> });
  }
  return applyDebridLinkEdit(settings, state as AccountEditState & { target: Extract<AccountEditTarget, { type: "debridlink" }> });
}

function clearSingleAccount(settings: AppSettings, target: Extract<AccountEditTarget, { type: "single" }>): AppSettings {
  const providerDailyLimitBytes = { ...(settings.providerDailyLimitBytes || {}) };
  const providerDailyUsageBytes = { ...(settings.providerDailyUsageBytes || {}) };
  const providerTotalUsageBytes = { ...(settings.providerTotalUsageBytes || {}) };
  delete providerDailyLimitBytes[target.provider];
  delete providerDailyUsageBytes[target.provider];
  delete providerTotalUsageBytes[target.provider];
  const base = { ...settings, providerDailyLimitBytes, providerDailyUsageBytes, providerTotalUsageBytes };
  switch (target.service) {
    case "realdebrid":
      return { ...base, token: "", realDebridUseWebLogin: false };
    case "bestdebrid":
      return { ...base, bestToken: "", bestDebridUseWebLogin: false };
    case "alldebrid":
      return { ...base, allDebridToken: "", allDebridUseWebLogin: false };
    case "ddownload":
      return { ...base, ddownloadLogin: "", ddownloadPassword: "" };
    case "onefichier":
      return { ...base, oneFichierApiKey: "" };
    case "linksnappy":
      return { ...base, linkSnappyLogin: "", linkSnappyPassword: "" };
    default:
      return base;
  }
}

export function removeAccountTarget(settings: AppSettings, target: AccountEditTarget): AppSettings {
  if (target.type === "single") {
    return clearSingleAccount(settings, target);
  }
  if (target.type === "mega") {
    const accounts = parseMegaDebridAccounts(settings.megaCredentials || "", settings.megaPassword || "")
      .filter((entry) => entry.id !== target.accountId)
      .map((entry) => ({ login: entry.login, password: entry.password }));
    const first = accounts[0] || { login: "", password: "" };
    return {
      ...settings,
      megaCredentials: serializeMegaDebridAccounts(accounts),
      megaLogin: first.login,
      megaPassword: first.password,
      megaDebridApiEnabled: accounts.length > 0 && settings.megaDebridApiEnabled,
      megaDebridWebEnabled: accounts.length > 0 && settings.megaDebridWebEnabled,
      megaDebridDisabledAccountIds: (settings.megaDebridDisabledAccountIds || []).filter((id) => id !== target.accountId),
      megaDebridAccountDailyLimitBytes: withoutRecordKeys(settings.megaDebridAccountDailyLimitBytes || {}, target.accountId),
      megaDebridAccountDailyUsageBytes: withoutRecordKeys(settings.megaDebridAccountDailyUsageBytes || {}, target.accountId),
      megaDebridAccountTotalUsageBytes: withoutRecordKeys(settings.megaDebridAccountTotalUsageBytes || {}, target.accountId),
      debridAccountStatuses: withoutRecordKeys(settings.debridAccountStatuses || {}, target.accountId)
    };
  }
  const keys = parseDebridLinkApiKeys(settings.debridLinkApiKeys || "").filter((entry) => entry.id !== target.keyId);
  return {
    ...settings,
    debridLinkApiKeys: keys.map((entry) => entry.token).join("\n"),
    debridLinkDisabledKeyIds: (settings.debridLinkDisabledKeyIds || []).filter((id) => id !== target.keyId),
    debridLinkApiKeyDailyLimitBytes: withoutRecordKeys(settings.debridLinkApiKeyDailyLimitBytes || {}, target.keyId),
    debridLinkApiKeyDailyUsageBytes: withoutRecordKeys(settings.debridLinkApiKeyDailyUsageBytes || {}, target.keyId),
    debridLinkApiKeyTotalUsageBytes: withoutRecordKeys(settings.debridLinkApiKeyTotalUsageBytes || {}, target.keyId),
    debridAccountStatuses: withoutRecordKeys(settings.debridAccountStatuses || {}, target.keyId)
  };
}

export function buildAccountEditCheckSettings(settings: AppSettings, state: AccountEditState): AppSettings {
  if (state.target.type === "mega") {
    const login = state.login.trim();
    return {
      ...settings,
      megaCredentials: serializeMegaDebridAccounts([{ login, password: state.password }]),
      megaLogin: login,
      megaPassword: state.password,
      debridLinkApiKeys: ""
    };
  }
  if (state.target.type === "debridlink") {
    return {
      ...settings,
      megaCredentials: "",
      megaLogin: "",
      megaPassword: "",
      debridLinkApiKeys: state.token.trim()
    };
  }
  return {
    ...settings,
    megaCredentials: "",
    megaLogin: "",
    megaPassword: "",
    debridLinkApiKeys: ""
  };
}

export function validateAccountEditStatuses(state: AccountEditState, statuses: readonly DebridAccountStatus[]): string | null {
  if (state.target.type === "single") {
    return null;
  }
  if (statuses.length === 0) {
    return "Die Prüfung hat keinen Account zurückgegeben.";
  }
  if (statuses.length !== 1) {
    return "Die Prüfung hat mehr als den ausgewählten Account zurückgegeben.";
  }
  const expectedId = getAccountEditExpectedStatusId(state);
  const status = statuses[0];
  if (status.accountId !== expectedId) {
    return "Die Prüfung hat den falschen Account zurückgegeben.";
  }
  return status.valid ? null : status.message || "Zugangsdaten ungültig";
}

export function getAccountEditExpectedStatusId(state: AccountEditState): string | null {
  if (state.target.type === "mega") {
    return getMegaDebridAccountId(state.login);
  }
  if (state.target.type === "debridlink") {
    return getDebridLinkApiKeyId(state.token);
  }
  return null;
}
