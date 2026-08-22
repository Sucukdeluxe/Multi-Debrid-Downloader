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

export async function importDroppedDlcFiles<T>(
  files: ReadonlyArray<File>,
  getPathForFile: (file: File) => string,
  addContainers: (filePaths: string[]) => Promise<T>
): Promise<T | null> {
  const filePaths = resolveDroppedDlcPaths(files, getPathForFile);
  return filePaths.length > 0 ? addContainers(filePaths) : null;
}
