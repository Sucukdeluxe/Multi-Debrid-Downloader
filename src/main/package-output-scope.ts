import fs from "node:fs";
import path from "node:path";

export type ExtractOutputState = "complete" | "partial";
export type ExtractOutputDisposition = "written" | "overwritten" | "renamed" | "skipped";

export interface ExtractOutputEvent {
  version: 1;
  archivePath: string;
  entryPath: string;
  outputPath: string;
  state: ExtractOutputState;
  disposition: ExtractOutputDisposition;
}

export class PackageOutputScope {
  private readonly authorizedRoots: string[];

  private readonly outputRecords = new Map<string, ExtractOutputEvent>();

  public constructor(authorizedRoots: readonly string[], records: readonly ExtractOutputEvent[] = []) {
    this.authorizedRoots = [...new Map(
      authorizedRoots
        .map((root) => path.resolve(String(root || "").trim()))
        .filter(Boolean)
        .map((root) => [this.pathKey(root), root])
    ).values()];
    if (this.authorizedRoots.length === 0) {
      throw new Error("PackageOutputScope benötigt mindestens einen autorisierten Root");
    }
    this.addMany(records);
  }

  private pathKey(value: string): string {
    return path.resolve(value).replace(/[\\/]+$/, "").toLocaleLowerCase("en-US");
  }

  private validateEntryPath(entryPath: string): string {
    const normalized = String(entryPath || "").trim().replace(/\\/g, "/");
    const segments = normalized.split("/");
    if (!normalized
      || normalized.startsWith("/")
      || /^[a-zA-Z]:/.test(normalized)
      || path.posix.isAbsolute(normalized)
      || segments.some((segment) => segment === ".." || segment === "")) {
      throw new Error(`Ungültiger Archive-Entry-Ausgabepfad: ${entryPath}`);
    }
    return segments.filter((segment) => segment !== ".").join("/");
  }

  private findAuthorizedRoot(outputPath: string): string {
    const resolvedOutput = path.resolve(outputPath);
    const outputKey = this.pathKey(resolvedOutput);
    const root = this.authorizedRoots.find((candidate) => {
      const rootKey = this.pathKey(candidate);
      return outputKey === rootKey || outputKey.startsWith(`${rootKey}${path.sep.toLocaleLowerCase("en-US")}`);
    });
    if (!root || this.pathKey(root) === outputKey) {
      throw new Error(`Ausgabepfad liegt außerhalb eines autorisierten Roots: ${outputPath}`);
    }
    return root;
  }

  private rejectLinkedPath(outputPath: string, authorizedRoot: string): void {
    let current = path.resolve(outputPath);
    const rootKey = this.pathKey(authorizedRoot);
    while (true) {
      try {
        const stat = fs.lstatSync(current);
        if (stat.isSymbolicLink()) {
          throw new Error(`Symbolischer Link oder Reparse Point im Ausgabepfad: ${outputPath}`);
        }
      } catch (error) {
        const code = String((error as NodeJS.ErrnoException)?.code || "");
        if (code !== "ENOENT") {
          throw error;
        }
      }
      if (this.pathKey(current) === rootKey) {
        break;
      }
      const parent = path.dirname(current);
      if (parent === current) {
        throw new Error(`Ausgabepfad liegt außerhalb eines autorisierten Roots: ${outputPath}`);
      }
      current = parent;
    }
  }

  private normalizeEvent(event: ExtractOutputEvent): ExtractOutputEvent {
    if (Number(event.version) !== 1) {
      throw new Error(`Nicht unterstützte Extract-Output-Version: ${String(event.version)}`);
    }
    if (!path.isAbsolute(String(event.archivePath || ""))) {
      throw new Error(`Archivpfad muss absolut sein: ${event.archivePath}`);
    }
    if (event.state !== "complete" && event.state !== "partial") {
      throw new Error(`Ungültiger Extract-Output-Status: ${String(event.state)}`);
    }
    if (!(["written", "overwritten", "renamed", "skipped"] as const).includes(event.disposition)) {
      throw new Error(`Ungültige Extract-Output-Disposition: ${String(event.disposition)}`);
    }
    const entryPath = this.validateEntryPath(event.entryPath);
    if (!path.isAbsolute(String(event.outputPath || ""))) {
      throw new Error(`Finaler Ausgabepfad muss absolut sein: ${event.outputPath}`);
    }
    const outputPath = path.resolve(event.outputPath);
    const authorizedRoot = this.findAuthorizedRoot(outputPath);
    this.rejectLinkedPath(outputPath, authorizedRoot);
    if (event.disposition !== "skipped") {
      let stat: fs.Stats;
      try {
        stat = fs.lstatSync(outputPath);
      } catch {
        throw new Error(`Gemeldete Extract-Ausgabe existiert nicht: ${outputPath}`);
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw new Error(`Gemeldete Extract-Ausgabe ist keine reguläre Datei: ${outputPath}`);
      }
    }
    return {
      version: 1,
      archivePath: path.resolve(event.archivePath),
      entryPath,
      outputPath,
      state: event.state,
      disposition: event.disposition
    };
  }

  public add(event: ExtractOutputEvent): boolean {
    const normalized = this.normalizeEvent(event);
    if (normalized.disposition === "skipped") {
      return false;
    }
    const key = this.pathKey(normalized.outputPath);
    const current = this.outputRecords.get(key);
    if (current) {
      if (current.state === "partial" && normalized.state === "complete") {
        this.outputRecords.set(key, { ...normalized, outputPath: current.outputPath });
      }
      return false;
    }
    this.outputRecords.set(key, normalized);
    return true;
  }

  public addMany(events: readonly ExtractOutputEvent[]): number {
    let added = 0;
    for (const event of events) {
      if (this.add(event)) {
        added += 1;
      }
    }
    return added;
  }

  public records(): ExtractOutputEvent[] {
    return [...this.outputRecords.values()];
  }

  public completeFiles(): string[] {
    return this.records().filter((record) => record.state === "complete").map((record) => record.outputPath);
  }

  public partialFiles(): string[] {
    return this.records().filter((record) => record.state === "partial").map((record) => record.outputPath);
  }

  public files(): string[] {
    return this.records().map((record) => record.outputPath);
  }

  public archiveFiles(): string[] {
    return this.completeFiles().filter((filePath) => /\.(?:7z|rar|zip|tar|gz|bz2|xz|tgz|tbz2|txz|001)$/i.test(filePath));
  }

  public replacePath(sourcePath: string, targetPath: string, state?: ExtractOutputState): boolean {
    const sourceKey = this.pathKey(sourcePath);
    const current = this.outputRecords.get(sourceKey);
    if (!current) {
      return false;
    }
    const next = this.normalizeEvent({
      ...current,
      outputPath: targetPath,
      entryPath: path.basename(targetPath),
      state: state || current.state,
      disposition: targetPath === current.outputPath ? current.disposition : "renamed"
    });
    this.outputRecords.delete(sourceKey);
    this.outputRecords.set(this.pathKey(next.outputPath), next);
    return true;
  }

  public removePath(outputPath: string): boolean {
    return this.outputRecords.delete(this.pathKey(outputPath));
  }

  public has(outputPath: string): boolean {
    return this.outputRecords.has(this.pathKey(outputPath));
  }

  public pruneMissing(): number {
    let removed = 0;
    for (const record of this.records()) {
      try {
        const stat = fs.lstatSync(record.outputPath);
        if (stat.isFile() && !stat.isSymbolicLink()) {
          continue;
        }
      } catch {
      }
      if (this.removePath(record.outputPath)) {
        removed += 1;
      }
    }
    return removed;
  }
}
