import fs from "node:fs";
import path from "node:path";

function normalizedVersion(value: unknown): string {
  const version = String(value || "").trim();
  return /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version) ? version : "";
}

export function resolveRuntimeAppVersion(
  fallbackVersion: string,
  resourcesPath: string = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath || ""
): string {
  if (resourcesPath) {
    for (const relativePath of ["app.asar/package.json", "app/package.json"]) {
      try {
        const payload = JSON.parse(fs.readFileSync(path.join(resourcesPath, ...relativePath.split("/")), "utf8")) as { version?: unknown };
        const version = normalizedVersion(payload.version);
        if (version) return version;
      } catch {
      }
    }
  }
  return normalizedVersion(fallbackVersion) || "0.0.0";
}
