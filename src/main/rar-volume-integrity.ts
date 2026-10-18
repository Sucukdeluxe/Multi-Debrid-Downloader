import fs from "node:fs/promises";
import path from "node:path";
import { crc32Buffer } from "./integrity";

export async function checkRarVolumeCrc(file: string, signal?: AbortSignal): Promise<{
  fileName: string; damaged: boolean; expected: string; actual: string;
} | undefined> {
  const cancelled = (): void => { if (signal?.aborted) throw new Error("aborted:extract"); };
  cancelled();
  const handle = await fs.open(file, "r");
  try {
    const before = await handle.stat();
    const read = async (size: number, position: number): Promise<Buffer | undefined> => {
      cancelled();
      const data = Buffer.alloc(size);
      return (await handle.read(data, 0, size, position)).bytesRead === size ? data : undefined;
    };
    const signature = await read(7, 0);
    if (!signature?.equals(Buffer.from("526172211a0700", "hex"))) return;
    let offset = 7;
    for (let blocks = 0; blocks < 100000 && offset + 7 <= before.size; blocks++) {
      const base = await read(7, offset);
      if (!base) return;
      const size = base.readUInt16LE(5), type = base[2], flags = base.readUInt16LE(3);
      if (size < 7 || offset + size > before.size) return;
      const header = await read(size, offset);
      if (!header || (crc32Buffer(header.subarray(2)) & 0xffff) !== header.readUInt16LE(0)) return;
      if (offset === 7 && type !== 0x73) return;
      if (type === 0x73 && flags & 0x80) return;
      if (type === 0x7b) {
        if (!(flags & 2) || size < 11) return;
        const expected = header.readUInt32LE(7);
        let crc = 0;
        const buffer = Buffer.alloc(256 * 1024);
        for (let position = 0; position < offset;) {
          cancelled();
          const { bytesRead } = await handle.read(buffer, 0, Math.min(buffer.length, offset - position), position);
          if (!bytesRead) return;
          crc = crc32Buffer(buffer.subarray(0, bytesRead), crc);
          position += bytesRead;
          await new Promise<void>(resolve => setImmediate(resolve));
        }
        cancelled();
        const after = await handle.stat();
        if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) return;
        const actual = crc >>> 0;
        return { fileName: path.basename(file), damaged: actual !== expected, expected: expected.toString(16).padStart(8, "0"), actual: actual.toString(16).padStart(8, "0") };
      }
      if ((flags & 0x8000) && size < 11) return;
      let dataSize = flags & 0x8000 ? header.readUInt32LE(7) : 0;
      if (type === 0x74 && flags & 0x100) {
        if (size < 40) return;
        dataSize += header.readUInt32LE(32) * 0x100000000;
      }
      const next = offset + size + dataSize;
      if (!Number.isSafeInteger(next) || next > before.size) return;
      offset = next;
    }
  } finally { await handle.close(); }
}
