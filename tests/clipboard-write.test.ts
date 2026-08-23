import { describe, expect, it } from "vitest";
import { CLIPBOARD_WRITE_MAX_BYTES, validateClipboardWriteText } from "../src/main/clipboard-write";

describe("clipboard write validation", () => {
  it("accepts complete large link packages up to one MiB", () => {
    const text = "x".repeat(CLIPBOARD_WRITE_MAX_BYTES);
    expect(validateClipboardWriteText(text)).toBe(text);
  });

  it("rejects empty, non-string and oversized payloads", () => {
    expect(() => validateClipboardWriteText(" \n ")).toThrow(/leer/i);
    expect(() => validateClipboardWriteText(4)).toThrow(/String/i);
    expect(() => validateClipboardWriteText("x".repeat(CLIPBOARD_WRITE_MAX_BYTES + 1))).toThrow(/zu groß/i);
  });
});
