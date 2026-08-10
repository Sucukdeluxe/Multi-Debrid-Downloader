import { win32 } from "node:path";
import type { HistoryEntry, HistoryRevealResult } from "../shared/types";

export interface HistoryRevealRequest {
  entryId: unknown;
}

export interface HistoryRevealStat {
  isDirectory: () => boolean;
}

export interface HistoryRevealDependencies {
  loadHistory: () => HistoryEntry[] | Promise<HistoryEntry[]>;
  stat: (directory: string) => Promise<HistoryRevealStat>;
  openPath: (directory: string) => Promise<string>;
}

function normalizeHistoryDirectory(value: unknown): string | null {
  if (typeof value !== "string" || value.length === 0 || /[\u0000-\u001f\u007f]/.test(value)) {
    return null;
  }
  const candidate = value.replaceAll("/", "\\");
  const lower = candidate.toLocaleLowerCase("en-US");
  if (
    lower.startsWith("\\\\.\\")
    || lower.startsWith("\\\\?\\")
    || lower.startsWith("\\??\\")
    || lower.startsWith("\\\\globalroot\\")
    || lower.startsWith("\\\\device\\")
  ) {
    return null;
  }
  const driveAbsolute = /^[A-Za-z]:\\/.test(candidate);
  const uncMatch = /^\\\\([^\\]+)\\([^\\]+)(?:\\.*)?$/.exec(candidate);
  if (!driveAbsolute && !uncMatch) {
    return null;
  }
  if (driveAbsolute) {
    if (candidate.slice(2).includes(":")) {
      return null;
    }
  } else if (candidate.includes(":")) {
    return null;
  }
  if (/[<>|"?*]/.test(driveAbsolute ? candidate.slice(3) : candidate.slice(2))) {
    return null;
  }
  if (uncMatch) {
    const server = uncMatch[1].toLocaleLowerCase("en-US");
    const share = uncMatch[2].toLocaleLowerCase("en-US");
    if ([".", "..", "?", "globalroot", "device"].includes(server) || share === "." || share === "..") {
      return null;
    }
  }
  const normalized = win32.normalize(candidate);
  if (/^[A-Za-z]:\\/.test(normalized)) {
    return normalized;
  }
  if (/^\\\\[^\\]+\\[^\\]+(?:\\.*)?$/.test(normalized)) {
    return normalized;
  }
  return null;
}

export async function revealHistoryEntry(
  request: HistoryRevealRequest,
  dependencies: HistoryRevealDependencies
): Promise<HistoryRevealResult> {
  if (
    typeof request.entryId !== "string"
    || request.entryId.length === 0
    || request.entryId.length > 256
    || request.entryId.trim() !== request.entryId
  ) {
    return { ok: false, reason: "entry-not-found" };
  }
  const entries = await dependencies.loadHistory();
  const entry = entries.find((candidate) => candidate.id === request.entryId);
  if (!entry) {
    return { ok: false, reason: "entry-not-found" };
  }
  const normalizedDirectory = normalizeHistoryDirectory(entry.outputDir);
  if (!normalizedDirectory) {
    return { ok: false, reason: "invalid-output-dir" };
  }
  let stat: HistoryRevealStat;
  try {
    stat = await dependencies.stat(normalizedDirectory);
  } catch (error) {
    const code = typeof error === "object" && error !== null && "code" in error
      ? (error as { code?: unknown }).code
      : undefined;
    return { ok: false, reason: code === "ENOENT" || code === "ENOTDIR" ? "output-dir-missing" : "open-failed" };
  }
  if (!stat.isDirectory()) {
    return { ok: false, reason: "output-dir-not-directory" };
  }
  try {
    const error = await dependencies.openPath(normalizedDirectory);
    return error === "" ? { ok: true } : { ok: false, reason: "open-failed" };
  } catch {
    return { ok: false, reason: "open-failed" };
  }
}
