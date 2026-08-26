import { performance } from "node:perf_hooks";
import { describe, expect, it, vi } from "vitest";
import * as historyModelModule from "../src/renderer/views/history/history-model";
import { buildHistoryViewModel, type HistoryViewEntry } from "../src/renderer/views/history/history-model";

function createLargeHistory(count: number, now: number): HistoryViewEntry[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `history-${index}`,
    name: `Package ${index}`,
    totalBytes: 2_097_152,
    downloadedBytes: 1_572_864,
    fileCount: 1,
    provider: "realdebrid",
    completedAt: now - index,
    durationSeconds: 60,
    status: index % 5 === 0 ? "failed" : "completed",
    outputDir: `C:\\Downloads\\Package ${index}`,
    urls: [`https://rapidgator.net/file/${index}`]
  }));
}

describe("history 100k performance contract", () => {
  it("keeps an unchanged second tick and cached page below one frame", () => {
    const getHistoryPage = (historyModelModule as unknown as {
      getHistoryPage?: (
        model: ReturnType<typeof buildHistoryViewModel>,
        requestedPage: number
      ) => { rows: unknown[] };
    }).getHistoryPage;
    expect(getHistoryPage).toBeTypeOf("function");
    if (!getHistoryPage) return;

    const now = new Date(2026, 7, 10, 12, 0, 0, 0).getTime();
    const entries = createLargeHistory(100_000, now);
    const initial = buildHistoryViewModel(entries, "all", "", [], [], false, "", now);
    const initialPage = getHistoryPage(initial, 500);
    expect(initialPage.rows).toHaveLength(100);

    const startedAt = performance.now();
    const next = buildHistoryViewModel(entries, "all", "", [], [], false, "", now + 1_000);
    const nextPage = getHistoryPage(next, 500);
    const elapsedMs = performance.now() - startedAt;

    expect(next.rows).toBe(initial.rows);
    expect(nextPage).toBe(initialPage);
    expect(elapsedMs).toBeLessThan(10);
  });

  it("reuses the warmed 100k search index without rebuilding entry text", () => {
    const getHistoryPage = (historyModelModule as unknown as {
      getHistoryPage?: (
        model: ReturnType<typeof buildHistoryViewModel>,
        requestedPage: number
      ) => { rows: unknown[] };
    }).getHistoryPage;
    expect(getHistoryPage).toBeTypeOf("function");
    if (!getHistoryPage) return;

    const now = new Date(2026, 7, 10, 12, 0, 0, 0).getTime();
    const entries = createLargeHistory(100_000, now);
    buildHistoryViewModel(entries, "all", "", [], [], false, "", now);

    const lowercaseSpy = vi.spyOn(String.prototype, "toLocaleLowerCase");
    const startedAt = performance.now();
    const searched = buildHistoryViewModel(entries, "all", "99999", [], [], false, "", now);
    const page = getHistoryPage(searched, 1);
    const elapsedMs = performance.now() - startedAt;
    const lowercaseCalls = lowercaseSpy.mock.calls.length;
    lowercaseSpy.mockRestore();

    expect(searched.rows).toHaveLength(1);
    expect(page.rows).toHaveLength(1);
    expect(lowercaseCalls).toBeLessThan(10);
    expect(elapsedMs).toBeLessThan(100);
  });
});
