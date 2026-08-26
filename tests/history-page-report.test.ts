import { describe, expect, it } from "vitest";
import { paginateHistoryRows, type HistoryViewEntry } from "../src/renderer/views/history/history-model";
import * as historyViewModule from "../src/renderer/views/history/HistoryView";

function historyEntry(id: string): HistoryViewEntry {
  return {
    id,
    name: id,
    totalBytes: 1,
    downloadedBytes: 1,
    fileCount: 1,
    provider: "realdebrid",
    completedAt: 1,
    durationSeconds: 1,
    status: "completed",
    outputDir: "",
    urls: []
  };
}

describe("history page reporting", () => {
  it("reports the exact current page ids and count for App integration", () => {
    const reportHistoryVisiblePage = (historyViewModule as unknown as {
      reportHistoryVisiblePage?: (
        actions: {
          onVisiblePageChange?: (ids: string[]) => void;
          onVisiblePageCountChange?: (count: number) => void;
        },
        page: ReturnType<typeof paginateHistoryRows>
      ) => void;
    }).reportHistoryVisiblePage;
    expect(reportHistoryVisiblePage).toBeTypeOf("function");
    if (!reportHistoryVisiblePage) return;

    const ids: string[][] = [];
    const counts: number[] = [];
    reportHistoryVisiblePage({
      onVisiblePageChange: (value) => ids.push(value),
      onVisiblePageCountChange: (value) => counts.push(value)
    }, paginateHistoryRows([historyEntry("page-101"), historyEntry("page-102")], 1));

    expect(ids).toEqual([["page-101", "page-102"]]);
    expect(counts).toEqual([2]);
  });
});
