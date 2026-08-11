import type { AccountDeleteCommand, AccountReplaceCommand, DebridProvider, RendererAccount, RendererAccountKind } from "../shared/types";

export type AccountService = "realdebrid" | "megadebrid-api" | "megadebrid-web" | "bestdebrid" | "alldebrid" | "ddownload" | "onefichier" | "debridlink" | "linksnappy";
export type AccountKind = RendererAccountKind;
export type SingleAccountKind = Exclude<AccountKind, "megadebrid-api" | "megadebrid-web" | "debridlink-api">;

export type AccountEditTarget =
  | { type: "single"; rowKey: string; kind: SingleAccountKind; service: AccountService; provider: DebridProvider }
  | { type: "mega"; rowKey: string; kind: "megadebrid-api" | "megadebrid-web"; service: "megadebrid-api" | "megadebrid-web"; accountId: string }
  | { type: "debridlink"; rowKey: string; kind: "debridlink-api"; service: "debridlink"; keyId: string };

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
  if (!Number.isFinite(limitBytes) || limitBytes <= 0) return "";
  const gib = limitBytes / BYTES_PER_GIB;
  const precision = gib >= 100 ? 0 : gib >= 10 ? 1 : 2;
  return gib.toFixed(precision).replace(/\.0+$/, "").replace(/(\.\d*?)0+$/, "$1");
}

function parseDailyLimit(value: string, originalBytes: number): number {
  if (value === formatDailyLimit(originalBytes)) return originalBytes;
  const normalized = value.trim().replace(",", ".");
  if (!normalized) return 0;
  return Math.floor(Number(normalized) * BYTES_PER_GIB);
}

function targetAccountId(target: AccountEditTarget): string {
  if (target.type === "mega") return target.accountId;
  if (target.type === "debridlink") return target.keyId;
  return `svc-${target.provider}`;
}

export function createAccountEditState(target: AccountEditTarget, accounts: readonly RendererAccount[]): AccountEditState {
  const account = accounts.find((entry) => entry.accountId === targetAccountId(target) && entry.kind === target.kind);
  if (!account) {
    throw new Error("Der ausgewählte Account wurde nicht gefunden.");
  }
  return {
    target,
    login: account.identity,
    password: "",
    token: "",
    dailyLimitGb: formatDailyLimit(account.dailyLimitBytes),
    originalDailyLimitBytes: account.dailyLimitBytes
  };
}

export function validateAccountEdit(state: AccountEditState, accounts: readonly RendererAccount[]): string | null {
  const normalizedLimit = state.dailyLimitGb.trim().replace(",", ".");
  if (normalizedLimit && (!Number.isFinite(Number(normalizedLimit)) || Number(normalizedLimit) < 0)) {
    return "Das Tageslimit muss eine positive Zahl oder 0 sein.";
  }
  const accountId = targetAccountId(state.target);
  if (!accounts.some((entry) => entry.accountId === accountId && entry.kind === state.target.kind)) {
    return "Der ausgewählte Account wurde nicht gefunden.";
  }
  if (state.target.type === "mega") {
    const login = state.login.trim();
    if (!login) return "Der Login wird benötigt.";
    if (/[:\r\n]/.test(login)) return "Der Login darf keinen Doppelpunkt oder Zeilenumbruch enthalten.";
    if (/[\r\n]/.test(state.password)) return "Das Passwort darf keinen Zeilenumbruch enthalten.";
    if (accounts.some((entry) => entry.kind === state.target.kind && entry.accountId !== accountId && entry.identity.toLowerCase() === login.toLowerCase())) {
      return "Dieser Mega-Debrid-Login ist bereits vorhanden.";
    }
  }
  if (state.target.type === "debridlink" && /[,\r\n]/.test(state.token)) {
    return "Beim Bearbeiten ist genau ein API-Key erlaubt.";
  }
  if (state.target.type === "single" && (state.target.kind === "ddownload-login" || state.target.kind === "linksnappy-login")) {
    if (!state.login.trim()) return "Der Login wird benötigt.";
    if (/[\r\n]/.test(state.password)) return "Das Passwort darf keinen Zeilenumbruch enthalten.";
  }
  return null;
}

export function buildAccountReplaceCommand(state: AccountEditState): AccountReplaceCommand {
  return {
    action: "replace",
    kind: state.target.kind,
    accountId: targetAccountId(state.target),
    identity: state.target.type === "debridlink" ? undefined : state.login.trim(),
    secret: state.target.type === "debridlink" ? state.token : state.target.type === "single" && !["ddownload-login", "linksnappy-login"].includes(state.target.kind) ? state.token : state.password,
    dailyLimitBytes: parseDailyLimit(state.dailyLimitGb, state.originalDailyLimitBytes)
  };
}

export function buildAccountDeleteCommand(target: AccountEditTarget): AccountDeleteCommand {
  return { action: "delete", kind: target.kind, accountId: targetAccountId(target) };
}
