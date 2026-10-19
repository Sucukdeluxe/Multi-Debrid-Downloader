import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { AppSettings } from "../shared/types";
import { parseProxyList } from "./proxy-segmented-download";

export const MAX_ONLINE_PROXY_LIST_BYTES = 8 * 1024 * 1024;
const MANAGED_PROXY_LIST_FILE = "proxy-list-online-backup.txt";

export function validateOnlineProxyListContent(content: string): void {
  const size = Buffer.byteLength(content, "utf8");
  if (size <= 0) throw new Error("Die Proxy-Liste ist leer");
  if (size > MAX_ONLINE_PROXY_LIST_BYTES) throw new Error("Die Proxy-Liste ist für eine Online-Sicherung zu groß");
  if (parseProxyList(content) <= 0) throw new Error("Die Proxy-Liste enthält keine gültigen HTTP-Proxys");
}

export function captureOnlineProxyList(settings: Pick<AppSettings, "proxyDownloadEnabled" | "proxyListPath">): string | undefined {
  const filePath = String(settings.proxyListPath || "").trim();
  if (!filePath) {
    if (settings.proxyDownloadEnabled) throw new Error("Proxy-only ist aktiviert, aber es ist keine Proxy-Liste hinterlegt");
    return undefined;
  }
  let stat: fs.Stats;
  try {
    stat = fs.statSync(path.resolve(filePath));
  } catch {
    throw new Error("Die hinterlegte Proxy-Liste kann nicht gelesen werden");
  }
  if (!stat.isFile()) throw new Error("Die hinterlegte Proxy-Liste kann nicht gelesen werden");
  if (stat.size <= 0) throw new Error("Die Proxy-Liste ist leer");
  if (stat.size > MAX_ONLINE_PROXY_LIST_BYTES) throw new Error("Die Proxy-Liste ist für eine Online-Sicherung zu groß");
  let content: string;
  try {
    content = fs.readFileSync(path.resolve(filePath), "utf8");
  } catch {
    throw new Error("Die hinterlegte Proxy-Liste kann nicht gelesen werden");
  }
  validateOnlineProxyListContent(content);
  return content;
}

export function getManagedOnlineProxyListPath(baseDir: string): string {
  return path.join(baseDir, MANAGED_PROXY_LIST_FILE);
}

export function writeImportedOnlineProxyList(baseDir: string, content: string): string {
  validateOnlineProxyListContent(content);
  const filePath = getManagedOnlineProxyListPath(baseDir);
  const tempPath = `${filePath}.${process.pid}.${randomUUID()}.tmp`;
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  let descriptor: number | null = null;
  try {
    descriptor = fs.openSync(tempPath, "wx", 0o600);
    fs.writeFileSync(descriptor, content, "utf8");
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = null;
    fs.renameSync(tempPath, filePath);
    return filePath;
  } catch (error) {
    if (descriptor !== null) {
      try { fs.closeSync(descriptor); } catch {}
    }
    try { fs.rmSync(tempPath, { force: true }); } catch {}
    throw error;
  }
}
