import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DownloadItem, DownloadStatus, UiSnapshot } from "../src/shared/types";
import { readBandwidthChartPalette } from "../src/renderer/App";
import {
  buildStatisticsViewModel,
  type StatisticsMetric,
  type StatisticsRange
} from "../src/renderer/views/statistics/statistics-model";
import {
  StatisticsContent,
  StatisticsSidebar,
  StatisticsView,
  type StatisticsViewActions
} from "../src/renderer/views/statistics/StatisticsView";
import { createVisualFixture } from "./visual/fixtures";

const now = new Date(2026, 7, 10, 12, 0, 0, 0).getTime();

function createSnapshot(): UiSnapshot {
  return structuredClone(createVisualFixture("empty").snapshot);
}

function item(
  id: string,
  status: DownloadStatus,
  overrides: Partial<DownloadItem> = {}
): DownloadItem {
  return {
    id,
    packageId: "statistics-package",
    url: `https://url-host-${id}.example/file`,
    provider: "realdebrid",
    providerLabel: "Real-Debrid",
    status,
    retries: 0,
    speedBps: 0,
    downloadedBytes: 100,
    totalBytes: 100,
    progressPercent: status === "completed" ? 100 : 50,
    fileName: `${id}.bin`,
    targetPath: `C:\\Downloads\\${id}.bin`,
    resumable: true,
    attempts: 1,
    lastError: status === "failed" ? "Fehlgeschlagen" : "",
    fullStatus: status,
    createdAt: now - 1000,
    updatedAt: now,
    ...overrides
  };
}

function setItems(snapshot: UiSnapshot, items: DownloadItem[]): void {
  snapshot.session.items = Object.fromEntries(items.map((entry) => [entry.id, entry]));
}

function visitElements(node: ReactNode, visit: (element: ReactElement) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => visitElements(child, visit));
    return;
  }
  if (!isValidElement(node)) {
    return;
  }
  visit(node);
  visitElements(node.props.children, visit);
}

function findButton(node: ReactNode, label: string): ReactElement {
  let result: ReactElement | null = null;
  visitElements(node, (element) => {
    if (!result && element.type === "button" && element.props.children === label) {
      result = element;
    }
  });
  if (!result) {
    throw new Error(`Button not found: ${label}`);
  }
  return result;
}

function createActions(overrides: Partial<StatisticsViewActions> = {}): StatisticsViewActions {
  return {
    onRangeChange: () => {},
    onResetSession: () => {},
    onResetAll: () => {},
    onResetErrors: () => {},
    ...overrides
  };
}

function expectUnavailable(metric: StatisticsMetric): void {
  expect(metric).toMatchObject({ value: null, available: false });
  expect(metric.sourceLabel.trim()).not.toBe("");
}

describe("statistics model", () => {
  it("uses real snapshot session fields and excludes active or waiting downloads from the success denominator", () => {
    const snapshot = createSnapshot();
    snapshot.stats.totalDownloaded = 600;
    snapshot.stats.totalFilesSession = 3;
    snapshot.session.running = true;
    setItems(snapshot, [
      item("complete-a", "completed"),
      item("complete-b", "completed"),
      item("complete-c", "completed"),
      item("failed", "failed"),
      item("active", "downloading"),
      item("waiting", "queued")
    ]);

    const model = buildStatisticsViewModel(snapshot, "session", now);

    expect(model.metrics.downloadedBytes.value).toBe(600);
    expect(model.metrics.files.value).toBe(3);
    expect(model.metrics.successRate.value).toBe(75);
    expect(model.metrics.errors.value).toBe(1);
  });

  it("reports no success rate when the current queue has no completed or failed result", () => {
    const snapshot = createSnapshot();
    snapshot.session.running = true;
    setItems(snapshot, [item("active", "downloading"), item("waiting", "queued")]);

    const model = buildStatisticsViewModel(snapshot, "session", now);

    expectUnavailable(model.metrics.successRate);
    expect(model.metrics.errors).toMatchObject({ value: 0, available: true });
  });

  it("sorts current-queue providers by bytes and then id without deriving them from URL hostnames", () => {
    const snapshot = createSnapshot();
    snapshot.session.running = true;
    setItems(snapshot, [
      item("real", "completed", {
        url: "https://alldebrid.invalid/wrong-source",
        provider: "realdebrid",
        providerLabel: "Real-Debrid Konto",
        downloadedBytes: 200
      }),
      item("all", "failed", {
        url: "https://realdebrid.invalid/wrong-source",
        provider: "alldebrid",
        providerLabel: "AllDebrid",
        downloadedBytes: 200
      }),
      item("link", "completed", {
        url: "https://realdebrid.invalid/also-wrong",
        provider: "debridlink",
        providerLabel: "Debrid-Link",
        downloadedBytes: 400
      }),
      item("unknown", "completed", {
        url: "https://hoster-only.invalid/not-a-provider",
        provider: null,
        providerLabel: undefined,
        downloadedBytes: 900
      })
    ]);

    const model = buildStatisticsViewModel(snapshot, "session", now);

    expect(model.providers.map((row) => row.id)).toEqual(["debridlink", "alldebrid", "realdebrid"]);
    expect(model.providers.map((row) => row.label)).toEqual(["Debrid-Link", "AllDebrid", "Real-Debrid Konto"]);
    expect(model.providers.map((row) => [row.completed, row.failed])).toEqual([[1, 0], [0, 1], [1, 0]]);
    expect(model.providers.some((row) => row.id.includes("host"))).toBe(false);
  });

  it("uses daily provider usage only for the matching local day", () => {
    const snapshot = createSnapshot();
    snapshot.stats.totalDownloaded = 999_999;
    snapshot.settings.providerDailyUsageDay = "2026-08-10";
    snapshot.settings.providerDailyUsageBytes = { realdebrid: 500, alldebrid: 1_500 };

    const model = buildStatisticsViewModel(snapshot, "today", now);

    expect(model.metrics.downloadedBytes).toMatchObject({ value: 2_000, available: true });
    expect(model.providers.map((row) => [row.id, row.bytes])).toEqual([
      ["alldebrid", 1_500],
      ["realdebrid", 500]
    ]);
    expectUnavailable(model.metrics.files);
    expectUnavailable(model.metrics.successRate);
    expectUnavailable(model.metrics.errors);
    expectUnavailable(model.metrics.averageSpeedBps);
  });

  it("treats a stale daily key as a genuine zero today without stale provider rows", () => {
    const snapshot = createSnapshot();
    snapshot.settings.providerDailyUsageDay = "2026-08-09";
    snapshot.settings.providerDailyUsageBytes = { realdebrid: 900 };

    const model = buildStatisticsViewModel(snapshot, "today", now);

    expect(model.metrics.downloadedBytes).toMatchObject({ value: 0, available: true });
    expect(model.providers).toEqual([]);
  });

  it.each(["week", "month"] satisfies StatisticsRange[])("keeps %s unavailable without inventing historical buckets", (range) => {
    const snapshot = createSnapshot();
    snapshot.stats.totalDownloaded = 5_000;
    snapshot.stats.totalDownloadedAllTime = 50_000;
    snapshot.settings.providerDailyUsageDay = "2026-08-10";
    snapshot.settings.providerDailyUsageBytes = { realdebrid: 4_000 };
    snapshot.settings.providerTotalUsageBytes = { realdebrid: 40_000 };

    const model = buildStatisticsViewModel(snapshot, range, now);

    expect(model.coverage).toBe("unavailable");
    expect(model.message).toBe("Für diesen Zeitraum werden noch keine historischen Daten gespeichert.");
    expect(model.providers).toEqual([]);
    expect(model.providerScope).toBeNull();
    Object.values(model.metrics).forEach(expectUnavailable);
  });

  it("uses all-time counters and provider totals without inventing historical outcomes", () => {
    const snapshot = createSnapshot();
    snapshot.stats.totalDownloadedAllTime = 25_000;
    snapshot.stats.totalFilesAllTime = 42;
    snapshot.settings.providerTotalUsageBytes = { realdebrid: 5_000, debridlink: 20_000 };
    snapshot.summary = {
      total: 10,
      success: 9,
      failed: 1,
      cancelled: 0,
      extracted: 9,
      durationSeconds: 10,
      averageSpeedBps: 2_500
    };

    const model = buildStatisticsViewModel(snapshot, "all", now);

    expect(model.metrics.downloadedBytes.value).toBe(25_000);
    expect(model.metrics.files.value).toBe(42);
    expect(model.providers.map((row) => [row.id, row.bytes])).toEqual([
      ["debridlink", 20_000],
      ["realdebrid", 5_000]
    ]);
    expect(model.providers.every((row) => row.completed === null && row.failed === null)).toBe(true);
    expectUnavailable(model.metrics.successRate);
    expectUnavailable(model.metrics.errors);
    expectUnavailable(model.metrics.averageSpeedBps);
  });

  it("prefers live queue outcomes over an old summary and uses the summary only after the run ends", () => {
    const snapshot = createSnapshot();
    setItems(snapshot, [
      item("complete-a", "completed"),
      item("complete-b", "completed"),
      item("complete-c", "completed"),
      item("failed", "failed")
    ]);
    snapshot.summary = {
      total: 4,
      success: 1,
      failed: 3,
      cancelled: 0,
      extracted: 1,
      durationSeconds: 100,
      averageSpeedBps: 500
    };
    snapshot.session.running = true;

    const active = buildStatisticsViewModel(snapshot, "session", now);
    snapshot.session.running = false;
    const ended = buildStatisticsViewModel(snapshot, "session", now);

    expect(active.metrics.successRate.value).toBe(75);
    expect(active.metrics.errors.value).toBe(1);
    expectUnavailable(active.metrics.averageSpeedBps);
    expect(ended.metrics.successRate.value).toBe(25);
    expect(ended.metrics.errors.value).toBe(3);
    expect(ended.metrics.averageSpeedBps).toMatchObject({ value: 500, available: true });
  });

  it("models empty, idle, active and paused session states separately", () => {
    const empty = createSnapshot();
    const idle = createSnapshot();
    setItems(idle, [item("idle", "completed")]);
    const active = createSnapshot();
    active.session.running = true;
    setItems(active, [item("active", "downloading")]);
    const paused = createSnapshot();
    paused.session.running = true;
    paused.session.paused = true;
    setItems(paused, [item("paused", "paused")]);

    expect(buildStatisticsViewModel(empty, "session", now).sessionState).toBe("empty");
    expect(buildStatisticsViewModel(idle, "session", now).sessionState).toBe("idle");
    expect(buildStatisticsViewModel(active, "session", now).sessionState).toBe("active");
    expect(buildStatisticsViewModel(paused, "session", now).sessionState).toBe("paused");
  });
});

describe("statistics view", () => {
  it("renders each statistics marker exactly once, all ranges and no download toolbar or pagination", () => {
    const snapshot = createSnapshot();
    snapshot.stats.totalDownloaded = 2_048;
    snapshot.stats.totalFilesSession = 1;
    setItems(snapshot, [item("complete", "completed")]);
    const html = renderToStaticMarkup(
      <StatisticsView
        actions={createActions()}
        chart={<div>Bestehender Bandbreitenverlauf</div>}
        model={buildStatisticsViewModel(snapshot, "session", now)}
      />
    );

    for (const marker of ["statistics-sidebar", "statistics-kpis", "statistics-chart"]) {
      expect(html.match(new RegExp(`data-visual-region=\\"${marker}\\"`, "g"))).toHaveLength(1);
    }
    for (const label of ["Sitzung", "Heute", "Sieben Tage", "30 Tage", "Gesamt"]) {
      expect(html).toContain(`>${label}<`);
    }
    expect(html).toContain("Bestehender Bandbreitenverlauf");
    expect(html).not.toContain("downloads-toolbar");
    expect(html.toLocaleLowerCase("de-DE")).not.toContain("pagination");
  });

  it("dispatches range and reset controls only through the supplied callbacks", () => {
    const snapshot = createSnapshot();
    setItems(snapshot, [item("failed", "failed")]);
    const model = buildStatisticsViewModel(snapshot, "session", now);
    const calls: string[] = [];
    const actions = createActions({
      onRangeChange: (range) => calls.push(`range:${range}`),
      onResetSession: () => calls.push("reset:session"),
      onResetAll: () => calls.push("reset:all"),
      onResetErrors: () => calls.push("reset:errors")
    });
    const sidebar = StatisticsSidebar({ actions, model });
    const content = StatisticsContent({ actions, chart: <div />, model });

    findButton(sidebar, "Heute").props.onClick();
    findButton(content, "Sitzung zurücksetzen").props.onClick();
    findButton(content, "Gesamt zurücksetzen").props.onClick();
    findButton(content, "Fehler zurücksetzen").props.onClick();

    expect(calls).toEqual(["range:today", "reset:session", "reset:all", "reset:errors"]);
  });

  it("enables error reset only for a positive genuine error metric", () => {
    const clean = createSnapshot();
    const failed = createSnapshot();
    setItems(failed, [item("failed", "failed")]);

    const cleanContent = StatisticsContent({
      actions: createActions(),
      chart: <div />,
      model: buildStatisticsViewModel(clean, "session", now)
    });
    const failedContent = StatisticsContent({
      actions: createActions(),
      chart: <div />,
      model: buildStatisticsViewModel(failed, "session", now)
    });

    expect(findButton(cleanContent, "Fehler zurücksetzen").props.disabled).toBe(true);
    expect(findButton(failedContent, "Fehler zurücksetzen").props.disabled).toBe(false);
  });

  it("keeps the empty provider state inside the ARIA table as a row and spanning cell", () => {
    const html = renderToStaticMarkup(
      <StatisticsContent
        actions={createActions()}
        chart={<div />}
        model={buildStatisticsViewModel(createSnapshot(), "session", now)}
      />
    );

    expect(html).toContain('class="statistics-provider-empty" role="row"');
    expect(html).toContain('aria-colspan="3" role="cell"');
  });
});

describe("bandwidth chart palette", () => {
  it("requests only the semantic UI color properties and keeps the computed font family", () => {
    const requested: string[] = [];
    const values: Record<string, string> = {
      "--ui-border": " rgb(61, 61, 61) ",
      "--ui-text-muted": " rgb(145, 145, 145) ",
      "--ui-accent": " rgb(56, 134, 255) "
    };

    const palette = readBandwidthChartPalette((property) => {
      requested.push(property);
      return values[property];
    }, "Inter, Segoe UI, sans-serif");

    expect(requested).toEqual(["--ui-border", "--ui-text-muted", "--ui-accent"]);
    expect(palette).toEqual({
      grid: "rgb(61, 61, 61)",
      text: "rgb(145, 145, 145)",
      accent: "rgb(56, 134, 255)",
      fontFamily: "Inter, Segoe UI, sans-serif"
    });
  });
});
