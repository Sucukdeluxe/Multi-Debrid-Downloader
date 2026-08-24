import { getDebridLinkApiKeyId, parseDebridLinkApiKeys } from "../shared/debrid-link-keys";
import { randomUUID } from "node:crypto";
import {
  getMegaDebridAccountId,
  getMegaDebridAccountsForMode,
  getMegaDebridCredentialsForMode,
  getMegaDebridDisabledAccountIdsForMode,
  mergeMegaDebridCredentialPools,
  parseMegaDebridAccounts,
  serializeMegaDebridAccounts,
  type MegaDebridAccountMode
} from "../shared/mega-debrid-accounts";
import { getRealDebridAccounts, isRealDebridWebAccountId, parseRealDebridApiAccounts, serializeRealDebridApiAccounts } from "../shared/real-debrid-accounts";
import type { AccountCommand, AccountCredentialCheckInput, AccountSecretRequest, AppSettings, DebridProvider, RendererAccountKind } from "../shared/types";

export interface AppliedAccountCommand {
  settings: AppSettings;
  response: { accountId: string | null };
}

const ACCOUNT_KINDS = new Set<RendererAccountKind>([
  "realdebrid-api",
  "realdebrid-web",
  "megadebrid-api",
  "megadebrid-web",
  "bestdebrid-api",
  "bestdebrid-web",
  "alldebrid-api",
  "alldebrid-web",
  "deepbrid-api",
  "ddownload-login",
  "onefichier-api",
  "debridlink-api",
  "linksnappy-login"
]);

const ACTION_FIELDS: Record<AccountCommand["action"], ReadonlySet<string>> = {
  create: new Set(["action", "kind", "identity", "secret", "dailyLimitBytes"]),
  replace: new Set(["action", "kind", "accountId", "identity", "secret", "dailyLimitBytes"]),
  "update-secret": new Set(["action", "kind", "accountId", "secret"]),
  delete: new Set(["action", "kind", "accountId"])
};

function invalid(): never {
  throw new Error("Account-Payload ist ungültig");
}

function optionalString(value: unknown, maxLength: number): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length > maxLength) {
    invalid();
  }
  return value;
}

function requiredString(value: unknown, maxLength: number): string {
  const result = optionalString(value, maxLength);
  if (result === undefined || !result.trim()) {
    invalid();
  }
  return result;
}

function optionalLimit(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    invalid();
  }
  return value;
}

export function validateAccountCommand(value: unknown): AccountCommand {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    invalid();
  }
  const raw = value as Record<string, unknown>;
  const action = raw.action;
  if (action !== "create" && action !== "replace" && action !== "update-secret" && action !== "delete") {
    invalid();
  }
  if (Object.keys(raw).some((key) => !ACTION_FIELDS[action].has(key))) {
    invalid();
  }
  if (typeof raw.kind !== "string" || !ACCOUNT_KINDS.has(raw.kind as RendererAccountKind)) {
    invalid();
  }
  const kind = raw.kind as RendererAccountKind;
  if (action === "create") {
    return {
      action,
      kind,
      identity: optionalString(raw.identity, 512),
      secret: optionalString(raw.secret, 100_000),
      dailyLimitBytes: optionalLimit(raw.dailyLimitBytes)
    };
  }
  const accountId = requiredString(raw.accountId, 256).trim();
  if (action === "replace") {
    return {
      action,
      kind,
      accountId,
      identity: optionalString(raw.identity, 512),
      secret: optionalString(raw.secret, 100_000),
      dailyLimitBytes: optionalLimit(raw.dailyLimitBytes)
    };
  }
  if (action === "update-secret") {
    return {
      action,
      kind,
      accountId,
      secret: requiredString(raw.secret, 100_000)
    };
  }
  return { action, kind, accountId };
}

export function validateAccountCredentialCheckInput(value: unknown): AccountCredentialCheckInput {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => !new Set(["kind", "accountId", "identity", "secret"]).has(key))) invalid();
  if (raw.kind !== "realdebrid-api"
    && raw.kind !== "realdebrid-web"
    && raw.kind !== "megadebrid-api"
    && raw.kind !== "megadebrid-web"
    && raw.kind !== "debridlink-api"
    && raw.kind !== "deepbrid-api") invalid();
  const accountId = optionalString(raw.accountId, 256);
  if (raw.kind === "deepbrid-api" && accountId !== undefined && accountId !== "svc-deepbrid") invalid();
  return {
    kind: raw.kind,
    accountId,
    identity: optionalString(raw.identity, 512),
    secret: optionalString(raw.secret, 100_000)
  };
}

export function validateAccountSecretRequest(value: unknown): AccountSecretRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid();
  const raw = value as Record<string, unknown>;
  if (Object.keys(raw).some((key) => key !== "kind" && key !== "accountId")) invalid();
  if (typeof raw.kind !== "string" || !ACCOUNT_KINDS.has(raw.kind as RendererAccountKind)) invalid();
  return {
    kind: raw.kind as RendererAccountKind,
    accountId: requiredString(raw.accountId, 256).trim()
  };
}

function storedSecretMissing(): never {
  throw new Error("Der gespeicherte Zugang wurde nicht gefunden.");
}

export function resolveStoredAccountSecret(settings: AppSettings, request: AccountSecretRequest): string {
  if (request.kind === "realdebrid-api") {
    const accounts = parseRealDebridApiAccounts(settings.realDebridApiTokens);
    const account = accounts.find((entry) => entry.id === request.accountId);
    if (account?.token) return account.token;
    if (accounts.length === 0 && request.accountId === REAL_DEBRID_LEGACY_ID && settings.token) return settings.token;
    return storedSecretMissing();
  }
  if (request.kind === "megadebrid-api" || request.kind === "megadebrid-web") {
    const mode = request.kind === "megadebrid-web" ? "web" : "api";
    const account = getMegaDebridAccountsForMode(settings, mode).find((entry) => entry.id === request.accountId);
    if (!account?.password) storedSecretMissing();
    return account.password;
  }
  if (request.kind === "debridlink-api") {
    const key = parseDebridLinkApiKeys(settings.debridLinkApiKeys).find((entry) => entry.id === request.accountId);
    if (!key?.token) storedSecretMissing();
    return key.token;
  }
  const provider = singleProvider(request.kind);
  if (request.accountId !== `svc-${provider}` || !singleConfigured(settings, request.kind)) storedSecretMissing();
  if (request.kind === "bestdebrid-api" && settings.bestToken) return settings.bestToken;
  if (request.kind === "alldebrid-api" && settings.allDebridToken) return settings.allDebridToken;
  if (request.kind === "deepbrid-api" && settings.deepbridApiKey) return settings.deepbridApiKey;
  if (request.kind === "ddownload-login" && settings.ddownloadPassword) return settings.ddownloadPassword;
  if (request.kind === "onefichier-api" && settings.oneFichierApiKey) return settings.oneFichierApiKey;
  if (request.kind === "linksnappy-login" && settings.linkSnappyPassword) return settings.linkSnappyPassword;
  return storedSecretMissing();
}

const REAL_DEBRID_LEGACY_ID = "svc-realdebrid";

function syncRealDebridLegacyFields(settings: AppSettings): AppSettings {
  const firstApi = parseRealDebridApiAccounts(settings.realDebridApiTokens)[0];
  return {
    ...settings,
    token: firstApi?.token || "",
    realDebridUseWebLogin: settings.realDebridWebAccountIds.length > 0
  };
}

function normalizeRealDebridCommandSettings(settings: AppSettings): AppSettings {
  const rawPool = settings.realDebridApiTokens.trim() || (settings.realDebridUseWebLogin ? "" : settings.token.trim());
  const apiAccounts = parseRealDebridApiAccounts(rawPool).map((account) => ({
    id: account.id.startsWith("rda_legacy_") ? `rda_${randomUUID().replace(/-/g, "")}` : account.id,
    token: account.token
  }));
  return {
    ...settings,
    realDebridApiTokens: serializeRealDebridApiAccounts(apiAccounts),
    realDebridWebAccountIds: settings.realDebridWebAccountIds.length > 0
      ? [...settings.realDebridWebAccountIds]
      : settings.realDebridUseWebLogin ? ["rdw_legacy"] : []
  };
}

export function setRealDebridAccountEnabled(settings: AppSettings, accountId: string, enabled: boolean): AppSettings {
  const normalized = normalizeRealDebridCommandSettings(settings);
  if (!getRealDebridAccounts(normalized).some((account) => account.id === accountId)) invalid();
  return {
    ...normalized,
    realDebridDisabledAccountIds: enabled
      ? normalized.realDebridDisabledAccountIds.filter((id) => id !== accountId)
      : [...new Set([...normalized.realDebridDisabledAccountIds, accountId])]
  };
}

function migrateRealDebridMetadata(settings: AppSettings, oldId: string, newId: string, limit: number | undefined): AppSettings {
  const idChanged = oldId !== newId;
  return {
    ...settings,
    realDebridDisabledAccountIds: idChanged
      ? migrateIdList(settings.realDebridDisabledAccountIds, oldId, newId)
      : [...settings.realDebridDisabledAccountIds],
    realDebridAccountDailyLimitBytes: migrateLimit(settings.realDebridAccountDailyLimitBytes, oldId, newId, limit),
    realDebridAccountDailyUsageBytes: idChanged ? withoutKeys(settings.realDebridAccountDailyUsageBytes, oldId, newId) : { ...settings.realDebridAccountDailyUsageBytes },
    realDebridAccountTotalUsageBytes: idChanged ? withoutKeys(settings.realDebridAccountTotalUsageBytes, oldId, newId) : { ...settings.realDebridAccountTotalUsageBytes },
    debridAccountStatuses: idChanged ? withoutKeys(settings.debridAccountStatuses, oldId, newId) : { ...settings.debridAccountStatuses }
  };
}

function createRealDebrid(settings: AppSettings, command: Extract<AccountCommand, { action: "create" }>): AppliedAccountCommand {
  if (command.kind === "realdebrid-api") {
    const token = validateSecret(command.secret || "");
    const accounts = parseRealDebridApiAccounts(settings.realDebridApiTokens);
    if (accounts.some((account) => account.token === token)) invalid();
    const accountId = `rda_${randomUUID().replace(/-/g, "")}`;
    const next = syncRealDebridLegacyFields({
      ...settings,
      realDebridApiTokens: serializeRealDebridApiAccounts([...accounts, { id: accountId, token }]),
      realDebridDisabledAccountIds: settings.realDebridDisabledAccountIds.filter((id) => id !== accountId),
      realDebridAccountDailyLimitBytes: setLimit(settings.realDebridAccountDailyLimitBytes, accountId, command.dailyLimitBytes)
    });
    return { settings: next, response: { accountId } };
  }
  const requestedId = String(command.identity || "").trim();
  const accountId = requestedId && isRealDebridWebAccountId(requestedId) ? requestedId : `rdw_${randomUUID().replace(/-/g, "")}`;
  if (settings.realDebridWebAccountIds.includes(accountId)) invalid();
  const next = syncRealDebridLegacyFields({
    ...settings,
    realDebridWebAccountIds: [...settings.realDebridWebAccountIds, accountId],
    realDebridDisabledAccountIds: settings.realDebridDisabledAccountIds.filter((id) => id !== accountId),
    realDebridAccountDailyLimitBytes: setLimit(settings.realDebridAccountDailyLimitBytes, accountId, command.dailyLimitBytes)
  });
  return { settings: next, response: { accountId } };
}

function replaceRealDebrid(settings: AppSettings, command: Extract<AccountCommand, { action: "replace" }>): AppliedAccountCommand {
  const accounts = getRealDebridAccounts(settings);
  const current = accounts.find((account) => account.id === command.accountId);
  if (!current || (current.kind === "api") !== (command.kind === "realdebrid-api")) invalid();
  if (current.kind === "web") {
    const next = syncRealDebridLegacyFields(migrateRealDebridMetadata(settings, current.id, current.id, command.dailyLimitBytes));
    return { settings: next, response: { accountId: current.id } };
  }
  const token = command.secret?.trim() ? validateSecret(command.secret) : current.token;
  if (accounts.some((account) => account.id !== current.id && account.kind === "api" && account.token === token)) invalid();
  const credentials = parseRealDebridApiAccounts(settings.realDebridApiTokens).map((account) => ({
    id: account.id,
    token: account.id === current.id ? token : account.token
  }));
  const next = syncRealDebridLegacyFields(migrateRealDebridMetadata({
    ...settings,
    realDebridApiTokens: serializeRealDebridApiAccounts(credentials)
  }, current.id, current.id, command.dailyLimitBytes));
  return { settings: next, response: { accountId: current.id } };
}

function deleteRealDebrid(settings: AppSettings, command: Extract<AccountCommand, { action: "delete" }>): AppliedAccountCommand {
  const account = getRealDebridAccounts(settings).find((entry) => entry.id === command.accountId);
  if (!account || (account.kind === "api") !== (command.kind === "realdebrid-api")) invalid();
  const next = syncRealDebridLegacyFields({
    ...settings,
    realDebridApiTokens: account.kind === "api"
      ? serializeRealDebridApiAccounts(parseRealDebridApiAccounts(settings.realDebridApiTokens).filter((entry) => entry.id !== account.id))
      : settings.realDebridApiTokens,
    realDebridWebAccountIds: account.kind === "web" ? settings.realDebridWebAccountIds.filter((id) => id !== account.id) : [...settings.realDebridWebAccountIds],
    realDebridDisabledAccountIds: settings.realDebridDisabledAccountIds.filter((id) => id !== account.id),
    realDebridAccountDailyLimitBytes: withoutKeys(settings.realDebridAccountDailyLimitBytes, account.id),
    realDebridAccountDailyUsageBytes: withoutKeys(settings.realDebridAccountDailyUsageBytes, account.id),
    realDebridAccountTotalUsageBytes: withoutKeys(settings.realDebridAccountTotalUsageBytes, account.id),
    debridAccountStatuses: withoutKeys(settings.debridAccountStatuses, account.id)
  });
  return { settings: next, response: { accountId: getRealDebridAccounts(next)[0]?.id || null } };
}

function withoutKeys<T>(record: Record<string, T>, ...keys: string[]): Record<string, T> {
  const removed = new Set(keys);
  return Object.fromEntries(Object.entries(record).filter(([key]) => !removed.has(key)));
}

function migrateIdList(values: readonly string[], oldId: string, newId: string): string[] {
  const retained = values.filter((value) => value !== oldId && value !== newId);
  if (values.includes(oldId)) {
    retained.push(newId);
  }
  return retained;
}

function setLimit(record: Record<string, number>, id: string, value: number | undefined): Record<string, number> {
  const result = { ...record };
  if (value === undefined) {
    return result;
  }
  if (value > 0) {
    result[id] = value;
  } else {
    delete result[id];
  }
  return result;
}

function migrateLimit(record: Record<string, number>, oldId: string, newId: string, value: number | undefined): Record<string, number> {
  const result = withoutKeys(record, oldId, newId);
  const resolved = value === undefined ? record[oldId] : value;
  if (resolved && resolved > 0) {
    result[newId] = resolved;
  }
  return result;
}

function validateIdentity(identity: string): string {
  const trimmed = identity.trim();
  if (!trimmed || /[:\r\n]/.test(trimmed)) {
    invalid();
  }
  return trimmed;
}

function validateSecret(secret: string): string {
  if (!secret.trim() || /[\r\n]/.test(secret)) {
    invalid();
  }
  return secret;
}

function megaMode(kind: RendererAccountKind): MegaDebridAccountMode {
  return kind === "megadebrid-web" ? "web" : "api";
}

function writeMegaPools(settings: AppSettings, apiCredentials: string, webCredentials: string): AppSettings {
  const mergedCredentials = mergeMegaDebridCredentialPools(apiCredentials, webCredentials);
  const first = parseMegaDebridAccounts(mergedCredentials)[0];
  return {
    ...settings,
    megaCredentials: mergedCredentials,
    megaLogin: first?.login || "",
    megaPassword: first?.password || "",
    megaDebridApiCredentials: apiCredentials,
    megaDebridWebCredentials: webCredentials,
    megaDebridApiEnabled: settings.megaDebridApiEnabled && Boolean(apiCredentials),
    megaDebridWebEnabled: settings.megaDebridWebEnabled && Boolean(webCredentials)
  };
}

function createMega(settings: AppSettings, command: Extract<AccountCommand, { action: "create" }>): AppliedAccountCommand {
  const mode = megaMode(command.kind);
  const identity = validateIdentity(command.identity || "");
  const secret = validateSecret(command.secret || "");
  const accounts = getMegaDebridAccountsForMode(settings, mode);
  if (accounts.some((account) => account.login.toLowerCase() === identity.toLowerCase())) {
    invalid();
  }
  const selectedCredentials = serializeMegaDebridAccounts([...accounts, { login: identity, password: secret }]);
  const apiCredentials = mode === "api" ? selectedCredentials : getMegaDebridCredentialsForMode(settings, "api");
  const webCredentials = mode === "web" ? selectedCredentials : getMegaDebridCredentialsForMode(settings, "web");
  const accountId = getMegaDebridAccountId(identity);
  const next = writeMegaPools(settings, apiCredentials, webCredentials);
  if (mode === "api") {
    next.megaDebridApiEnabled = true;
  } else {
    next.megaDebridWebEnabled = true;
  }
  next.megaDebridAccountDailyLimitBytes = setLimit(settings.megaDebridAccountDailyLimitBytes, accountId, command.dailyLimitBytes);
  return { settings: next, response: { accountId } };
}

function replaceMega(settings: AppSettings, command: Extract<AccountCommand, { action: "replace" }>): AppliedAccountCommand {
  const mode = megaMode(command.kind);
  const accounts = getMegaDebridAccountsForMode(settings, mode);
  const index = accounts.findIndex((account) => account.id === command.accountId);
  if (index < 0) {
    invalid();
  }
  const current = accounts[index];
  const identity = command.identity === undefined ? current.login : validateIdentity(command.identity);
  const secret = command.secret?.trim() ? validateSecret(command.secret) : current.password;
  if (accounts.some((account, accountIndex) => accountIndex !== index && account.login.toLowerCase() === identity.toLowerCase())) {
    invalid();
  }
  const accountId = getMegaDebridAccountId(identity);
  const selectedCredentials = serializeMegaDebridAccounts(accounts.map((account, accountIndex) => accountIndex === index
    ? { login: identity, password: secret }
    : { login: account.login, password: account.password }));
  const apiCredentials = mode === "api" ? selectedCredentials : getMegaDebridCredentialsForMode(settings, "api");
  const webCredentials = mode === "web" ? selectedCredentials : getMegaDebridCredentialsForMode(settings, "web");
  const next = writeMegaPools(settings, apiCredentials, webCredentials);
  const selectedDisabled = migrateIdList(getMegaDebridDisabledAccountIdsForMode(settings, mode), command.accountId, accountId);
  if (mode === "api") {
    next.megaDebridApiDisabledAccountIds = selectedDisabled;
  } else {
    next.megaDebridWebDisabledAccountIds = selectedDisabled;
  }
  next.megaDebridDisabledAccountIds = [...new Set([...next.megaDebridApiDisabledAccountIds, ...next.megaDebridWebDisabledAccountIds])];
  next.megaDebridAccountDailyLimitBytes = migrateLimit(settings.megaDebridAccountDailyLimitBytes, command.accountId, accountId, command.dailyLimitBytes);
  if (command.accountId !== accountId) {
    next.megaDebridAccountDailyUsageBytes = withoutKeys(settings.megaDebridAccountDailyUsageBytes, command.accountId, accountId);
    next.megaDebridAccountTotalUsageBytes = withoutKeys(settings.megaDebridAccountTotalUsageBytes, command.accountId, accountId);
    next.debridAccountStatuses = withoutKeys(settings.debridAccountStatuses, command.accountId, accountId);
  }
  return { settings: next, response: { accountId } };
}

function deleteMega(settings: AppSettings, command: Extract<AccountCommand, { action: "delete" }>): AppliedAccountCommand {
  const mode = megaMode(command.kind);
  const selected = getMegaDebridAccountsForMode(settings, mode);
  if (!selected.some((account) => account.id === command.accountId)) {
    invalid();
  }
  const selectedCredentials = serializeMegaDebridAccounts(selected.filter((account) => account.id !== command.accountId));
  const apiCredentials = mode === "api" ? selectedCredentials : getMegaDebridCredentialsForMode(settings, "api");
  const webCredentials = mode === "web" ? selectedCredentials : getMegaDebridCredentialsForMode(settings, "web");
  const accountStillUsed = parseMegaDebridAccounts(mode === "api" ? webCredentials : apiCredentials).some((account) => account.id === command.accountId);
  const next = writeMegaPools(settings, apiCredentials, webCredentials);
  next.megaDebridApiDisabledAccountIds = mode === "api"
    ? settings.megaDebridApiDisabledAccountIds.filter((id) => id !== command.accountId)
    : [...settings.megaDebridApiDisabledAccountIds];
  next.megaDebridWebDisabledAccountIds = mode === "web"
    ? settings.megaDebridWebDisabledAccountIds.filter((id) => id !== command.accountId)
    : [...settings.megaDebridWebDisabledAccountIds];
  next.megaDebridDisabledAccountIds = [...new Set([...next.megaDebridApiDisabledAccountIds, ...next.megaDebridWebDisabledAccountIds])];
  if (!accountStillUsed) {
    next.megaDebridAccountDailyLimitBytes = withoutKeys(settings.megaDebridAccountDailyLimitBytes, command.accountId);
    next.megaDebridAccountDailyUsageBytes = withoutKeys(settings.megaDebridAccountDailyUsageBytes, command.accountId);
    next.megaDebridAccountTotalUsageBytes = withoutKeys(settings.megaDebridAccountTotalUsageBytes, command.accountId);
    next.debridAccountStatuses = withoutKeys(settings.debridAccountStatuses, command.accountId);
  }
  const remaining = getMegaDebridAccountsForMode(next, mode)[0]?.id || null;
  return { settings: next, response: { accountId: remaining } };
}

function createDebridLink(settings: AppSettings, command: Extract<AccountCommand, { action: "create" }>): AppliedAccountCommand {
  const secret = validateSecret(command.secret || "");
  if (/[,\r\n]/.test(secret)) {
    invalid();
  }
  const keys = parseDebridLinkApiKeys(settings.debridLinkApiKeys);
  if (keys.some((key) => key.token === secret)) {
    invalid();
  }
  const accountId = getDebridLinkApiKeyId(secret);
  return {
    settings: {
      ...settings,
      debridLinkApiKeys: [...keys.map((key) => key.token), secret].join("\n"),
      debridLinkApiKeyDailyLimitBytes: setLimit(settings.debridLinkApiKeyDailyLimitBytes, accountId, command.dailyLimitBytes)
    },
    response: { accountId }
  };
}

function replaceDebridLink(settings: AppSettings, command: Extract<AccountCommand, { action: "replace" }>): AppliedAccountCommand {
  const keys = parseDebridLinkApiKeys(settings.debridLinkApiKeys);
  const index = keys.findIndex((key) => key.id === command.accountId);
  if (index < 0) {
    invalid();
  }
  const secret = command.secret?.trim() ? validateSecret(command.secret) : keys[index].token;
  if (/[,\r\n]/.test(secret) || keys.some((key, keyIndex) => keyIndex !== index && key.token === secret)) {
    invalid();
  }
  const accountId = getDebridLinkApiKeyId(secret);
  const tokens = keys.map((key, keyIndex) => keyIndex === index ? secret : key.token);
  const idChanged = accountId !== command.accountId;
  return {
    settings: {
      ...settings,
      debridLinkApiKeys: tokens.join("\n"),
      debridLinkDisabledKeyIds: idChanged ? migrateIdList(settings.debridLinkDisabledKeyIds, command.accountId, accountId) : [...settings.debridLinkDisabledKeyIds],
      debridLinkApiKeyDailyLimitBytes: migrateLimit(settings.debridLinkApiKeyDailyLimitBytes, command.accountId, accountId, command.dailyLimitBytes),
      debridLinkApiKeyDailyUsageBytes: idChanged ? withoutKeys(settings.debridLinkApiKeyDailyUsageBytes, command.accountId, accountId) : { ...settings.debridLinkApiKeyDailyUsageBytes },
      debridLinkApiKeyTotalUsageBytes: idChanged ? withoutKeys(settings.debridLinkApiKeyTotalUsageBytes, command.accountId, accountId) : { ...settings.debridLinkApiKeyTotalUsageBytes },
      debridAccountStatuses: idChanged ? withoutKeys(settings.debridAccountStatuses, command.accountId, accountId) : { ...settings.debridAccountStatuses }
    },
    response: { accountId }
  };
}

function deleteDebridLink(settings: AppSettings, command: Extract<AccountCommand, { action: "delete" }>): AppliedAccountCommand {
  const keys = parseDebridLinkApiKeys(settings.debridLinkApiKeys);
  if (!keys.some((key) => key.id === command.accountId)) {
    invalid();
  }
  const remaining = keys.filter((key) => key.id !== command.accountId);
  return {
    settings: {
      ...settings,
      debridLinkApiKeys: remaining.map((key) => key.token).join("\n"),
      debridLinkDisabledKeyIds: settings.debridLinkDisabledKeyIds.filter((id) => id !== command.accountId),
      debridLinkApiKeyDailyLimitBytes: withoutKeys(settings.debridLinkApiKeyDailyLimitBytes, command.accountId),
      debridLinkApiKeyDailyUsageBytes: withoutKeys(settings.debridLinkApiKeyDailyUsageBytes, command.accountId),
      debridLinkApiKeyTotalUsageBytes: withoutKeys(settings.debridLinkApiKeyTotalUsageBytes, command.accountId),
      debridAccountStatuses: withoutKeys(settings.debridAccountStatuses, command.accountId)
    },
    response: { accountId: remaining[0]?.id || null }
  };
}

function singleProvider(kind: RendererAccountKind): DebridProvider {
  if (kind.startsWith("realdebrid")) return "realdebrid";
  if (kind.startsWith("bestdebrid")) return "bestdebrid";
  if (kind.startsWith("alldebrid")) return "alldebrid";
  if (kind === "deepbrid-api") return "deepbrid";
  if (kind === "ddownload-login") return "ddownload";
  if (kind === "onefichier-api") return "onefichier";
  if (kind === "linksnappy-login") return "linksnappy";
  invalid();
}

function singleConfigured(settings: AppSettings, kind: RendererAccountKind): boolean {
  if (kind === "realdebrid-api") return Boolean(settings.token.trim());
  if (kind === "realdebrid-web") return settings.realDebridUseWebLogin;
  if (kind === "bestdebrid-api") return Boolean(settings.bestToken.trim());
  if (kind === "bestdebrid-web") return settings.bestDebridUseWebLogin;
  if (kind === "alldebrid-api") return Boolean(settings.allDebridToken.trim());
  if (kind === "alldebrid-web") return settings.allDebridUseWebLogin;
  if (kind === "deepbrid-api") return Boolean(settings.deepbridApiKey.trim());
  if (kind === "ddownload-login") return Boolean(settings.ddownloadLogin.trim() && settings.ddownloadPassword);
  if (kind === "onefichier-api") return Boolean(settings.oneFichierApiKey.trim());
  if (kind === "linksnappy-login") return Boolean(settings.linkSnappyLogin.trim() && settings.linkSnappyPassword);
  return false;
}

function setSingle(settings: AppSettings, kind: RendererAccountKind, identity: string | undefined, secret: string | undefined): AppSettings {
  if (kind === "realdebrid-api") return { ...settings, token: validateSecret(secret || ""), realDebridUseWebLogin: false };
  if (kind === "realdebrid-web") return { ...settings, token: "", realDebridUseWebLogin: true };
  if (kind === "bestdebrid-api") return { ...settings, bestToken: validateSecret(secret || ""), bestDebridUseWebLogin: false };
  if (kind === "bestdebrid-web") return { ...settings, bestToken: "", bestDebridUseWebLogin: true };
  if (kind === "alldebrid-api") return { ...settings, allDebridToken: validateSecret(secret || ""), allDebridUseWebLogin: false };
  if (kind === "alldebrid-web") return { ...settings, allDebridToken: "", allDebridUseWebLogin: true };
  if (kind === "deepbrid-api") return { ...settings, deepbridApiKey: validateSecret(secret || "") };
  if (kind === "ddownload-login") return { ...settings, ddownloadLogin: validateIdentity(identity || ""), ddownloadPassword: validateSecret(secret || "") };
  if (kind === "onefichier-api") return { ...settings, oneFichierApiKey: validateSecret(secret || "") };
  if (kind === "linksnappy-login") return { ...settings, linkSnappyLogin: validateIdentity(identity || ""), linkSnappyPassword: validateSecret(secret || "") };
  invalid();
}

function replaceSingle(settings: AppSettings, command: Extract<AccountCommand, { action: "replace" }>): AppliedAccountCommand {
  if (!singleConfigured(settings, command.kind) || command.accountId !== `svc-${singleProvider(command.kind)}`) {
    invalid();
  }
  let identity = command.identity;
  let secret = command.secret?.trim() ? command.secret : undefined;
  if (command.kind === "realdebrid-api") secret ||= settings.token;
  if (command.kind === "bestdebrid-api") secret ||= settings.bestToken;
  if (command.kind === "alldebrid-api") secret ||= settings.allDebridToken;
  if (command.kind === "deepbrid-api") secret ||= settings.deepbridApiKey;
  if (command.kind === "ddownload-login") {
    identity = identity?.trim() ? identity : settings.ddownloadLogin;
    secret ||= settings.ddownloadPassword;
  }
  if (command.kind === "onefichier-api") secret ||= settings.oneFichierApiKey;
  if (command.kind === "linksnappy-login") {
    identity = identity?.trim() ? identity : settings.linkSnappyLogin;
    secret ||= settings.linkSnappyPassword;
  }
  const provider = singleProvider(command.kind);
  const next = setSingle(settings, command.kind, identity, secret);
  next.providerDailyLimitBytes = setLimit(settings.providerDailyLimitBytes as Record<string, number>, provider, command.dailyLimitBytes);
  return { settings: next, response: { accountId: command.accountId } };
}

function deleteSingle(settings: AppSettings, command: Extract<AccountCommand, { action: "delete" }>): AppliedAccountCommand {
  const provider = singleProvider(command.kind);
  if (!singleConfigured(settings, command.kind) || command.accountId !== `svc-${provider}`) {
    invalid();
  }
  let next = { ...settings };
  if (provider === "realdebrid") next = { ...next, token: "", realDebridUseWebLogin: false };
  if (provider === "bestdebrid") next = { ...next, bestToken: "", bestDebridUseWebLogin: false };
  if (provider === "alldebrid") next = { ...next, allDebridToken: "", allDebridUseWebLogin: false };
  if (provider === "deepbrid") next = { ...next, deepbridApiKey: "" };
  if (provider === "ddownload") next = { ...next, ddownloadLogin: "", ddownloadPassword: "" };
  if (provider === "onefichier") next = { ...next, oneFichierApiKey: "" };
  if (provider === "linksnappy") next = { ...next, linkSnappyLogin: "", linkSnappyPassword: "" };
  next.providerDailyLimitBytes = withoutKeys(settings.providerDailyLimitBytes as Record<string, number>, provider);
  next.providerDailyUsageBytes = withoutKeys(settings.providerDailyUsageBytes as Record<string, number>, provider);
  next.providerTotalUsageBytes = withoutKeys(settings.providerTotalUsageBytes as Record<string, number>, provider);
  next.debridAccountStatuses = withoutKeys(settings.debridAccountStatuses, command.accountId);
  return { settings: next, response: { accountId: null } };
}

function createSingle(settings: AppSettings, command: Extract<AccountCommand, { action: "create" }>): AppliedAccountCommand {
  if (singleConfigured(settings, command.kind)) {
    invalid();
  }
  const provider = singleProvider(command.kind);
  const next = setSingle(settings, command.kind, command.identity, command.secret);
  next.providerDailyLimitBytes = setLimit(settings.providerDailyLimitBytes as Record<string, number>, provider, command.dailyLimitBytes);
  return { settings: next, response: { accountId: `svc-${provider}` } };
}

export function applyAccountCommand(settings: AppSettings, command: AccountCommand): AppliedAccountCommand {
  if (command.action === "update-secret") {
    const replace: Extract<AccountCommand, { action: "replace" }> = {
      action: "replace",
      kind: command.kind,
      accountId: command.accountId,
      secret: command.secret
    };
    return applyAccountCommand(settings, replace);
  }
  if (command.kind === "realdebrid-api" || command.kind === "realdebrid-web") {
    const normalizedSettings = normalizeRealDebridCommandSettings(settings);
    if (command.action === "create") return createRealDebrid(normalizedSettings, command);
    if (command.action === "replace") return replaceRealDebrid(normalizedSettings, command);
    return deleteRealDebrid(normalizedSettings, command);
  }
  if (command.kind === "megadebrid-api" || command.kind === "megadebrid-web") {
    if (command.action === "create") return createMega(settings, command);
    if (command.action === "replace") return replaceMega(settings, command);
    return deleteMega(settings, command);
  }
  if (command.kind === "debridlink-api") {
    if (command.action === "create") return createDebridLink(settings, command);
    if (command.action === "replace") return replaceDebridLink(settings, command);
    return deleteDebridLink(settings, command);
  }
  if (command.action === "create") return createSingle(settings, command);
  if (command.action === "replace") return replaceSingle(settings, command);
  return deleteSingle(settings, command);
}
