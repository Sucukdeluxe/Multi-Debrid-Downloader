import type { ReactElement } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../../src/renderer/App";
import { DeleteConfirmationDialog } from "../../src/renderer/views/downloads/DeleteConfirmationDialog";
import type { ElectronApi } from "../../src/shared/preload-api";
import "../../src/renderer/theme.css";
import "../../src/renderer/styles.css";
import {
  createVisualFixture,
  installVisualClock,
  waitForVisualFrames,
  type VisualScenario
} from "./fixtures";
import { createVisualElectronApi } from "./mock-electron-api";
import { loadVisualCapture, prepareVisualCapture } from "./ui-driver";

interface VisualHarnessRoot {
  readonly innerText: string;
  textContent: string | null;
  readonly dataset: {
    visualError?: string;
  };
}

interface VisualReadyMarker {
  visualReady?: string;
  visualScenario?: string;
}

interface VisualReadyOptions {
  marker: VisualReadyMarker;
  loadVisualState: () => Promise<void>;
  requestFrame: (callback: FrameRequestCallback) => number;
  maxFrames?: number;
}

interface VisualRenderRoot {
  render: (element: ReactElement) => void;
}

export interface VisualHarnessRuntime {
  readonly search: string;
  readonly rootElement: VisualHarnessRoot | null;
  readonly marker: VisualReadyMarker;
  readonly requestFrame: (callback: FrameRequestCallback) => number;
  readonly maxFrames?: number;
  installClock: () => void;
  setElectronApi: (api: ElectronApi) => void;
  createRoot: (rootElement: VisualHarnessRoot) => VisualRenderRoot;
}

const visibleScenarioContent = {
  empty: ["Noch keine Downloads"],
  dense: ["Dokumentation Staffel 1", "Konzertmitschnitt 2026"],
  update: ["v9.9.9"]
} satisfies Record<VisualScenario, readonly string[]>;

function readScenario(search: string): VisualScenario {
  const scenario = new URLSearchParams(search).get("scenario");
  return scenario === "empty" || scenario === "update" ? scenario : "dense";
}

function missingVisibleContent(scenario: VisualScenario, rootElement: VisualHarnessRoot): string[] {
  return visibleScenarioContent[scenario].filter((expected) => !rootElement.innerText.includes(expected));
}

function waitForVisualFrame(
  requestFrame: (callback: FrameRequestCallback) => number
): Promise<void> {
  return new Promise((resolve) => {
    requestFrame(() => resolve());
  });
}

export function renderVisualApp(render: (element: ReactElement) => void): void {
  render(<App />);
}

export function renderDeleteConfirmationDialog(render: (element: ReactElement) => void): void {
  render(
    <DeleteConfirmationDialog
      dontAsk
      parts={["2 Paket(e)"]}
      totalRemaining={0}
      onCancel={() => {}}
      onConfirm={() => {}}
      onDontAskChange={() => {}}
    />
  );
}

export async function markVisualReady(
  scenario: VisualScenario,
  rootElement: VisualHarnessRoot,
  options: VisualReadyOptions
): Promise<void> {
  delete options.marker.visualReady;
  delete rootElement.dataset.visualError;
  await options.loadVisualState();
  await waitForVisualFrames(options.requestFrame);
  const maxFrames = options.maxFrames ?? 180;

  for (let frame = 0; frame <= maxFrames; frame += 1) {
    const missing = missingVisibleContent(scenario, rootElement);
    if (missing.length === 0) {
      options.marker.visualReady = "true";
      return;
    }
    if (frame < maxFrames) {
      await waitForVisualFrame(options.requestFrame);
    }
  }

  const missing = missingVisibleContent(scenario, rootElement);
  throw new Error(
    `Visual-Harness-Szenario "${scenario}" ist nicht bereit: ${missing.map((value) => `${value} fehlt`).join(", ")}`
  );
}

export function showVisualHarnessError(
  rootElement: VisualHarnessRoot,
  marker: VisualReadyMarker,
  error: unknown
): void {
  delete marker.visualReady;
  rootElement.dataset.visualError = "true";
  rootElement.textContent = `Visual-Harness-Fehler: ${error instanceof Error ? error.message : String(error)}`;
}

function createBrowserVisualHarnessRuntime(): VisualHarnessRuntime {
  const rootElement = document.getElementById("root");
  return {
    search: window.location.search,
    rootElement,
    marker: document.documentElement.dataset,
    requestFrame: window.requestAnimationFrame.bind(window),
    installClock(): void {
      installVisualClock(window);
    },
    setElectronApi(api: ElectronApi): void {
      window.rd = api;
    },
    createRoot(element: VisualHarnessRoot): VisualRenderRoot {
      if (rootElement === null || element !== rootElement) {
        throw new Error("Root element fehlt");
      }
      return createRoot(rootElement);
    }
  };
}

export async function startVisualHarness(
  runtime: VisualHarnessRuntime = createBrowserVisualHarnessRuntime()
): Promise<void> {
  const rootElement = runtime.rootElement;
  if (!rootElement) {
    throw new Error("Root element fehlt");
  }

  try {
    const captureName = new URLSearchParams(runtime.search).get("capture");
    const capture = captureName ? await loadVisualCapture(captureName) : undefined;
    const scenario = capture?.scenario ?? readScenario(runtime.search);
    runtime.installClock();
    const fixture = createVisualFixture(scenario);
    const api = createVisualElectronApi(fixture);
    runtime.setElectronApi(api);
    runtime.marker.visualScenario = scenario;

    const root = runtime.createRoot(rootElement);
    if (new URLSearchParams(runtime.search).get("dialog") === "delete-confirmation") {
      renderDeleteConfirmationDialog((element) => root.render(element));
      await waitForVisualFrames(runtime.requestFrame);
      runtime.marker.visualReady = "true";
      return;
    }
    renderVisualApp((element) => root.render(element));

    const readyOptions = {
      loadVisualState: async () => {
        await Promise.all([api.getSnapshot(), api.getHistory()]);
      },
      requestFrame: runtime.requestFrame,
      maxFrames: runtime.maxFrames
    };

    if (!capture) {
      await markVisualReady(scenario, rootElement, {
        marker: runtime.marker,
        ...readyOptions
      });
      return;
    }

    delete runtime.marker.visualReady;
    await markVisualReady(scenario, rootElement, {
      marker: {},
      ...readyOptions
    });
    await prepareVisualCapture(capture, document);
    runtime.marker.visualReady = "true";
  } catch (error) {
    showVisualHarnessError(rootElement, runtime.marker, error);
  }
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  if (new URLSearchParams(window.location.search).has("check-removal-motion")) void import("./removal-motion-probe");
  startVisualHarness();
}
