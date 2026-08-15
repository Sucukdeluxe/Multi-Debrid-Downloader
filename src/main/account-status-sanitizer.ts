import { parseDebridLinkApiKeys } from "../shared/debrid-link-keys";
import { parseMegaDebridAccounts } from "../shared/mega-debrid-accounts";
import { parseRealDebridApiAccounts } from "../shared/real-debrid-accounts";
import type { AppSettings, DebridAccountStatus } from "../shared/types";

const REDACTED = "[geschützt]";

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return "";
  }
}

function addRedaction(values: Set<string>, value: unknown): void {
  if (typeof value !== "string") {
    return;
  }
  const raw = value;
  const trimmed = value.trim();
  for (const candidate of [raw, trimmed]) {
    if (!candidate) {
      continue;
    }
    values.add(candidate);
    const encoded = encodeURIComponent(candidate);
    values.add(encoded);
    values.add(encoded.replace(/%20/g, "+"));
    const decoded = safeDecode(candidate);
    if (decoded) {
      values.add(decoded);
    }
  }
}

function getInputString(input: unknown, key: string): string | undefined {
  if (!input || typeof input !== "object") {
    return undefined;
  }
  const value = (input as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

export function collectAccountStatusRedactionValues(settings?: AppSettings, input?: unknown): string[] {
  const values = new Set<string>();
  if (settings) {
    addRedaction(values, settings.token);
    addRedaction(values, settings.realDebridApiTokens);
    addRedaction(values, settings.megaPassword);
    addRedaction(values, settings.megaCredentials);
    addRedaction(values, settings.megaDebridApiCredentials);
    addRedaction(values, settings.megaDebridWebCredentials);
    addRedaction(values, settings.bestToken);
    addRedaction(values, settings.allDebridToken);
    addRedaction(values, settings.ddownloadPassword);
    addRedaction(values, settings.oneFichierApiKey);
    addRedaction(values, settings.debridLinkApiKeys);
    addRedaction(values, settings.linkSnappyPassword);
    addRedaction(values, settings.archivePasswordList);
    addRedaction(values, settings.notifyUrl);
    for (const raw of [settings.megaCredentials, settings.megaDebridApiCredentials, settings.megaDebridWebCredentials]) {
      for (const account of parseMegaDebridAccounts(raw, settings.megaPassword)) {
        addRedaction(values, account.password);
        addRedaction(values, `${account.login}:${account.password}`);
      }
    }
    for (const key of parseDebridLinkApiKeys(settings.debridLinkApiKeys)) {
      addRedaction(values, key.token);
    }
    for (const account of parseRealDebridApiAccounts(settings.realDebridApiTokens)) {
      addRedaction(values, account.token);
    }
  }
  const inputIdentity = getInputString(input, "identity");
  const inputSecret = getInputString(input, "secret");
  addRedaction(values, inputSecret);
  if (inputIdentity && inputSecret) {
    addRedaction(values, `${inputIdentity.trim()}:${inputSecret.trim()}`);
  }
  return [...values].filter(Boolean).sort((left, right) => right.length - left.length);
}

export function sanitizeAccountStatusText(value: string, redactions: readonly string[]): string {
  let result = value;
  result = result.replace(/\b(?:Authorization|Proxy-Authorization)\s*:\s*[^\r\n]+/gi, (match) => {
    const name = match.slice(0, match.indexOf(":"));
    return `${name}: ${REDACTED}`;
  });
  result = result.replace(/\b(?:Cookie|Set-Cookie)\s*:\s*[^\r\n]+/gi, (match) => {
    const name = match.slice(0, match.indexOf(":"));
    return `${name}: ${REDACTED}`;
  });
  result = result.replace(/\b(?:X-Api-Key|Api-Key|X-Auth-Token|X-Access-Token|Access-Token|Private-Token)\s*:\s*[^\r\n]+/gi, (match) => {
    const name = match.slice(0, match.indexOf(":"));
    return `${name}: ${REDACTED}`;
  });
  result = result.replace(/((?:[?&;\s,]|^)(?:password|pass|pwd|token|api[_-]?key|apikey|access[_-]?token|private[_-]?token|secret|session|cookie|(?:backup|archive)?[_ -]?passphrase|archive[_ -]?password)\s*[:=]\s*)[^&\s"')]+/gi, `$1${REDACTED}`);
  for (const secret of redactions) {
    result = result.split(secret).join(REDACTED);
  }
  return result;
}

export function sanitizeDebridAccountStatus(status: DebridAccountStatus, redactions: readonly string[]): DebridAccountStatus {
  return {
    ...status,
    accountId: sanitizeAccountStatusText(status.accountId, redactions),
    label: sanitizeAccountStatusText(status.label, redactions),
    maskedLogin: sanitizeAccountStatusText(status.maskedLogin, redactions),
    username: status.username ? sanitizeAccountStatusText(status.username, redactions) : undefined,
    email: status.email ? sanitizeAccountStatusText(status.email, redactions) : undefined,
    message: sanitizeAccountStatusText(status.message, redactions)
  };
}

export function sanitizeDebridAccountStatuses(statuses: readonly DebridAccountStatus[], redactions: readonly string[]): DebridAccountStatus[] {
  return statuses.map((status) => sanitizeDebridAccountStatus(status, redactions));
}
