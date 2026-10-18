import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createDecipheriv, pbkdf2 } from "node:crypto";
import { promisify } from "node:util";
import { crc32Buffer } from "./integrity";

const deriveKey = promisify(pbkdf2);

function rar5Header(bytes: Buffer) {
  let offset = 4;
  const vint = (): number => {
    let result = 0;
    for (let shift = 0; shift < 53 && offset < bytes.length; shift += 7) {
      const byte = bytes[offset++];
      result += (byte & 0x7f) * 2 ** shift;
      if (!Number.isSafeInteger(result)) throw new Error("Invalid RAR header integer");
      if (!(byte & 0x80)) return result;
    }
    throw new Error("Incomplete RAR header integer");
  };
  const size = vint();
  const end = offset + size;
  if (end > bytes.length) throw new Error("Incomplete RAR header");
  const type = vint();
  const flags = vint();
  if (flags & 1) vint();
  if (flags & 2) vint();
  return { type, end, vint, position: () => offset,
    valid: () => offset <= end && bytes.readUInt32LE(0) === (crc32Buffer(bytes.subarray(4, end)) >>> 0) };
}

export async function hasRarRecoveryRecord(filePath: string, passwords: string[] = [], signal?: AbortSignal): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(filePath, "r");
    const header = Buffer.alloc(65536);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead < 14) return false;
    if (header.subarray(0, 7).equals(Buffer.from("526172211a0700", "hex"))) {
      return header[9] === 0x73 && (header.readUInt16LE(10) & 0x40) !== 0;
    }
    if (!header.subarray(0, 8).equals(Buffer.from("526172211a070100", "hex"))) return false;
    const bytes = header.subarray(8, bytesRead);
    const first = rar5Header(bytes);
    if (first.type === 1) return (first.vint() & 8) !== 0 && first.position() <= first.end;
    if (first.type !== 4 || !first.valid() || first.vint() !== 0) return false;
    first.vint();
    const position = first.position();
    const count = bytes[position];
    if (count > 20 || position + 17 > first.end || first.end + 32 > bytes.length) return false;
    const salt = bytes.subarray(position + 1, position + 17);
    const iv = bytes.subarray(first.end, first.end + 16);
    const start = first.end + 16;
    const encrypted = bytes.subarray(start, start + Math.floor((bytes.length - start) / 16) * 16);
    for (const password of new Set(passwords)) {
      if (signal?.aborted) throw new Error("aborted:extract");
      const key = await deriveKey(password, salt, 2 ** count, 32, "sha256");
      try {
        if (signal?.aborted) throw new Error("aborted:extract");
        const cipher = createDecipheriv("aes-256-cbc", key, iv);
        cipher.setAutoPadding(false);
        const decrypted = Buffer.concat([cipher.update(encrypted), cipher.final()]);
        try {
          const main = rar5Header(decrypted);
          if (main.type === 1 && main.valid()) return (main.vint() & 8) !== 0 && main.position() <= main.end;
        } catch {}
      } finally {
        key.fill(0);
      }
    }
    return false;
  } catch {
    if (signal?.aborted) throw new Error("aborted:extract");
    return false;
  } finally {
    await handle?.close();
  }
}

export async function repairRarWithPasswords(
  source: string,
  destination: string,
  passwords: string[],
  repair: (source: string, destination: string, password: string) => Promise<boolean>,
  signal?: AbortSignal,
  allowUnchanged = false
): Promise<void> {
  for (const password of new Set(passwords.length ? passwords : [""])) {
    if (signal?.aborted) throw new Error("aborted:extract");
    const attempt = await fs.mkdtemp(path.join(destination, "attempt-"));
    try {
      const ok = await repair(source, attempt, password);
      if (signal?.aborted) throw new Error("aborted:extract");
      const name = `fixed.${path.basename(source)}`;
      const fixed = path.join(attempt, name);
      if (ok && (await fs.lstat(fixed).catch(() => undefined))?.isFile()) {
        await fs.rename(fixed, path.join(destination, name));
        return;
      }
      if (ok && allowUnchanged && (await fs.readdir(attempt)).length === 0 && (await fs.lstat(source)).isFile()) {
        await fs.copyFile(source, path.join(destination, name), fs.constants.COPYFILE_EXCL);
        return;
      }
    } finally {
      await fs.rm(attempt, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    }
  }
  throw new Error("RAR-Wiederherstellung mit den vorhandenen Passwort-Kandidaten fehlgeschlagen");
}

export async function withRecoveredRar<T>(
  archivePath: string,
  volumes: string[],
  repair: (source: string, destination: string) => Promise<void>,
  verifyAndExtract: (archive: string) => Promise<T>,
  signal?: AbortSignal,
  passwords: string[] = []
): Promise<T> {
  const recoverable = new Set<string>();
  for (const volume of volumes) if (await hasRarRecoveryRecord(volume, passwords, signal)) recoverable.add(volume);
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
