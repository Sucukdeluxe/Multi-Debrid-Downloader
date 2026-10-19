import type { ReactElement, ReactNode } from "react";
import type {
  StatisticsMetric,
  StatisticsProviderScope,
  StatisticsRange,
  StatisticsViewModel
} from "./statistics-model";
import { SlidingSelection } from "../../ui/SlidingSelection";
import "./statistics.css";

export interface StatisticsViewActions {
  onRangeChange: (range: StatisticsRange) => void;
  onResetSession: () => void;
  onResetAll: () => void;
  onResetErrors: () => void;
}

export interface StatisticsViewProps {
  model: StatisticsViewModel;
  actions: StatisticsViewActions;
  chart: ReactNode;
}

const rangeItems: Array<{ id: StatisticsRange; label: string }> = [
  { id: "session", label: "Sitzung" },
  { id: "today", label: "Heute" },
  { id: "last24", label: "Letzte 24 Stunden" },
  { id: "week", label: "Sieben Tage" },
  { id: "month", label: "30 Tage" },
  { id: "all", label: "Gesamt" }
];

const numberFormatter = new Intl.NumberFormat("de-DE", { maximumFractionDigits: 1 });

function formatBytes(bytes: number, maximumUnitIndex = Number.POSITIVE_INFINITY): string {
  const safe = Math.max(0, Number.isFinite(bytes) ? bytes : 0);
  if (safe < 1024) {
    return `${Math.round(safe)} B`;
  }
  const units = ["KB", "MB", "GB", "TB", "PB"];
  let value = safe / 1024;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1 && unitIndex < maximumUnitIndex) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${numberFormatter.format(value)} ${units[unitIndex]}`;
}

function formatMetric(metric: StatisticsMetric, kind: "bytes" | "count" | "percent" | "speed"): string {
  if (!metric.available || metric.value === null) {
    return "–";
  }
  if (kind === "bytes") {
    return formatBytes(metric.value, 2);
  }
  if (kind === "speed") {
    return `${formatBytes(metric.value)}/s`;
  }
  if (kind === "percent") {
    return `${numberFormatter.format(metric.value)} %`;
  }
  return numberFormatter.format(metric.value);
}

function providerScopeLabel(scope: StatisticsProviderScope | null): string {
  if (scope === "current-queue") {
    return "Aktuelle Queue";
  }
  if (scope === "today") {
    return "Heute";
  }
  if (scope === "last24") {
    return "Letzte 24 Stunden";
  }
  if (scope === "week") {
    return "Sieben Tage";
  }
  if (scope === "month") {
    return "30 Tage";
  }
  if (scope === "all") {
    return "Gesamt";
  }
  return "Nicht verfügbar";
}

function emptyProviderMessage(model: StatisticsViewModel): string {
  if (model.coverage === "unavailable") {
    return model.message;
  }
  if (model.providerScope === "today") {
    return "Heute wurden noch keine Providerbytes erfasst.";
  }
  if (model.providerScope === "last24") {
    return "In den vergangenen 24 Stunden wurde noch kein Account-Traffic erfasst.";
  }
  if (model.providerScope === "week" || model.providerScope === "month") {
    return "In diesem Zeitraum wurden noch keine Providerwerte erfasst.";
  }
  if (model.providerScope === "all") {
    return "Noch keine gespeicherten Providerbytes vorhanden.";
  }
  return "In der aktuellen Queue sind noch keine Providerwerte vorhanden.";
}

function StatisticsMetricCard({
  label,
  metric,
  kind
}: {
  label: string;
  metric: StatisticsMetric;
  kind: "bytes" | "count" | "percent" | "speed";
}): ReactElement {
  return (
    <article className={`statistics-kpi${metric.tone === "danger" ? " statistics-kpi-danger" : ""}`}>
      <span className="statistics-kpi-label">{label}</span>
      <strong className="statistics-kpi-value">{formatMetric(metric, kind)}</strong>
      <span className="statistics-kpi-source">{metric.sourceLabel}</span>
    </article>
  );
}

export function StatisticsSidebar({ model, actions }: Pick<StatisticsViewProps, "model" | "actions">): ReactElement {
  return (
    <nav aria-label="Statistik-Zeitraum" className="statistics-sidebar" data-visual-region="statistics-sidebar">
      <strong className="statistics-sidebar-heading">Zeitraum</strong>
      <SlidingSelection activeKey={model.range} axis="vertical" className="statistics-range-list">
        {rangeItems.map((item) => (
          <button
            aria-current={model.range === item.id ? "page" : undefined}
            className={`statistics-range${model.range === item.id ? " statistics-range-active" : ""}`}
            data-sliding-selection-active={model.range === item.id}
            data-sliding-selection-item="true"
            key={item.id}
            onClick={() => actions.onRangeChange(item.id)}
            type="button"
          >{item.label}</button>
        ))}
      </SlidingSelection>
      <p className="statistics-sidebar-message">{model.message}</p>
    </nav>
  );
}

export function StatisticsSidebarStatus({ model }: Pick<StatisticsViewProps, "model">): ReactElement | null {
  const metrics = model.metrics;
  const rows = [
    metrics.downloadedBytes.available ? `Daten: ${formatMetric(metrics.downloadedBytes, "bytes")}` : null,
    metrics.files.available ? `Dateien: ${formatMetric(metrics.files, "count")}` : null,
    metrics.successRate.available ? `Erfolg: ${formatMetric(metrics.successRate, "percent")}` : null,
    metrics.errors.available ? `Fehler: ${formatMetric(metrics.errors, "count")}` : null,
    model.providerScope ? `${model.usageKind === "accounts" ? "Accounts" : "Provider"}: ${numberFormatter.format(model.providers.length)}` : null
  ].filter((value): value is string => value !== null);
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="statistics-sidebar-status">
      {rows.map((row) => <span key={row}>{row}</span>)}
    </div>
  );
}

export function StatisticsContent({ model, actions, chart }: StatisticsViewProps): ReactElement {
  const usageHeading = model.usageKind === "accounts" ? "Accounts" : "Provider";
  const usageColumnHeading = model.usageKind === "accounts" ? "Account" : "Provider";
  return (
    <section aria-label="Statistik-Dashboard" className="statistics-content">
      <header className="statistics-heading">
        <div>
          <h2>Statistiken</h2>
          <p>{model.message}</p>
        </div>
        <div aria-label="Statistiken zurücksetzen" className="statistics-reset-actions">
          <button className="statistics-reset" onClick={actions.onResetSession} type="button">Sitzung zurücksetzen</button>
          <button className="statistics-reset" onClick={actions.onResetAll} type="button">Gesamt zurücksetzen</button>
          <button
            className="statistics-reset statistics-reset-danger"
            disabled={!model.errorResetAvailable}
            onClick={actions.onResetErrors}
            type="button"
          >Fehler zurücksetzen</button>
        </div>
      </header>

      <div className="statistics-kpis" data-visual-region="statistics-kpis">
        <StatisticsMetricCard kind="bytes" label="Datenmenge" metric={model.metrics.downloadedBytes} />
        <StatisticsMetricCard kind="count" label="Dateien" metric={model.metrics.files} />
        <StatisticsMetricCard kind="percent" label="Erfolgsquote" metric={model.metrics.successRate} />
        <StatisticsMetricCard kind="speed" label="Durchschnitt" metric={model.metrics.averageSpeedBps} />
        <StatisticsMetricCard kind="count" label="Fehler" metric={model.metrics.errors} />
      </div>

      <div className="statistics-detail-grid">
        <section className="statistics-chart" data-visual-region="statistics-chart">
          <div className="statistics-section-heading">
            <h3>Bandbreitenverlauf</h3>
            <span>Live aus der aktuellen Renderer-Sitzung</span>
          </div>
          <div className="statistics-chart-canvas">{chart}</div>
        </section>

        <section className="statistics-providers">
          <div className="statistics-section-heading">
            <h3>{usageHeading}</h3>
            <span>{providerScopeLabel(model.providerScope)}</span>
          </div>
          <div aria-label={`${usageColumnHeading}-Nutzung`} className="statistics-provider-table" role="table">
            <div className="statistics-provider-header" role="row">
              <span role="columnheader">{usageColumnHeading}</span>
              <span role="columnheader">Daten</span>
              <span role="columnheader">Ergebnisse</span>
            </div>
            <div className="statistics-provider-body" role="rowgroup">
              {model.providers.length > 0 ? model.providers.map((provider) => (
                <div className="statistics-provider-row" key={provider.id} role="row">
                  <span className="statistics-provider-name" role="cell">{provider.label}</span>
                  <span role="cell">{formatBytes(provider.bytes)}</span>
                  <span className={provider.failed && provider.failed > 0 ? "statistics-provider-errors" : undefined} role="cell">
                    {provider.completed === null || provider.failed === null
                      ? "–"
                      : `${numberFormatter.format(provider.completed)} fertig · ${numberFormatter.format(provider.failed)} Fehler`}
                  </span>
                </div>
              )) : (
                <div className="statistics-provider-empty" role="row">
                  <span aria-colspan={3} role="cell">{emptyProviderMessage(model)}</span>
                </div>
              )}
            </div>
          </div>
        </section>
      </div>
    </section>
  );
}

export function StatisticsView({ model, actions, chart }: StatisticsViewProps): ReactElement {
  return (
    <div className="statistics-composed-view">
      <StatisticsSidebar actions={actions} model={model} />
      <StatisticsContent actions={actions} chart={chart} model={model} />
    </div>
  );
}
