import path from "node:path";

export function resolveAppIconPath(isPackaged: boolean, appPath: string, resourcesPath: string): string {
  const basePath = isPackaged ? resourcesPath : appPath;
  return path.join(basePath, "assets", "app_icon.ico");
}
