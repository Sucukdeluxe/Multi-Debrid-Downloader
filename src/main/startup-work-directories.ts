import fs from "node:fs";
import path from "node:path";
import type { AppSettings } from "../shared/types";

export type StartupWorkDirectoryKind = "download" | "extract" | "video-library";

export interface StartupWorkDirectoryEntry {
  kind: StartupWorkDirectoryKind;
  directory: string;
}

export interface StartupWorkDirectoryFailure extends StartupWorkDirectoryEntry {
  error: string;
}

export interface StartupWorkDirectoryResult {
  created: StartupWorkDirectoryEntry[];
  existing: StartupWorkDirectoryEntry[];
  failures: StartupWorkDirectoryFailure[];
}

function directoryKey(directory: string): string {
  const resolved = path.resolve(directory);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function ensureStartupWorkDirectories(settings: AppSettings): StartupWorkDirectoryResult {
  const result: StartupWorkDirectoryResult = { created: [], existing: [], failures: [] };
  if (!settings.createWorkDirectoriesOnStartup) {
    return result;
  }

  const candidates: StartupWorkDirectoryEntry[] = [
    { kind: "download", directory: settings.outputDir },
    ...(settings.autoExtract ? [{ kind: "extract" as const, directory: settings.extractDir }] : []),
    ...(settings.collectMkvToLibrary ? [{ kind: "video-library" as const, directory: settings.mkvLibraryDir }] : [])
  ];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const entry = { ...candidate, directory: path.resolve(candidate.directory) };
    const key = directoryKey(entry.directory);
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    const existed = fs.existsSync(entry.directory);
    try {
      fs.mkdirSync(entry.directory, { recursive: true });
      (existed ? result.existing : result.created).push(entry);
    } catch (error) {
      result.failures.push({ ...entry, error: String(error) });
    }
  }

  return result;
}
