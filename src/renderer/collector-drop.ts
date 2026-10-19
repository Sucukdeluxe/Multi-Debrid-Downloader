export type CollectorDlcDropMode = "downloads" | "collector";

export function resolveDroppedDlcPaths(
  files: ReadonlyArray<File>,
  getPathForFile: (file: File) => string
): string[] {
  const paths: string[] = [];
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".dlc")) continue;
    try {
      const filePath = String(getPathForFile(file) || "").trim();
      if (filePath) paths.push(filePath);
    } catch {
    }
  }
  return paths;
}

export async function routeDroppedDlcFiles<TDownload, TCollector>(
  files: ReadonlyArray<File>,
  mode: CollectorDlcDropMode,
  getPathForFile: (file: File) => string,
  dependencies: {
    addContainers: (filePaths: string[]) => Promise<TDownload>;
    inspectContainers: (filePaths: string[], addedAt: number) => Promise<TCollector>;
  },
  addedAt = Date.now()
): Promise<
  | { kind: "empty" }
  | { kind: "downloads"; result: TDownload }
  | { kind: "collector"; result: TCollector }
> {
  const filePaths = resolveDroppedDlcPaths(files, getPathForFile);
  if (filePaths.length === 0) return { kind: "empty" };
  if (mode === "downloads") {
    return { kind: "downloads", result: await dependencies.addContainers(filePaths) };
  }
  return { kind: "collector", result: await dependencies.inspectContainers(filePaths, addedAt) };
}
