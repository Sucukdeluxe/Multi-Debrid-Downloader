import { useState } from "react";
import { createRoot } from "react-dom/client";
import { ContextInfoButton } from "../../src/renderer/ui/ContextInfoButton";
import {
  loadVisualCapture,
  prepareVisualCapture,
  type MainViewId
} from "./ui-driver";

const views: Array<{ id: MainViewId; name: string }> = [
  { id: "downloads", name: "Downloads" },
  { id: "collector", name: "Linksammler" },
  { id: "settings", name: "Einstellungen" },
  { id: "history", name: "Verlauf" },
  { id: "statistics", name: "Statistiken" }
];

function DriverTestApp({ updateAvailable }: { updateAvailable: boolean }) {
  const [activeView, setActiveView] = useState<MainViewId>("downloads");
  const [collectorOpen, setCollectorOpen] = useState(false);
  const [collectorValue, setCollectorValue] = useState("");
  const [collectorRows, setCollectorRows] = useState<string[]>([]);
  const [accountMenuOpen, setAccountMenuOpen] = useState(false);
  const [updateDialogOpen, setUpdateDialogOpen] = useState(updateAvailable);
  const [updateTooltipOpen, setUpdateTooltipOpen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(false);
  const [infoTransitions, setInfoTransitions] = useState<boolean[]>([]);

  return (
    <>
      <nav aria-label="Hauptnavigation">
        {views.map((view) => (
          <button
            key={view.id}
            type="button"
            aria-current={activeView === view.id ? "page" : undefined}
            onClick={() => setActiveView(view.id)}
          >
            {view.name}
          </button>
        ))}
      </nav>
      <main data-visual-active-view={activeView}>
        {activeView === "downloads" && (
          <>
            <div data-visual-region="downloads-sidebar">Download-Seitenleiste</div>
            <div data-visual-region="downloads-sidebar-status">3 Pakete aktiv</div>
            <div data-visual-region="downloads-toolbar">Download-Werkzeuge</div>
            <div data-visual-region="downloads-table-body">
              <div role="row">Dokumentation Staffel 1</div>
            </div>
            <div data-visual-region="downloads-pagination">Seite 1 von 1</div>
            <ContextInfoButton
              content={<><span>Drei Downloads sind sichtbar.</span><button type="button">Kontextaktion</button></>}
              contextName="Downloads"
              onOpenChange={(open) => {
                setInfoTransitions((transitions) => [...transitions, open]);
                setInfoOpen(open);
              }}
              open={infoOpen}
            />
            <output data-context-info-transitions={infoTransitions.map((open) => open ? "open" : "closed").join(",")} />
          </>
        )}
        {activeView === "collector" && (
          <>
            <div data-visual-region="collector-sidebar">Linksammler-Seitenleiste</div>
            <div data-visual-region="collector-toolbar">Linksammler-Werkzeuge</div>
            <button type="button" onClick={() => setCollectorOpen(true)}>Links hinzufügen</button>
            {collectorRows.length === 0 && <div data-visual-region="collector-empty-state">Keine Links</div>}
            <div data-visual-region="collector-table-body">
              {collectorRows.map((link) => <div role="row" key={link}>{link}</div>)}
            </div>
          </>
        )}
        {activeView === "settings" && (
          <>
            <div data-visual-region="settings-sidebar">Einstellungs-Seitenleiste</div>
            <button type="button">Accounts</button>
            <div data-visual-region="accounts-table-body"><div role="row">Visual Account</div></div>
            <button
              type="button"
              disabled={updateDialogOpen}
              onClick={() => setAccountMenuOpen((open) => !open)}
            >
              Kontomenü
            </button>
          </>
        )}
        {activeView === "history" && (
          <>
            <div data-visual-region="history-sidebar">Verlauf-Seitenleiste</div>
            <div data-visual-region="history-toolbar">Verlauf-Werkzeuge</div>
            <div data-visual-region="history-table-body"><div role="row">Naturfilm Sammlung</div></div>
            <div data-visual-region="history-pagination">Seite 1 von 1</div>
          </>
        )}
        {activeView === "statistics" && (
          <>
            <div data-visual-region="statistics-sidebar">Statistik-Seitenleiste</div>
            <div data-visual-region="statistics-kpis">919,82 GB</div>
            <div data-visual-region="statistics-chart">Download-Verlauf</div>
          </>
        )}
      </main>
      {collectorOpen && (
        <div role="dialog" aria-label="Links hinzufügen">
          <textarea aria-label="Links" value={collectorValue} onChange={(event) => setCollectorValue(event.target.value)} />
          <button
            type="button"
            onClick={() => {
              setCollectorRows(collectorValue.split(/\r?\n/).map((value) => value.trim()).filter(Boolean));
              setCollectorOpen(false);
            }}
          >
            Übernehmen
          </button>
        </div>
      )}
      {updateDialogOpen && (
        <div role="dialog" aria-label="Update installieren">
          <strong>Update installieren</strong>
          <button type="button" onClick={() => setUpdateDialogOpen(false)}>Später</button>
        </div>
      )}
      {accountMenuOpen && (
        <div role="menu" aria-label="Kontomenü">
          <button
            type="button"
            aria-label="Update verfügbar"
            onMouseEnter={() => setUpdateTooltipOpen(true)}
            onFocus={() => setUpdateTooltipOpen(true)}
          >
            Update verfügbar
          </button>
        </div>
      )}
      {updateTooltipOpen && <div role="tooltip" aria-label="Update verfügbar">Version 9.9.9 verfügbar</div>}
    </>
  );
}

async function startDriverTest(): Promise<void> {
  const rootElement = document.getElementById("root");
  if (!rootElement) {
    throw new Error("Root element fehlt");
  }
  const captureName = new URLSearchParams(window.location.search).get("capture");
  if (!captureName) {
    throw new Error("Capture fehlt");
  }
  try {
    const capture = await loadVisualCapture(captureName);
    createRoot(rootElement).render(<DriverTestApp updateAvailable={capture.scenario === "update"} />);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    await prepareVisualCapture(capture, document);
    await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    document.documentElement.dataset.visualReady = "true";
  } catch (error) {
    delete document.documentElement.dataset.visualReady;
    rootElement.dataset.visualError = "true";
    rootElement.textContent = `Visual-Harness-Fehler: ${error instanceof Error ? error.message : String(error)}`;
  }
}

void startDriverTest();
