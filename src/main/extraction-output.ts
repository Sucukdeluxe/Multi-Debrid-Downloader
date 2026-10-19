import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { ConflictMode } from "../shared/types";
import { filesHaveEqualContent } from "./integrity";

const publicationQueues = new Map<string, Promise<unknown>>();
const provenanceQueues = new Map<string, Promise<unknown>>();
const provenanceFileName = ".rd_verified_extraction.json";
type OutputIdentity = { size: number; mtimeMs: number; ctimeMs: number; ino: number };
type OutputRegistry = Record<string, OutputIdentity>;

export function isExtractionStagingDirectoryName(name: string): boolean {
  return /^\.mdd-extract-[a-f0-9]{12}-[a-z0-9]+$/i.test(name);
}

function normalizedPath(value: string): string {
  return process.platform === "win32" ? value.toLowerCase() : value;
}

function outputKey(root: string, filePath: string): string {
  const relative = path.relative(path.resolve(root), path.resolve(filePath));
  if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new Error("Entpackausgabe liegt außerhalb des Zielordners");
  }
  return normalizedPath(relative);
}

async function outputIdentity(filePath: string): Promise<OutputIdentity> {
  const stat = await fs.lstat(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Ungültige Entpackausgabe");
  return { size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, ino: stat.ino };
}

async function readRegistry(root: string): Promise<OutputRegistry> {
  try {
    const value = JSON.parse(await fs.readFile(path.join(root, provenanceFileName), "utf8"));
    if (value?.version === 1 && value.files && typeof value.files === "object" && !Array.isArray(value.files)) {
      return Object.assign(Object.create(null), value.files);
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return Object.create(null);
}

async function updateRegistry(root: string, update: (files: OutputRegistry) => Promise<void>): Promise<void> {
  const resolvedRoot = await fs.realpath(root);
  const key = normalizedPath(resolvedRoot);
  const previous = provenanceQueues.get(key) ?? Promise.resolve();
  const operation = previous.catch(() => undefined).then(async () => {
    const files = await readRegistry(resolvedRoot);
    await update(files);
    const target = path.join(resolvedRoot, provenanceFileName);
    if (Object.keys(files).length === 0) {
      await fs.rm(target, { force: true });
      return;
    }
    const temporary = `${target}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporary, JSON.stringify({ version: 1, files }), { flag: "wx" });
      await fs.rename(temporary, target);
    } finally {
      await fs.rm(temporary, { force: true });
    }
  });
  provenanceQueues.set(key, operation);
  try {
    await operation;
  } finally {
    if (provenanceQueues.get(key) === operation) provenanceQueues.delete(key);
  }
}

export async function isVerifiedExtractionOutput(root: string, filePath: string): Promise<boolean> {
  try {
    const expected = (await readRegistry(root))[outputKey(root, filePath)];
    if (!expected) return false;
    const actual = await outputIdentity(filePath);
    return actual.size === expected.size && actual.mtimeMs === expected.mtimeMs
      && actual.ctimeMs === expected.ctimeMs && actual.ino === expected.ino;
  } catch {
    return false;
  }
}

export async function recordVerifiedExtractionOutput(root: string, filePath: string): Promise<void> {
  const key = outputKey(root, filePath);
  const identity = await outputIdentity(filePath);
  await updateRegistry(root, async files => { files[key] = identity; });
}

export async function moveVerifiedExtractionOutput(root: string, oldPath: string, newPath: string): Promise<void> {
  const oldKey = outputKey(root, oldPath);
  const newKey = outputKey(root, newPath);
  await updateRegistry(root, async files => {
    if (!files[oldKey]) return;
    const identity = await outputIdentity(newPath);
    delete files[oldKey];
    files[newKey] = identity;
  });
}

export async function forgetVerifiedExtractionOutput(root: string, filePath: string): Promise<void> {
  const key = outputKey(root, filePath);
  await updateRegistry(root, async files => { delete files[key]; });
}

function checkAbort(signal?: AbortSignal): void {
  if (signal?.aborted) throw new Error("aborted:extract");
}

async function statIfExists(filePath: string) {
  try {
    return await fs.lstat(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

async function listStagedFiles(root: string, relativeDir = ""): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await fs.readdir(path.join(root, relativeDir), { withFileTypes: true })) {
    const relativePath = path.join(relativeDir, entry.name);
    if (entry.name.toLowerCase().startsWith(provenanceFileName) || isExtractionStagingDirectoryName(entry.name)) {
      throw new Error(`Reservierter Entpackpfad: ${relativePath}`);
    }
    if (entry.isSymbolicLink()) throw new Error(`Unsicherer Entpackpfad: ${relativePath}`);
    if (entry.isDirectory()) {
      result.push(...await listStagedFiles(root, relativePath));
    } else if (entry.isFile()) {
      result.push(relativePath);
    } else {
      throw new Error(`Nicht unterstützte Entpackausgabe: ${relativePath}`);
    }
  }
  return result;
}

async function prepareParent(root: string, relativePath: string): Promise<void> {
  let parent = root;
  for (const part of path.dirname(relativePath).split(path.sep)) {
    if (part === ".") continue;
    parent = path.join(parent, part);
    const stat = await statIfExists(parent);
    if (stat) {
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error(`Unsicherer Entpack-Zielordner: ${parent}`);
      }
    } else {
      await fs.mkdir(parent);
    }
  }
}

async function publishFiles(
  stagingDir: string,
  targetDir: string,
  files: string[],
  conflictMode: ConflictMode,
  signal?: AbortSignal
): Promise<void> {
  checkAbort(signal);
  await fs.mkdir(targetDir, { recursive: true });
  const targetRoot = await fs.realpath(targetDir);
  for (const relativePath of files) {
    checkAbort(signal);
    await prepareParent(targetRoot, relativePath);
    const sourcePath = path.join(stagingDir, relativePath);
    let destinationPath = path.join(targetRoot, relativePath);
    const existing = await statIfExists(destinationPath);
    if (existing) {
      if (!existing.isFile() || existing.isSymbolicLink()) {
        throw new Error(`Unsicheres Entpackziel: ${destinationPath}`);
      }
      if (conflictMode === "skip" || conflictMode === "ask") {
        if (await filesHaveEqualContent(sourcePath, destinationPath, () => signal?.aborted === true)) {
          await recordVerifiedExtractionOutput(targetRoot, destinationPath);
        } else {
          checkAbort(signal);
          throw new Error(`Vorhandene Entpackausgabe weicht vom geprüften Archiv ab: ${relativePath}. Konfliktmodus „Überspringen“ verhindert das Ersetzen.`);
        }
        continue;
      }
      if (conflictMode === "rename") {
        const parsed = path.parse(destinationPath);
        let index = 1;
        do {
          if (index > 10_000) throw new Error(`Entpack-Rename-Limit erreicht: ${relativePath}`);
          destinationPath = path.join(parsed.dir, `${parsed.name} (${index++})${parsed.ext}`);
        } while (await statIfExists(destinationPath));
      }
    }
    checkAbort(signal);
    await fs.rename(sourcePath, destinationPath);
    await recordVerifiedExtractionOutput(targetRoot, destinationPath);
  }
}

export async function withStagedExtraction(
  targetDir: string,
  conflictMode: ConflictMode,
  extract: (stagingDir: string, reset: () => Promise<void>) => Promise<void>,
  signal?: AbortSignal,
  publishOutput?: (commit: () => Promise<void>) => Promise<void>
): Promise<number> {
  checkAbort(signal);
  await fs.mkdir(path.resolve(targetDir), { recursive: true });
  const resolvedTarget = await fs.realpath(targetDir);
  const parent = path.dirname(resolvedTarget);
  await fs.mkdir(parent, { recursive: true });
  const targetKey = normalizedPath(resolvedTarget);
  const identity = createHash("sha256").update(targetKey).digest("hex").slice(0, 12);
  const stagingDir = await fs.mkdtemp(path.join(parent, `.mdd-extract-${identity}-`));
  const validateStagingPath = (): void => {
    if (path.dirname(stagingDir) !== parent || !path.basename(stagingDir).startsWith(`.mdd-extract-${identity}-`)) {
      throw new Error("Ungültiger temporärer Entpackpfad");
    }
  };
  const reset = async (): Promise<void> => {
    checkAbort(signal);
    validateStagingPath();
    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.mkdir(stagingDir);
  };
  try {
    await extract(stagingDir, reset);
    checkAbort(signal);
    const files = await listStagedFiles(stagingDir);
    if (files.length === 0) throw new Error("Keine entpackten Dateien erkannt");
    const previous = publicationQueues.get(targetKey) ?? Promise.resolve();
    const publication = previous.catch(() => undefined).then(() => {
      const commit = () => publishFiles(stagingDir, resolvedTarget, files, conflictMode, signal);
      return publishOutput ? publishOutput(commit) : commit();
    });
    publicationQueues.set(targetKey, publication);
    try {
      await publication;
    } finally {
      if (publicationQueues.get(targetKey) === publication) publicationQueues.delete(targetKey);
    }
    return files.length;
  } finally {
    validateStagingPath();
    await fs.rm(stagingDir, { recursive: true, force: true });
  }
}
