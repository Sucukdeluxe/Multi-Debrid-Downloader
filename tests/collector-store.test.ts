import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CollectorStore } from "../src/main/collector-store";
import type { CollectorPersistenceState } from "../src/shared/collector";

const roots: string[] = [];

function createFilePath(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-collector-store-"));
  roots.push(root);
  return path.join(root, "collector.json");
}

function state(id: string, collapsed = true): CollectorPersistenceState {
  return {
    packages: [{
      id: `package-${id}`,
      name: `Package ${id}`,
      nameSource: "explicit",
      addedAt: 1_700_000_000_000,
      links: [{
        id: `link-${id}`,
        url: `https://example.com/${id}`,
        fileName: `${id}.rar`,
        fileSizeBytes: 1024,
        hoster: "example.com",
        availability: "online",
        status: "ready",
        addedAt: 1_700_000_000_000
      }]
    }],
    collapsedPackageIds: collapsed ? [`package-${id}`] : []
  };
}

afterEach(() => {
  vi.useRealTimers();
  for (const root of roots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("CollectorStore", () => {
  it("starts empty when no persistence file exists", () => {
    const store = new CollectorStore(createFilePath());

    expect(store.getState()).toEqual({ packages: [], collapsedPackageIds: [] });
  });

  it("persists a versioned state and loads an independent clone", () => {
    const filePath = createFilePath();
    const store = new CollectorStore(filePath);
    const expected = state("roundtrip");

    store.update(expected);
    store.flushSync();

    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    expect(payload).toMatchObject({
      version: 1,
      packages: expected.packages,
      collapsedPackageIds: expected.collapsedPackageIds
    });
    expect(payload.updatedAt).toEqual(expect.any(Number));

    const loaded = new CollectorStore(filePath);
    const first = loaded.getState();
    first.packages[0].name = "Changed outside";
    expect(loaded.getState()).toEqual(expected);
  });

  it("recovers a valid backup when the primary file is corrupted", () => {
    const filePath = createFilePath();
    const expected = state("backup");
    const store = new CollectorStore(filePath);
    store.update(expected);
    store.flushSync();
    fs.writeFileSync(filePath, "{broken", "utf8");

    const recovered = new CollectorStore(filePath);

    expect(recovered.getState()).toEqual(expected);
    expect(JSON.parse(fs.readFileSync(filePath, "utf8"))).toMatchObject({
      version: 1,
      packages: expected.packages
    });
  });

  it("prefers a newer valid backup after an interrupted primary replacement", () => {
    vi.useFakeTimers();
    vi.setSystemTime(1_700_000_000_000);
    const filePath = createFilePath();
    const store = new CollectorStore(filePath);
    store.update(state("old"));
    store.flushSync();
    const oldPrimary = fs.readFileSync(filePath, "utf8");
    store.update(state("latest"));
    store.flushSync();
    fs.writeFileSync(filePath, oldPrimary, "utf8");

    expect(new CollectorStore(filePath).getState()).toEqual(state("latest"));
  });

  it("keeps the latest update when a scheduled write and flush overlap", async () => {
    vi.useFakeTimers();
    const filePath = createFilePath();
    const store = new CollectorStore(filePath);
    store.update(state("old"));
    await vi.advanceTimersByTimeAsync(300);

    const latest = state("latest", false);
    store.update(latest);
    store.flushSync();
    await vi.runAllTimersAsync();
    await Promise.resolve();

    expect(store.getState()).toEqual(latest);
    expect(new CollectorStore(filePath).getState()).toEqual(latest);
  });

  it("coalesces pending updates into one delayed persistence", async () => {
    vi.useFakeTimers();
    const filePath = createFilePath();
    const store = new CollectorStore(filePath);

    store.update(state("first"));
    store.update(state("second"));
    expect(fs.existsSync(filePath)).toBe(false);
    await vi.advanceTimersByTimeAsync(299);
    expect(fs.existsSync(filePath)).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    for (let attempt = 0; attempt < 50 && !fs.existsSync(filePath); attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    expect(new CollectorStore(filePath).getState()).toEqual(state("second"));
  });

  it("backs off after a persistent write failure instead of retrying every 300 ms", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const store = new CollectorStore(createFilePath(), async () => {
      attempts += 1;
      throw Object.assign(new Error("locked"), { code: "EACCES" });
    });

    store.update(state("blocked"));
    await vi.advanceTimersByTimeAsync(300);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toBe(2);
  });

  it("ignores invalid and oversized persistence files", () => {
    const invalidPath = createFilePath();
    fs.writeFileSync(invalidPath, JSON.stringify({ version: 1, packages: "wrong", collapsedPackageIds: [], updatedAt: 1 }), "utf8");
    const oversizedPath = createFilePath();
    fs.writeFileSync(oversizedPath, "", "utf8");
    fs.truncateSync(oversizedPath, 64 * 1024 * 1024 + 1);

    expect(new CollectorStore(invalidPath).getState()).toEqual({ packages: [], collapsedPackageIds: [] });
    expect(new CollectorStore(oversizedPath).getState()).toEqual({ packages: [], collapsedPackageIds: [] });
  });

  it("rejects a state that would be larger than the load limit", () => {
    const store = new CollectorStore(createFilePath());
    const longUrl = `https://example.com/${"a".repeat(32_740)}`;
    const longName = "n".repeat(1_024);
    const packages = Array.from({ length: 2_000 }, (_, index) => ({
      ...state(String(index)).packages[0],
      id: `package-${index}`,
      name: longName,
      links: [{
        ...state(String(index)).packages[0].links[0],
        id: `link-${index}`,
        url: longUrl
      }]
    }));

    expect(() => store.update({ packages, collapsedPackageIds: [] })).toThrow("Linksammler-Speicherzustand ist zu groß");
  });
});
