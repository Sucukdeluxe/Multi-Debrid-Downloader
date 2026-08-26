import { readFileSync } from "node:fs";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DownloadItem, DownloadStatus, UiSnapshot } from "../src/shared/types";
import { appendBandwidthSample, getIdleSparklineStroke, readBandwidthChartPalette, readDownloadSpeedSparklinePalette } from "../src/renderer/App";
import {
  buildStatisticsViewModel,
  type StatisticsMetric
} from "../src/renderer/views/statistics/statistics-model";
import {
  StatisticsContent,
  StatisticsSidebar,
  StatisticsSidebarStatus,
  StatisticsView,
  type StatisticsViewActions
} from "../src/renderer/views/statistics/StatisticsView";
import { createVisualFixture } from "./visual/fixtures";
import {
  createStatisticsLedger,
  recordStatisticsActiveInterval,
  recordStatisticsBytes,
  recordStatisticsOutcome
} from "../src/main/statistics-ledger";

const now = new Date(2026, 7, 10, 12, 0, 0, 0).getTime();

describe("bandwidth sampling", () => {
  it("keeps the latest minute and normalizes invalid speeds", () => {
    const history = [
      { time: now - 61000, speed: 1 },
      { time: now - 59000, speed: 2 }
    ];

    expect(appendBandwidthSample(history, Number.NaN, now)).toEqual([
      { time: now - 59000, speed: 2 },
      { time: now, speed: 0 }
    ]);
    expect(history).toHaveLength(2);
  });
});

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

  it("uses persisted daily bytes, results and active time for every statistic shown today", () => {
    const snapshot = createSnapshot();
    let ledger = createStatisticsLedger(now);
    ledger = recordStatisticsBytes(ledger, "realdebrid", 500, now);
    ledger = recordStatisticsOutcome(ledger, "realdebrid", "completed", now);
    ledger = recordStatisticsBytes(ledger, "alldebrid", 1_500, now);
    ledger = recordStatisticsOutcome(ledger, "alldebrid", "failed", now);
    ledger = recordStatisticsActiveInterval(ledger, now - 2_000, now);
    snapshot.stats.statistics = ledger;

    const model = buildStatisticsViewModel(snapshot, "today", now);

    expect(model.metrics.downloadedBytes).toMatchObject({ value: 2_000, available: true });
    expect(model.metrics.files).toMatchObject({ value: 1, available: true });
    expect(model.metrics.successRate).toMatchObject({ value: 50, available: true });
    expect(model.metrics.errors).toMatchObject({ value: 1, available: true });
    expect(model.metrics.averageSpeedBps).toMatchObject({ value: 1_000, available: true });
    expect(model.providers.map((row) => [row.id, row.bytes])).toEqual([
      ["alldebrid", 1_500],
      ["realdebrid", 500]
    ]);
    expect(model.providers.map((row) => [row.completed, row.failed])).toEqual([[0, 1], [1, 0]]);
  });

  it("shows rolling account traffic with unavailable day-scoped metrics", () => {
    const snapshot = createSnapshot();
    snapshot.stats.statistics = {
      version: 2,
      startedAt: now - (2 * 60 * 60 * 1_000),
      days: [],
      minutes: []
    };
    snapshot.stats.rolling24Hours = {
      from: now - (24 * 60 * 60 * 1_000),
      to: now,
      downloadedBytes: 125,
      accounts: [
        { id: "rdw_two", provider: "realdebrid", label: "Secondary", bytes: 75 },
        { id: "rdw_one", provider: "realdebrid", label: "Primary", bytes: 50 }
      ]
    };

    const model = buildStatisticsViewModel(snapshot, "last24", now);

    expect(model.metrics.downloadedBytes).toMatchObject({ value: 125, available: true });
    expectUnavailable(model.metrics.files);
    expectUnavailable(model.metrics.successRate);
    expectUnavailable(model.metrics.averageSpeedBps);
    expectUnavailable(model.metrics.errors);
    expect(model.usageKind).toBe("accounts");
    expect(model.providerScope).toBe("last24");
    expect(model.providers.map((row) => [row.id, row.label, row.bytes])).toEqual([
      ["rdw_two", "Real-Debrid · Secondary", 75],
      ["rdw_one", "Real-Debrid · Primary", 50]
    ]);
    expect(model.providers.map((row) => [row.completed, row.failed])).toEqual([[null, null], [null, null]]);
    expect(model.message).toContain("seit Beginn der Aufzeichnung");
  });

  it("shows a complete rolling description after 24 hours of statistics coverage", () => {
    const snapshot = createSnapshot();
    snapshot.stats.statistics = {
      version: 2,
      startedAt: now - (25 * 60 * 60 * 1_000),
      days: [],
      minutes: []
    };
    snapshot.stats.rolling24Hours = {
      from: now - (24 * 60 * 60 * 1_000),
      to: now,
      downloadedBytes: 0,
      accounts: []
    };

    const model = buildStatisticsViewModel(snapshot, "last24", now);

    expect(model.message).toContain("vergangenen 24 Stunden");
    expect(model.message).not.toContain("seit Beginn der Aufzeichnung");
  });

  it("treats a stale daily key as a genuine zero today without stale provider rows", () => {
    const snapshot = createSnapshot();
    snapshot.settings.providerDailyUsageDay = "2026-08-09";
    snapshot.settings.providerDailyUsageBytes = { realdebrid: 900 };

    const model = buildStatisticsViewModel(snapshot, "today", now);

    expect(model.metrics.downloadedBytes).toMatchObject({ value: 0, available: true });
    expect(model.providers).toEqual([]);
  });

  it("sums every available day in seven-day and 30-day windows without waiting for a full period", () => {
    const snapshot = createSnapshot();
    let ledger = createStatisticsLedger(new Date(2026, 7, 3, 12).getTime());
    ledger = recordStatisticsBytes(ledger, "realdebrid", 300, new Date(2026, 7, 3, 12).getTime());
    ledger = recordStatisticsOutcome(ledger, "realdebrid", "completed", new Date(2026, 7, 3, 12).getTime());
    ledger = recordStatisticsBytes(ledger, "debridlink", 700, new Date(2026, 7, 8, 12).getTime());
    ledger = recordStatisticsOutcome(ledger, "debridlink", "failed", new Date(2026, 7, 8, 12).getTime());
    ledger = recordStatisticsBytes(ledger, "realdebrid", 500, now);
    ledger = recordStatisticsOutcome(ledger, "realdebrid", "completed", now);
    snapshot.stats.statistics = ledger;

    const week = buildStatisticsViewModel(snapshot, "week", now);
    const month = buildStatisticsViewModel(snapshot, "month", now);

    expect(week.metrics.downloadedBytes.value).toBe(1_200);
    expect(week.metrics.files.value).toBe(1);
    expect(week.metrics.errors.value).toBe(1);
    expect(week.message).toContain("2 erfasste Tage");
    expect(month.metrics.downloadedBytes.value).toBe(1_500);
    expect(month.metrics.files.value).toBe(2);
    expect(month.metrics.errors.value).toBe(1);
    expect(month.message).toContain("3 erfasste Tage");
  });

  it("combines existing all-time counters with persisted outcomes, provider results and measured average speed", () => {
    const snapshot = createSnapshot();
    snapshot.stats.totalDownloadedAllTime = 25_000;
    snapshot.stats.totalFilesAllTime = 42;
    snapshot.settings.providerTotalUsageBytes = { realdebrid: 5_000, debridlink: 20_000 };
    let ledger = createStatisticsLedger(now - 10_000);
    ledger = recordStatisticsBytes(ledger, "realdebrid", 2_000, now);
    ledger = recordStatisticsActiveInterval(ledger, now - 2_000, now);
    ledger = recordStatisticsOutcome(ledger, "realdebrid", "completed", now);
    ledger = recordStatisticsOutcome(ledger, "realdebrid", "completed", now);
    ledger = recordStatisticsOutcome(ledger, "debridlink", "failed", now);
    snapshot.stats.statistics = ledger;
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
    expect(model.providers.map((row) => [row.completed, row.failed])).toEqual([[0, 1], [2, 0]]);
    expect(model.metrics.successRate.available).toBe(true);
    expect(model.metrics.successRate.value).toBeCloseTo(200 / 3);
    expect(model.metrics.errors).toMatchObject({ value: 1, available: true });
    expect(model.metrics.averageSpeedBps).toMatchObject({ value: 1_000, available: true });
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
  it("keeps large statistic data volumes precise in gigabytes instead of rounding to terabytes", () => {
    const snapshot = createSnapshot();
    let ledger = createStatisticsLedger(now);
    ledger = recordStatisticsBytes(ledger, "realdebrid", 1_250 * 1024 ** 3, now);
    snapshot.stats.statistics = ledger;
    const model = buildStatisticsViewModel(snapshot, "today", now);
    const html = renderToStaticMarkup(<>
      <StatisticsSidebarStatus model={model} />
      <StatisticsContent actions={createActions()} chart={<div />} model={model} />
    </>);

    expect(html.match(/1\.250 GB/g)).toHaveLength(2);
    expect(html).toContain("1,2 TB");
  });

  it("marks statistic ranges for one measured vertical selection indicator", () => {
    const model = buildStatisticsViewModel(createSnapshot(), "today", now);
    const html = renderToStaticMarkup(<StatisticsSidebar actions={createActions()} model={model} />);

    expect(html).toContain("ui-sliding-selection ui-sliding-selection-vertical");
    expect(html.match(/data-sliding-selection-item="true"/g)).toHaveLength(6);
    expect(html.match(/data-sliding-selection-active="true"/g)).toHaveLength(1);
  });

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
    for (const label of ["Sitzung", "Heute", "Letzte 24 Stunden", "Sieben Tage", "30 Tage", "Gesamt"]) {
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

  it("renders the rolling range as an account table with its own empty state", () => {
    const snapshot = createSnapshot();
    snapshot.stats.rolling24Hours = {
      from: now - (24 * 60 * 60 * 1_000),
      to: now,
      downloadedBytes: 0,
      accounts: []
    };
    const model = buildStatisticsViewModel(snapshot, "last24", now);
    const html = renderToStaticMarkup(<>
      <StatisticsSidebarStatus model={model} />
      <StatisticsContent actions={createActions()} chart={<div />} model={model} />
    </>);

    expect(html).toContain("<h3>Accounts</h3>");
    expect(html).toContain('aria-label="Account-Nutzung"');
    expect(html).toContain('<span role="columnheader">Account</span>');
    expect(html).toContain("In den vergangenen 24 Stunden wurde noch kein Account-Traffic erfasst.");
    expect(html).toContain("Accounts: 0");
  });
});

describe("bandwidth chart palette", () => {
  it("collects bandwidth samples from the mounted application instead of the statistics tab", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const chartBlock = source.slice(source.indexOf("const BandwidthChart"), source.indexOf("interface DownloadSpeedSparklineProps"));

    expect(source).toContain("appendBandwidthSample(speedHistoryRef.current, liveDownloadSpeedBps");
    expect(chartBlock).not.toContain("history.push");
    expect(chartBlock).not.toContain('item.status === "downloading"');
  });

  it("defines semantic speed and progress text colors for both themes", () => {
    const css = readFileSync(new URL("../src/renderer/theme.css", import.meta.url), "utf8");
    const dark = css.match(/:root,\s*:root\[data-theme="dark"\]\s*\{([\s\S]*?)\}/)?.[1];
    const light = css.match(/:root\[data-theme="light"\]\s*\{([\s\S]*?)\}/)?.[1];

    expect(dark).toContain("--ui-speed-accent: #4ADE80;");
    expect(dark).toContain("--ui-primary-text: #181A1F;");
    expect(dark).toContain("--ui-focus: #9AB8E8;");
    expect(dark).toContain("--ui-success-text: #4ADE80;");
    expect(dark).toContain("--ui-warning-text: #F1C786;");
    expect(dark).toContain("--ui-danger-text: #F06464;");
    expect(dark).toContain("--ui-progress-track-text: #FFFFFF;");
    expect(dark).toContain("--ui-progress-fill-text: #181A1F;");
    expect(light).toContain("--ui-speed-accent: #1E9E55;");
    expect(light).toContain("--ui-primary-text: #FFFFFF;");
    expect(light).toContain("--ui-focus: #24558D;");
    expect(light).toContain("--ui-success-text: #137A3D;");
    expect(light).toContain("--ui-warning-text: #7A4B00;");
    expect(light).toContain("--ui-danger-text: #B4232F;");
    expect(light).toContain("--ui-progress-track-text: #181A1F;");
    expect(light).toContain("--ui-progress-fill-text: #181A1F;");
  });

  it("uses theme-aware primary text and visible focus colors", () => {
    const theme = readFileSync(new URL("../src/renderer/theme.css", import.meta.url), "utf8");
    const shell = readFileSync(new URL("../src/renderer/shell/shell.css", import.meta.url), "utf8");
    const collector = readFileSync(new URL("../src/renderer/views/collector/collector.css", import.meta.url), "utf8");

    expect(theme).toMatch(/:focus-visible\s*\{[^}]*outline:\s*2px solid var\(--ui-focus\);/s);
    expect(shell).toContain("color: var(--ui-update-text);");
    expect(collector.match(/color:\s*var\(--ui-primary-text\);/g)).toHaveLength(1);
  });

  it("requests only the semantic UI color properties and keeps the computed font family", () => {
    const requested: string[] = [];
    const values: Record<string, string> = {
      "--ui-border": " rgb(61, 61, 61) ",
      "--ui-text-muted": " rgb(145, 145, 145) ",
      "--ui-speed-accent": " rgb(242, 148, 45) "
    };

    const palette = readBandwidthChartPalette((property) => {
      requested.push(property);
      return values[property];
    }, "Inter, Segoe UI, sans-serif");

    expect(requested).toEqual(["--ui-border", "--ui-text-muted", "--ui-speed-accent"]);
    expect(palette).toEqual({
      grid: "rgb(61, 61, 61)",
      text: "rgb(145, 145, 145)",
      accent: "rgb(242, 148, 45)",
      fontFamily: "Inter, Segoe UI, sans-serif"
    });
  });

  it("uses the semantic green speed accent for the header sparkline", () => {
    const requested: string[] = [];
    const palette = readDownloadSpeedSparklinePalette((property) => {
      requested.push(property);
      return property === "--ui-speed-accent" ? " rgb(74, 222, 128) " : "";
    });

    expect(requested).toEqual(["--ui-speed-accent"]);
    expect(palette).toEqual({ accent: "rgb(74, 222, 128)" });
  });

  it("uses the spare zero-speed label space for a longer sparkline", () => {
    const css = readFileSync(new URL("../src/renderer/styles.css", import.meta.url), "utf8");
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");

    expect(css).toMatch(/\.speed-sparkline-canvas\s*\{[^}]*width:\s*150px;/s);
    expect(css).toMatch(/\.speed-sparkline-value\s*\{[^}]*flex:\s*0 0 10ch;[^}]*width:\s*10ch;[^}]*min-width:\s*10ch;[^}]*padding:\s*0 8px;/s);
    expect(source).toContain('className="speed-sparkline-graph"');
    expect(css).toMatch(/\.speed-sparkline-graph,\s*\.speed-sparkline-value\s*\{[^}]*background:\s*var\(--field\);[^}]*border:\s*1px solid var\(--border\);[^}]*border-radius:\s*8px;/s);
  });

  it("aligns the idle speed line to one physical pixel at every display scale", () => {
    expect(getIdleSparklineStroke(22, 1)).toEqual({ y: 20.5, lineWidth: 1 });
    expect(getIdleSparklineStroke(22, 1.25)).toEqual({ y: 20.4, lineWidth: 0.8 });
    expect(getIdleSparklineStroke(22, 2)).toEqual({ y: 20.25, lineWidth: 0.5 });
  });

  it("labels the live chart and slows redraws when reduced motion is requested", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const chartBlock = source.slice(source.indexOf("const BandwidthChart"), source.indexOf("interface DownloadSpeedSparklineProps"));

    expect(chartBlock).toContain('role="img"');
    expect(chartBlock).toContain('aria-label="Bandbreitenverlauf der letzten 60 Sekunden"');
    expect(chartBlock).toContain('window.matchMedia("(prefers-reduced-motion: reduce)")');
    expect(chartBlock).toContain("reducedMotion ? 1000 : 750");
  });

  it("asks for confirmation before deleting all saved download statistics", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const actions = source.slice(source.indexOf("const statisticsActions"), source.indexOf("const collectorActions"));

    expect(actions).toContain("askConfirmPrompt");
    expect(actions.indexOf("askConfirmPrompt")).toBeLessThan(actions.indexOf("resetDownloadStats"));
    expect(actions).toContain('title: "Gesamtstatistik zurücksetzen"');
  });

  it("asks for confirmation before resetting session statistics", () => {
    const source = readFileSync(new URL("../src/renderer/App.tsx", import.meta.url), "utf8");
    const actions = source.slice(source.indexOf("const statisticsActions"), source.indexOf("const collectorActions"));
    const sessionReset = actions.slice(actions.indexOf("onResetSession"), actions.indexOf("onResetAll"));

    expect(sessionReset).toContain("askConfirmPrompt");
    expect(sessionReset.indexOf("askConfirmPrompt")).toBeLessThan(sessionReset.indexOf("resetSessionStats"));
    expect(sessionReset).toContain('title: "Sitzungsstatistik zurücksetzen"');
  });
});
