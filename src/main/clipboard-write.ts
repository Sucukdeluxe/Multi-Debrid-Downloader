export const CLIPBOARD_WRITE_MAX_BYTES = 1024 * 1024;

export function validateClipboardWriteText(value: unknown): string {
  if (typeof value !== "string") {
    throw new Error("text muss ein String sein");
  }
  if (!value.trim()) {
    throw new Error("text darf nicht leer sein");
  }
  const bytes = Buffer.byteLength(value, "utf8");
  if (bytes > CLIPBOARD_WRITE_MAX_BYTES) {
    throw new Error(`text ist zu groß (max ${CLIPBOARD_WRITE_MAX_BYTES} Bytes)`);
  }
  return value;
}
