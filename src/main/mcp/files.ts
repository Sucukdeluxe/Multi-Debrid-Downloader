import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";

export interface FileRoot { id: string; path: string; logsOnly?: boolean; }
const privateFile = /(?:^|[\\/])(?:mcp(?:[.\\/\-_]|$)|debug_token|settings\.|credentials|cookies|secret|.*\.pem$|.*\.key$|.*\.env$)/i;
function within(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative));
}

export class McpFiles {
  constructor(private roots: () => FileRoot[], private protectedRoots: () => string[] = () => [], private protectedFiles: () => string[] = () => []) {}
  listRoots(): FileRoot[] { return this.roots().filter(root => root.path); }
  async allowedPath(rootId: string, relative: string): Promise<string> { return (await this.resolve(rootId, relative)).target; }
  private async resolve(rootId: string, relative: string): Promise<{ root: FileRoot; target: string; realRoot: string }> {
    const root = this.roots().find(entry => entry.id === rootId && entry.path);
    if (!root || typeof relative !== "string" || relative.includes("\0") || path.isAbsolute(relative) || /^[A-Za-z]:|[:]/.test(relative) || relative.split(/[\\/]/).includes("..") || privateFile.test(relative)) throw new Error("Dateipfad nicht freigegeben.");
    const realRoot = await fs.realpath(root.path);
    const target = path.resolve(realRoot, relative || ".");
    if (!within(realRoot, target)) throw new Error("Dateipfad außerhalb der Freigabe.");
    const parts = path.relative(realRoot, target).split(path.sep).filter(Boolean);
    let current = realRoot;
    for (const part of parts) {
      current = path.join(current, part);
      if ((await fs.lstat(current)).isSymbolicLink()) throw new Error("Verknüpfungen sind nicht freigegeben.");
    }
    const realTarget = await fs.realpath(target);
    if (!within(realRoot, realTarget)) throw new Error("Dateipfad außerhalb der Freigabe.");
    for (const value of this.protectedFiles().filter(Boolean)) {
      const protectedPath = await fs.realpath(value).catch(() => path.resolve(value));
      if (realTarget === protectedPath) throw new Error("Geschützte Anwendungsdatei ist nicht freigegeben.");
    }
    if (!root.logsOnly) for (const value of this.protectedRoots().filter(Boolean)) {
      const protectedPath = await fs.realpath(value).catch(() => path.resolve(value));
      if (within(protectedPath, realTarget)) throw new Error("Geschützter Anwendungsspeicher ist nicht freigegeben.");
    }
    return { root, target, realRoot };
  }
  async list(rootId: string, relative: string, offset: number, limit: number): Promise<unknown> {
    const { root, target } = await this.resolve(rootId, relative);
    const entries = (await fs.readdir(target, { withFileTypes: true })).filter(entry => !entry.isSymbolicLink() && !privateFile.test(entry.name) && (!root.logsOnly || entry.isDirectory() || /\.(?:log|txt)(?:\.old)?$/i.test(entry.name))).sort((a, b) => a.name.localeCompare(b.name));
    return { total: entries.length, offset, nextOffset: offset + limit < entries.length ? offset + limit : null, entries: entries.slice(offset, offset + limit).map(entry => ({ name: entry.name, directory: entry.isDirectory() })) };
  }
  async openBinary(rootId: string, relative: string, rawTransfer = false) {
    const resolved = await this.resolve(rootId, relative);
    if (rawTransfer && resolved.root.logsOnly) throw new Error("Logs nur über bereinigte Diagnosewerkzeuge auslesen.");
    if (resolved.root.logsOnly && !/\.(?:log|txt)(?:\.old)?$/i.test(relative)) throw new Error("Nur Logdateien sind freigegeben.");
    const handle = await fs.open(resolved.target, "r");
    try {
      const before = await fs.lstat(resolved.target);
      const actual = await handle.stat();
      if (!actual.isFile() || actual.nlink > 1 || before.isSymbolicLink() || actual.dev !== before.dev || actual.ino !== before.ino || !within(resolved.realRoot, await fs.realpath(resolved.target))) throw new Error("Dateipfad wurde verändert oder verweist auf eine mehrfach verknüpfte Datei.");
      const validate = async () => {
        const current = await this.resolve(rootId, relative);
        const named = await fs.lstat(current.target);
        const opened = await handle.stat();
        if (current.target !== resolved.target || current.realRoot !== resolved.realRoot || named.isSymbolicLink() || !named.isFile() || opened.nlink > 1 || named.dev !== actual.dev || named.ino !== actual.ino || opened.dev !== actual.dev || opened.ino !== actual.ino || opened.size !== actual.size || opened.mtimeMs !== actual.mtimeMs || opened.ctimeMs !== actual.ctimeMs || named.size !== actual.size || named.mtimeMs !== actual.mtimeMs || named.ctimeMs !== actual.ctimeMs) throw new Error("Datei oder Freigabe während des Zugriffs verändert.");
      };
      return { handle, stat: actual, fileName: path.basename(resolved.target), validate };
    } catch (error) { await handle.close(); throw error; }
  }
  async read(root: string, relative: string, offset: number, length: number): Promise<unknown> {
    const { handle, stat, validate } = await this.openBinary(root, relative);
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, offset);
      await validate();
      const content = buffer.subarray(0, bytesRead);
      if (content.includes(0)) throw new Error("Binärdatei: Inhaltsanzeige nicht freigegeben.");
      return { size: stat.size, offset, bytesRead, nextOffset: offset + bytesRead < stat.size ? offset + bytesRead : null, text: content.toString("utf8") };
    } finally { await handle.close(); }
  }
  async hash(root: string, relative: string, signal: AbortSignal, onProgress?: (bytes: number, total: number) => void): Promise<unknown> {
    const { handle, stat, validate } = await this.openBinary(root, relative);
    try {
      const hash = crypto.createHash("sha256");
      const buffer = Buffer.alloc(1024 * 1024);
      let offset = 0;
      while (offset < stat.size) {
        signal.throwIfAborted();
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, offset);
        if (!bytesRead) throw new Error("Datei während der Prüfung verändert.");
        hash.update(buffer.subarray(0, bytesRead));
        offset += bytesRead;
        onProgress?.(offset, stat.size);
      }
      const after = await handle.stat();
      if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs) throw new Error("Datei während der Prüfung verändert.");
      await validate();
      return { size: stat.size, sha256: hash.digest("hex"), modifiedAt: stat.mtimeMs };
    } finally { await handle.close(); }
  }
}
