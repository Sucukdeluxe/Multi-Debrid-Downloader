import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

export async function hasRarRecoveryRecord(filePath: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(filePath, "r");
    const header = Buffer.alloc(64);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 14) return false;
    if (header.subarray(0, 7).equals(Buffer.from("526172211a0700", "hex"))) {
      return header[9] === 0x73 && (header.readUInt16LE(10) & 0x40) !== 0;
    }
    if (!header.subarray(0, 8).equals(Buffer.from("526172211a070100", "hex"))) return false;
    let offset = 12;
    const vint = (): number => {
      let result = 0;
      for (let shift = 0; shift < 53 && offset < bytesRead; shift += 7) {
        const byte = header[offset++];
        result += (byte & 0x7f) * 2 ** shift;
        if (!Number.isSafeInteger(result)) throw new Error("Invalid RAR header integer");
        if (!(byte & 0x80)) return result;
      }
      throw new Error("Incomplete RAR header integer");
    };
    const size = vint();
    const end = offset + size;
    if (vint() !== 1) return false;
    const flags = vint();
    if (flags & 1) vint();
    if (flags & 2) vint();
    const archiveFlags = vint();
    return offset <= end && (archiveFlags & 8) !== 0;
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

export async function withRecoveredRar<T>(
  archivePath: string,
  volumes: string[],
  repair: (source: string, destination: string) => Promise<void>,
  verifyAndExtract: (archive: string) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  const recoverable = new Set<string>();
  for (const volume of volumes) if (await hasRarRecoveryRecord(volume)) recoverable.add(volume);
  if (recoverable.size === 0) throw new Error("RAR recovery record unavailable");
  const sizes = await Promise.all(volumes.map(async volume => (await fs.stat(volume)).size));
  const space = await fs.statfs(os.tmpdir());
  if (Number(space.bavail) * Number(space.bsize) < sizes.reduce((total, size) => total + size, 0) * 2) {
    throw new Error("Insufficient temporary disk space for RAR recovery");
  }
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), "mdd-rar-recovery-"));
  try {
    const working = path.join(temporary, "volumes");
    const repaired = path.join(temporary, "repaired");
    await fs.mkdir(working);
    await fs.mkdir(repaired);
    const names = new Set<string>();
    for (const volume of volumes) {
      if (signal?.aborted) throw new Error("aborted:extract");
      const name = path.basename(volume);
      if (names.has(name.toLowerCase())) throw new Error("Ambiguous RAR recovery volumes");
      names.add(name.toLowerCase());
      if (!(await fs.lstat(volume)).isFile()) throw new Error("RAR recovery source is not a regular file");
      const destination = path.join(working, name);
      if (recoverable.has(volume)) {
        await repair(volume, repaired);
        if (signal?.aborted) throw new Error("aborted:extract");
        const fixed = path.join(repaired, `fixed.${name}`);
        if (!(await fs.lstat(fixed)).isFile()) throw new Error("RAR recovery did not produce a repaired file");
        await fs.rename(fixed, destination);
      } else {
        try { await fs.link(volume, destination); }
        catch (error) {
          if (!["EXDEV", "ENOTSUP", "EPERM", "EACCES"].includes(String((error as NodeJS.ErrnoException).code))) throw error;
          await fs.copyFile(volume, destination, fs.constants.COPYFILE_EXCL);
        }
      }
    }
    if (signal?.aborted) throw new Error("aborted:extract");
    return await verifyAndExtract(path.join(working, path.basename(archivePath)));
  } finally {
    await fs.rm(temporary, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
}
