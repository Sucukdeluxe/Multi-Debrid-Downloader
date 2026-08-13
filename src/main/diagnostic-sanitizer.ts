import crypto from "node:crypto";

export interface DiagnosticRedactions {
  accountValues?: readonly string[];
  secretValues?: readonly string[];
}

const REDACTED = "<redacted>";
const REDACTED_ACCOUNT = "<redacted-account>";
const REDACTED_PATH = "<redacted-path>";
const DIAGNOSTIC_LINK_RE = /^[a-z0-9.-]+#[a-f0-9]{10}$/i;
const SECRET_FIELD_NAMES = new Set([
  "password",
  "passwords",
  "passwd",
  "pwd",
  "token",
  "tokens",
  "apitoken",
  "accesstoken",
  "refreshtoken",
  "apikey",
  "apikeys",
  "secret",
  "clientsecret",
  "auth",
  "authorization",
  "proxyauthorization",
  "cookie",
  "cookies",
  "sessioncookie",
  "setcookie",
  "session",
  "credential",
  "credentials"
]);
const ACCOUNT_FIELD_NAMES = new Set(["login", "username", "user", "email", "accountlogin", "accountemail"]);
const LINK_FIELD_NAMES = new Set([
  "link",
  "url",
  "sourceurl",
  "sourcelink",
  "directurl",
  "downloadurl",
  "resumeurl",
  "redirecturl",
  "targeturl",
  "directlink"
]);
const PATH_FIELD_NAMES = new Set([
  "path",
  "filepath",
  "localpath",
  "targetpath",
  "outputpath",
  "extractpath",
  "directory",
  "dir",
  "outputdir",
  "extractdir",
  "downloadpath"
]);

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sensitiveVariants(value: string): string[] {
  const trimmed = value.trim();
  if (!trimmed) {
    return [];
  }
  const variants = new Set<string>([trimmed]);
  variants.add(encodeURIComponent(trimmed));
  const jsonEscaped = JSON.stringify(trimmed).slice(1, -1);
  if (jsonEscaped) {
    variants.add(jsonEscaped);
  }
  return [...variants].filter(Boolean).sort((left, right) => right.length - left.length);
}

function replaceSensitiveValue(source: string, value: string, replacement: string, caseInsensitive: boolean): string {
  let output = source;
  for (const variant of sensitiveVariants(value)) {
    const escaped = escapeRegExp(variant);
    const flags = caseInsensitive ? "gi" : "g";
    if (variant.length >= 4) {
      output = output.replace(new RegExp(escaped, flags), () => replacement);
      continue;
    }
    output = output.replace(
      new RegExp(`(^|[^A-Za-z0-9])${escaped}(?=$|[^A-Za-z0-9])`, flags),
      (_match, prefix: string) => `${prefix}${replacement}`
    );
  }
  return output;
}

export function formatDiagnosticLink(value: unknown): string {
  const raw = String(value || "").trim();
  if (DIAGNOSTIC_LINK_RE.test(raw)) {
    return raw.toLowerCase();
  }
  let host = "unknown";
  try {
    const parsed = new URL(raw);
    host = parsed.protocol === "file:"
      ? "local"
      : parsed.hostname.trim().toLowerCase() || "unknown";
  } catch {
  }
  const fingerprint = crypto.createHash("sha256").update(raw).digest("hex").slice(0, 10);
  return `${host}#${fingerprint}`;
}

export function sanitizeDiagnosticAccountLabel(value: unknown): string {
  const raw = String(value || "");
  const match = raw.match(/\b(Account|Key)\s+(\d+)(?:\/(\d+))?/i);
  if (!match) {
    const shorthand = raw.match(/(?:^|[^A-Za-z0-9])(\d+)\/(\d+)(?=$|[^A-Za-z0-9])/);
    const kind = /\bkey\b/i.test(raw) ? "Key" : "Account";
    return shorthand ? `${kind} ${shorthand[1]}/${shorthand[2]}` : kind;
  }
  const kind = match[1].toLowerCase() === "key" ? "Key" : "Account";
  return `${kind} ${match[2]}${match[3] ? `/${match[3]}` : ""}`;
}

export function sanitizeDiagnosticText(value: unknown, redactions: DiagnosticRedactions = {}): string {
  let output = String(value ?? "").replace(/\0/g, "");
  output = output.replace(/\b(?:https?|file):\/\/[^\s"'<>]+/gi, (url) => formatDiagnosticLink(url));
  output = output.replace(/\b[A-Z]:[\\/][^|,;\r\n"'<>]*/gi, REDACTED_PATH);
  output = output.replace(/\\\\[^\\/\s"'<>|]+[\\/][^|,;\r\n"'<>]*/g, REDACTED_PATH);
  output = output.replace(/(?<![A-Za-z0-9.:])\/(?:[^/\s"'<>|]+\/)+[^/\s"'<>|]*/g, REDACTED_PATH);
  output = output.replace(/\b((?:Account|Key)\s+\d+(?:\/\d+)?)\s*\([^)\r\n]*\)/gi, "$1");
  output = output.replace(/\b(Authorization|Proxy-Authorization)\s*[:=]\s*[^\r\n|]+/gi, "$1: <redacted>");
  output = output.replace(/\b(Cookie|Set-Cookie)\s*[:=]\s*[^\r\n|]+/gi, "$1: <redacted>");
  output = output.replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/-]+=*/gi, "$1 <redacted>");
  output = output.replace(
    /(["']?)\b(password|passwd|pwd|token|access[_-]?token|refresh[_-]?token|api[_ -]?key|apikey|secret|client[_-]?secret|auth|session)\b\1(\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;|]+)/gi,
    "$1$2$1$3<redacted>"
  );
  output = output.replace(
    /(["']?)\b(login|username|user|email)\b\1(\s*[:=]\s*)(?:"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[^\s,;|]+)/gi,
    "$1$2$1$3<redacted-account>"
  );
  output = output.replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, REDACTED_ACCOUNT);
  output = output.replace(
    /(^|[^A-Za-z0-9._%+@-])([A-Za-z0-9._%+@-]*\*+[A-Za-z0-9._%+@-]*)(?=$|[^A-Za-z0-9._%+@-])/g,
    `$1${REDACTED_ACCOUNT}`
  );
  for (const accountValue of redactions.accountValues || []) {
    output = replaceSensitiveValue(output, accountValue, REDACTED_ACCOUNT, true);
  }
  for (const secretValue of redactions.secretValues || []) {
    output = replaceSensitiveValue(output, secretValue, REDACTED, false);
  }
  return output.replace(/\r?\n/g, "\\n");
}

function normalizeFieldName(key: string): string {
  return key.replace(/[\s_-]+/g, "").toLowerCase();
}

function sanitizeDiagnosticFieldValue(
  key: string,
  value: unknown,
  redactions: DiagnosticRedactions,
  seen: WeakSet<object>
): unknown {
  const normalizedKey = normalizeFieldName(key);
  if (value === undefined || value === null) {
    return value;
  }
  if (SECRET_FIELD_NAMES.has(normalizedKey)) {
    return REDACTED;
  }
  if (ACCOUNT_FIELD_NAMES.has(normalizedKey)) {
    return REDACTED_ACCOUNT;
  }
  if (LINK_FIELD_NAMES.has(normalizedKey)) {
    return formatDiagnosticLink(value);
  }
  if (PATH_FIELD_NAMES.has(normalizedKey) || normalizedKey.endsWith("path") || normalizedKey.endsWith("dir")) {
    return REDACTED_PATH;
  }
  if (["account", "accountlabel"].includes(normalizedKey)) {
    return sanitizeDiagnosticAccountLabel(value);
  }
  if (typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    return sanitizeDiagnosticText(value, redactions);
  }
  if (typeof value !== "object") {
    return sanitizeDiagnosticText(value, redactions);
  }
  if (seen.has(value)) {
    return REDACTED;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeDiagnosticFieldValue("", entry, redactions, seen));
  }
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length === 0) {
    return sanitizeDiagnosticText(value, redactions);
  }
  return Object.fromEntries(entries.map(([nestedKey, nestedValue]) => [
    sanitizeDiagnosticText(nestedKey, redactions),
    sanitizeDiagnosticFieldValue(nestedKey, nestedValue, redactions, seen)
  ]));
}

export function sanitizeDiagnosticFields(
  fields?: Record<string, unknown>,
  redactions: DiagnosticRedactions = {}
): Record<string, unknown> | undefined {
  if (!fields) {
    return undefined;
  }
  const seen = new WeakSet<object>();
  return Object.fromEntries(Object.entries(fields).map(([key, value]) => [
    sanitizeDiagnosticText(key, redactions),
    sanitizeDiagnosticFieldValue(key, value, redactions, seen)
  ]));
}
