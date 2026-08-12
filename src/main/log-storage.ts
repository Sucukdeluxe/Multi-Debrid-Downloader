import fs from "node:fs";
import path from "node:path";
import type { LogStorageLocation } from "../shared/types";

export const DESKTOP_LOG_DIRECTORY_NAME = "Downloader Log";
export const LEGACY_DESKTOP_LOG_DIRECTORY_NAME = "Downloader-Log";

const LOG_FILE_NAMES = new Set([
  "rd_downloader.log",
  "audit.log",
  "account-rotation.log",
  "conversion.log",
  "rename.log",
  "trace.log",
  "trace_config.json"
]);

const LOG_DIRECTORY_NAMES = new Set(["session-logs", "package-logs", "item-logs"]);

export interface LogMigrationResult {
  copiedFiles: number;
  skippedFiles: number;
}

function samePath(left: string, right: string): boolean {
  const normalizedLeft = path.resolve(left);
  const normalizedRight = path.resolve(right);
  return process.platform === "win32"
    ? normalizedLeft.toLowerCase() === normalizedRight.toLowerCase()
    : normalizedLeft === normalizedRight;
}

function mergeTextFile(sourcePath: string, targetPath: string): boolean {
  try {
    const source = fs.readFileSync(sourcePath, "utf8");
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    if (!fs.existsSync(targetPath)) {
      fs.writeFileSync(targetPath, source, "utf8");
      return true;
    }
    const target = fs.readFileSync(targetPath, "utf8");
    if (target === source || target.startsWith(source)) {
      return false;
    }
    if (source.startsWith(target)) {
      fs.appendFileSync(targetPath, source.slice(target.length), "utf8");
      return true;
    }
    const separator = target.endsWith("\n") ? "" : "\n";
    fs.appendFileSync(targetPath, `${separator}${source}`, "utf8");
    return true;
  } catch {
    return false;
  }
}

function copyTraceConfig(sourcePath: string, targetPath: string): boolean {
  try {
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    const source = fs.readFileSync(sourcePath, "utf8");
    if (fs.existsSync(targetPath) && fs.readFileSync(targetPath, "utf8") === source) {
      return false;
    }
    fs.writeFileSync(targetPath, source, "utf8");
    return true;
  } catch {
    return false;
  }
}

function isRootLogFile(fileName: string): boolean {
  const baseName = fileName.endsWith(".old") ? fileName.slice(0, -4) : fileName;
  return LOG_FILE_NAMES.has(baseName) || /^rename-session_.*\.txt$/i.test(fileName);
}

function copyAllowedEntries(sourceDirectory: string, targetDirectory: string, result: LogMigrationResult): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sourceDirectory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);
    if (entry.isDirectory()) {
      if (!LOG_DIRECTORY_NAMES.has(entry.name)) {
        continue;
      }
      fs.mkdirSync(targetPath, { recursive: true });
      copyDirectoryFiles(sourcePath, targetPath, result);
      continue;
    }
    if (!entry.isFile() || !isRootLogFile(entry.name)) {
      result.skippedFiles += 1;
      continue;
    }
    const copied = entry.name === "trace_config.json"
      ? copyTraceConfig(sourcePath, targetPath)
      : mergeTextFile(sourcePath, targetPath);
    if (copied) {
      result.copiedFiles += 1;
    }
  }
}

function copyDirectoryFiles(sourceDirectory: string, targetDirectory: string, result: LogMigrationResult): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(sourceDirectory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const sourcePath = path.join(sourceDirectory, entry.name);
    const targetPath = path.join(targetDirectory, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(targetPath, { recursive: true });
      copyDirectoryFiles(sourcePath, targetPath, result);
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }
    if (mergeTextFile(sourcePath, targetPath)) {
      result.copiedFiles += 1;
    }
  }
}

export function resolveLogDirectory(
  runtimeDirectory: string,
  desktopDirectory: string | null | undefined,
  location: LogStorageLocation
): string {
  const runtimePath = path.resolve(runtimeDirectory);
  const desktopPath = String(desktopDirectory || "").trim();
  if (location === "desktop" && desktopPath) {
    return path.resolve(desktopPath, DESKTOP_LOG_DIRECTORY_NAME);
  }
  return runtimePath;
}

export function getLegacyDesktopLogDirectory(desktopDirectory: string | null | undefined): string | null {
  const desktopPath = String(desktopDirectory || "").trim();
  return desktopPath ? path.resolve(desktopPath, LEGACY_DESKTOP_LOG_DIRECTORY_NAME) : null;
}

export function prepareLogDirectory(directory: string): boolean {
  try {
    fs.mkdirSync(directory, { recursive: true });
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

export function migrateLogDirectories(sourceDirectories: readonly string[], targetDirectory: string): LogMigrationResult {
  const result: LogMigrationResult = { copiedFiles: 0, skippedFiles: 0 };
  if (!prepareLogDirectory(targetDirectory)) {
    return result;
  }
  for (const sourceDirectory of sourceDirectories) {
    if (!sourceDirectory || samePath(sourceDirectory, targetDirectory)) {
      continue;
    }
    copyAllowedEntries(sourceDirectory, targetDirectory, result);
  }
  return result;
}
