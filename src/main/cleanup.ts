import fs from "node:fs";
import path from "node:path";
import { ARCHIVE_TEMP_EXTENSIONS, LINK_ARTIFACT_EXTENSIONS, MAX_LINK_ARTIFACT_BYTES, RAR_SPLIT_RE, SAMPLE_DIR_NAMES, SAMPLE_TOKEN_RE, SAMPLE_VIDEO_EXTENSIONS } from "./constants";

async function yieldToLoop(): Promise<void> {
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
  });
}

async function isDownloadLinkArtifact(filePath: string): Promise<boolean> {
  const fileName = path.basename(filePath);
  const ext = path.extname(fileName).toLowerCase();
  const name = fileName.toLowerCase();
  if (LINK_ARTIFACT_EXTENSIONS.has(ext)) {
    return true;
  }
  if (![".txt", ".html", ".htm", ".nfo"].includes(ext)
    || !/[._\- ](links?|downloads?|urls?|dlc)([._\- ]|$)/i.test(name)) {
    return false;
  }
  try {
    const stat = await fs.promises.lstat(filePath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_LINK_ARTIFACT_BYTES) {
      return false;
    }
    const text = await fs.promises.readFile(filePath, "utf8");
    return /https?:\/\//i.test(text);
  } catch {
    return false;
  }
}

async function removeEmptyParentChains(rootDir: string, parents: ReadonlySet<string>): Promise<number> {
  const rootPath = path.resolve(rootDir);
  const candidates = new Set<string>();
  for (const parent of parents) {
    let current = path.resolve(parent);
    while (current !== rootPath && current.startsWith(`${rootPath}${path.sep}`)) {
      candidates.add(current);
      current = path.dirname(current);
    }
  }
  let removed = 0;
  for (const directory of [...candidates].sort((left, right) => right.length - left.length)) {
    try {
      const entries = await fs.promises.readdir(directory);
      if (entries.length === 0) {
        await fs.promises.rmdir(directory);
        removed += 1;
      }
    } catch {
    }
  }
  return removed;
}

export function isArchiveOrTempFile(filePath: string): boolean {
  const lowerName = path.basename(filePath).toLowerCase();
  const ext = path.extname(lowerName);
  if (ARCHIVE_TEMP_EXTENSIONS.has(ext)) {
    return true;
  }
  if (lowerName.includes(".part") && lowerName.endsWith(".rar")) {
    return true;
  }
  return RAR_SPLIT_RE.test(lowerName);
}

export function cleanupCancelledPackageArtifacts(packageDir: string): number {
  if (!fs.existsSync(packageDir)) {
    return 0;
  }
  let removed = 0;
  const stack = [packageDir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try { entries = fs.readdirSync(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        stack.push(full);
      } else if (entry.isFile() && isArchiveOrTempFile(full)) {
        try {
          fs.rmSync(full, { force: true });
          removed += 1;
        } catch {
        }
      }
    }
  }
  return removed;
}

export async function cleanupCancelledPackageArtifactsAsync(
  packageDir: string,
  options: { shouldAbort?: () => boolean } = {}
): Promise<number> {
  try {
    await fs.promises.access(packageDir, fs.constants.F_OK);
  } catch {
    return 0;
  }

  let removed = 0;
  let touched = 0;
  const stack = [packageDir];
  while (stack.length > 0) {
    if (options.shouldAbort?.()) {
      return removed;
    }
    const current = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try {
      entries = await fs.promises.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (options.shouldAbort?.()) {
        return removed;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        stack.push(full);
      } else if (entry.isFile() && isArchiveOrTempFile(full)) {
        try {
          await fs.promises.rm(full, { force: true });
          removed += 1;
        } catch {
        }
      }

      touched += 1;
      if (touched % 80 === 0) {
        await yieldToLoop();
      }
    }
  }
  return removed;
}

export async function removeDownloadLinkArtifacts(
  extractDir: string,
  options: { shouldAbort?: () => boolean } = {}
): Promise<number> {
  try {
    await fs.promises.access(extractDir);
  } catch {
    return 0;
  }
  let removed = 0;
  const stack = [extractDir];
  while (stack.length > 0) {
    if (options.shouldAbort?.()) {
      return removed;
    }
    const current = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try { entries = await fs.promises.readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (options.shouldAbort?.()) {
        return removed;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        stack.push(full);
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const shouldDelete = await isDownloadLinkArtifact(full);

      if (shouldDelete) {
        try {
          await fs.promises.rm(full, { force: true });
          removed += 1;
        } catch {
        }
      }
    }
  }
  return removed;
}

export async function removeDownloadLinkArtifactsFromScope(
  outputFiles: readonly string[],
  options: { shouldAbort?: () => boolean; rootDir?: string } = {}
): Promise<number> {
  let removed = 0;
  const parents = new Set<string>();
  for (const outputFile of outputFiles) {
    if (options.shouldAbort?.()) {
      return removed;
    }
    if (!await isDownloadLinkArtifact(outputFile)) {
      continue;
    }
    try {
      await fs.promises.rm(outputFile, { force: true });
      parents.add(path.dirname(outputFile));
      removed += 1;
    } catch {
    }
  }
  if (options.rootDir) {
    await removeEmptyParentChains(options.rootDir, parents);
  }
  return removed;
}

export async function removeSampleArtifacts(
  extractDir: string,
  options: { shouldAbort?: () => boolean } = {}
): Promise<{ files: number; dirs: number }> {
  try {
    await fs.promises.access(extractDir);
  } catch {
    return { files: 0, dirs: 0 };
  }

  let removedFiles = 0;
  let removedDirs = 0;
  const sampleDirs: string[] = [];
  const stack = [extractDir];

  const countFilesRecursive = async (rootDir: string): Promise<number> => {
    let count = 0;
    const dirs = [rootDir];
    while (dirs.length > 0) {
      const current = dirs.pop() as string;
      let entries: fs.Dirent[] = [];
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true });
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = path.join(current, entry.name);
        if (entry.isDirectory()) {
          try {
            const stat = await fs.promises.lstat(full);
            if (stat.isSymbolicLink()) {
              continue;
            }
          } catch {
            continue;
          }
          dirs.push(full);
        } else if (entry.isFile()) {
          count += 1;
        }
      }
    }
    return count;
  };

  while (stack.length > 0) {
    if (options.shouldAbort?.()) {
      return { files: removedFiles, dirs: removedDirs };
    }
    const current = stack.pop() as string;
    let entries: fs.Dirent[] = [];
    try { entries = await fs.promises.readdir(current, { withFileTypes: true }); } catch { continue; }
    for (const entry of entries) {
      if (options.shouldAbort?.()) {
        return { files: removedFiles, dirs: removedDirs };
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory() || entry.isSymbolicLink()) {
        const base = entry.name.toLowerCase();
        if (SAMPLE_DIR_NAMES.has(base)) {
          sampleDirs.push(full);
          continue;
        }
        if (entry.isDirectory()) {
          stack.push(full);
        }
        continue;
      }
      if (!entry.isFile()) {
        continue;
      }

      const stem = path.parse(entry.name).name.toLowerCase();
      const ext = path.extname(entry.name).toLowerCase();
      const isSampleVideo = SAMPLE_VIDEO_EXTENSIONS.has(ext) && SAMPLE_TOKEN_RE.test(stem);

      if (isSampleVideo) {
        try {
          await fs.promises.rm(full, { force: true });
          removedFiles += 1;
        } catch {
        }
      }
    }
  }

  sampleDirs.sort((a, b) => b.length - a.length);
  for (const dir of sampleDirs) {
    if (options.shouldAbort?.()) {
      return { files: removedFiles, dirs: removedDirs };
    }
    try {
      const stat = await fs.promises.lstat(dir);
      if (stat.isSymbolicLink()) {
        await fs.promises.rm(dir, { force: true });
        removedDirs += 1;
        continue;
      }
      const filesInDir = await countFilesRecursive(dir);
      await fs.promises.rm(dir, { recursive: true, force: true });
      removedFiles += filesInDir;
      removedDirs += 1;
    } catch {
    }
  }

  return { files: removedFiles, dirs: removedDirs };
}

export async function removeSampleArtifactsFromScope(
  outputFiles: readonly string[],
  options: { shouldAbort?: () => boolean; rootDir?: string } = {}
): Promise<{ files: number; dirs: number }> {
  let removedFiles = 0;
  const candidateParents = new Set<string>();
  for (const outputFile of outputFiles) {
    if (options.shouldAbort?.()) {
      return { files: removedFiles, dirs: 0 };
    }
    const fileName = path.basename(outputFile);
    const stem = path.parse(fileName).name.toLowerCase();
    const ext = path.extname(fileName).toLowerCase();
    const parentDir = path.dirname(outputFile);
    const inSampleDir = SAMPLE_DIR_NAMES.has(path.basename(parentDir).toLowerCase());
    if (!inSampleDir && !(SAMPLE_VIDEO_EXTENSIONS.has(ext) && SAMPLE_TOKEN_RE.test(stem))) {
      continue;
    }
    try {
      const stat = await fs.promises.lstat(outputFile);
      if (!stat.isFile() || stat.isSymbolicLink()) {
        continue;
      }
      await fs.promises.rm(outputFile, { force: true });
      removedFiles += 1;
      if (inSampleDir) {
        candidateParents.add(parentDir);
      }
    } catch {
    }
  }
  let removedDirs = 0;
  for (const parentDir of candidateParents) {
    if (options.shouldAbort?.()) {
      return { files: removedFiles, dirs: removedDirs };
    }
    try {
      const entries = await fs.promises.readdir(parentDir);
      if (entries.length === 0) {
        await fs.promises.rmdir(parentDir);
        removedDirs += 1;
      }
    } catch {
    }
  }
  if (options.rootDir) {
    removedDirs += await removeEmptyParentChains(options.rootDir, candidateParents);
  }
  return { files: removedFiles, dirs: removedDirs };
}
