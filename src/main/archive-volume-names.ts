import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export interface RarVolumeAlias {
  sourceName: string;
  aliasName: string;
}

export function planRarVolumeAliases(firstName: string, names: string[]): RarVolumeAlias[] {
  const first = firstName.match(/^(.*)\.part(0*1)\.rar$/i);
  if (!first || path.basename(firstName) !== firstName) return [];
  const tail = (stem: string): string | undefined => stem.match(/(?:^|[._ -])(s\d{1,3}e\d{1,3}[._ -].*)$/i)?.[1].toLowerCase();
  const firstTail = tail(first[1]);
  if (!firstTail) return [];
  const candidates = names.flatMap(name => {
    if (path.basename(name) !== name) return [];
    const match = name.match(/^(.*)\.part(\d+)\.rar$/i);
    if (!match || tail(match[1]) !== firstTail) return [];
    const stem = match[1].toLowerCase();
    const firstStem = first[1].toLowerCase();
    if (stem !== firstStem && !stem.endsWith(`.${firstStem}`) && !firstStem.endsWith(`.${stem}`)) return [];
    return [{ sourceName: name, index: Number(match[2]) }];
  });
  candidates.sort((a, b) => a.index - b.index);
  if (candidates.length < 2 || candidates[0].sourceName.toLowerCase() !== firstName.toLowerCase()) return [];
  if (candidates.some((candidate, index) => candidate.index !== index + 1)) return [];
  const aliases = candidates.map(candidate => ({
    sourceName: candidate.sourceName,
    aliasName: `${first[1]}.part${String(candidate.index).padStart(first[2].length, "0")}.rar`
  }));
  return aliases.some(alias => alias.sourceName.toLowerCase() !== alias.aliasName.toLowerCase()) ? aliases : [];
}

export async function withRarVolumeAliases<T>(archivePath: string, operation: (archivePath: string) => Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!/\.part0*1\.rar$/i.test(archivePath)) return operation(archivePath);
  const directory = path.dirname(archivePath);
  const entries = await fs.readdir(directory, { withFileTypes: true });
  const aliases = planRarVolumeAliases(path.basename(archivePath), entries.filter(entry => entry.isFile()).map(entry => entry.name));
  if (aliases.length === 0) return operation(archivePath);
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "mdd-rar-volumes-"));
  try {
    for (const alias of aliases) {
      if (signal?.aborted) throw new Error("aborted:extract");
      const source = path.join(directory, alias.sourceName);
      const target = path.join(temporary, alias.aliasName);
      if (!(await fs.lstat(source)).isFile()) throw new Error("Archive volume is not a regular file");
      try {
        await fs.link(source, target);
      } catch (error) {
        if (!["EXDEV", "ENOTSUP", "EPERM", "EACCES"].includes(String((error as NodeJS.ErrnoException).code))) throw error;
        await fs.copyFile(source, target, fs.constants.COPYFILE_EXCL);
      }
    }
    if (signal?.aborted) throw new Error("aborted:extract");
    return await operation(path.join(temporary, aliases[0].aliasName));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
