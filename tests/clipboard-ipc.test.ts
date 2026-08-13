import { beforeEach, describe, expect, it, vi } from "vitest";
import { writeClipboardTextFromIpc } from "../src/main/clipboard-ipc";
import type { TrustedIpcOptions } from "../src/main/ipc-security";

const electronMocks = vi.hoisted(() => ({
  writeText: vi.fn()
}));
const loggerMocks = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn()
}));

vi.mock("electron", () => ({
  clipboard: {
    writeText: electronMocks.writeText
  }
}));

vi.mock("../src/main/logger", () => ({
  logger: loggerMocks
}));

const trustedOptions: TrustedIpcOptions = {
  isPackaged: false,
  devServerUrl: "http://localhost:5180",
  appPath: "C:\\Program Files\\MDD"
};

function eventFor(url: string) {
  return {
    senderFrame: { url },
    sender: {
      getURL: () => url
    }
  };
}

beforeEach(() => {
  electronMocks.writeText.mockReset();
  loggerMocks.info.mockReset();
  loggerMocks.warn.mockReset();
});

describe("clipboard IPC", () => {
  it("writes trusted renderer text through Electron clipboard", () => {
    const result = writeClipboardTextFromIpc(
      eventFor("http://localhost:5180/downloads"),
      "https://rapidgator.net/file/example",
      trustedOptions
    );

    expect(result).toBe(true);
    expect(electronMocks.writeText).toHaveBeenCalledOnce();
    expect(electronMocks.writeText).toHaveBeenCalledWith("https://rapidgator.net/file/example");
    expect(loggerMocks.info).toHaveBeenCalledWith("Zwischenablage geschrieben: bytes=35");
    expect(JSON.stringify(loggerMocks.info.mock.calls)).not.toContain("rapidgator.net");
  });

  it("rejects untrusted renderer calls before touching the clipboard", () => {
    expect(() => writeClipboardTextFromIpc(
      eventFor("https://attacker.example/downloads"),
      "private value",
      trustedOptions
    )).toThrow("IPC-Absender ist nicht vertrauenswürdig");

    expect(electronMocks.writeText).not.toHaveBeenCalled();
  });

  it("logs native clipboard failures without the copied value", () => {
    electronMocks.writeText.mockImplementationOnce(() => {
      throw new Error("Clipboard busy");
    });

    expect(() => writeClipboardTextFromIpc(
      eventFor("http://localhost:5180/downloads"),
      "private-link-value",
      trustedOptions
    )).toThrow("Clipboard busy");

    expect(loggerMocks.warn).toHaveBeenCalledWith("Zwischenablage-Schreiben fehlgeschlagen: Error: Clipboard busy");
    expect(JSON.stringify(loggerMocks.warn.mock.calls)).not.toContain("private-link-value");
  });

  it("rejects UTF-8 payloads larger than 16 MiB before touching the clipboard", () => {
    const oversizedText = "ä".repeat((8 * 1024 * 1024) + 1);

    expect(Buffer.byteLength(oversizedText, "utf8")).toBe((16 * 1024 * 1024) + 2);
    expect(() => writeClipboardTextFromIpc(
      eventFor("http://localhost:5180/downloads"),
      oversizedText,
      trustedOptions
    )).toThrow("Ungültiger Zwischenablageinhalt");

    expect(electronMocks.writeText).not.toHaveBeenCalled();
  });
});
