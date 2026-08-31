import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { captureOnlineProxyList, getManagedOnlineProxyListPath, MAX_ONLINE_PROXY_LIST_BYTES, writeImportedOnlineProxyList } from "../src/main/online-proxy-list";

const tempDirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-online-proxy-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe("online proxy list", () => {
  it("captures and restores the exact proxy-list content into the managed runtime file", () => {
    const dir = tempDir();
    const source = path.join(dir, "premium.txt");
    const content = "user:secret@192.0.2.10:8080\r\nhttp://198.51.100.2:3128\r\n";
    fs.writeFileSync(source, content, "utf8");

    const captured = captureOnlineProxyList({ proxyDownloadEnabled: true, proxyListPath: source });
    const target = writeImportedOnlineProxyList(dir, captured as string);

    expect(target).toBe(getManagedOnlineProxyListPath(dir));
    expect(fs.readFileSync(target, "utf8")).toBe(content);
  });

  it("replaces a previously imported managed list", () => {
    const dir = tempDir();
    const first = writeImportedOnlineProxyList(dir, "192.0.2.1:8080\n");
    const second = writeImportedOnlineProxyList(dir, "198.51.100.1:3128\n");

    expect(second).toBe(first);
    expect(fs.readFileSync(second, "utf8")).toBe("198.51.100.1:3128\n");
  });

  it("rejects missing, unreadable, empty, invalid and oversized configured lists", () => {
    const dir = tempDir();
    const empty = path.join(dir, "empty.txt");
    const invalid = path.join(dir, "invalid.txt");
    const oversized = path.join(dir, "oversized.txt");
    fs.writeFileSync(empty, "", "utf8");
    fs.writeFileSync(invalid, "not a proxy\n", "utf8");
    fs.writeFileSync(oversized, Buffer.alloc(MAX_ONLINE_PROXY_LIST_BYTES + 1, 120));

    expect(() => captureOnlineProxyList({ proxyDownloadEnabled: true, proxyListPath: "" })).toThrow(/keine Proxy-Liste/i);
    expect(() => captureOnlineProxyList({ proxyDownloadEnabled: true, proxyListPath: path.join(dir, "missing.txt") })).toThrow(/nicht gelesen/i);
    expect(() => captureOnlineProxyList({ proxyDownloadEnabled: true, proxyListPath: empty })).toThrow(/leer/i);
    expect(() => captureOnlineProxyList({ proxyDownloadEnabled: true, proxyListPath: invalid })).toThrow(/keine gültigen/i);
    expect(() => captureOnlineProxyList({ proxyDownloadEnabled: true, proxyListPath: oversized })).toThrow(/zu groß/i);
  });

  it("omits an unconfigured list while Proxy-only is disabled", () => {
    expect(captureOnlineProxyList({ proxyDownloadEnabled: false, proxyListPath: "" })).toBeUndefined();
  });
});
