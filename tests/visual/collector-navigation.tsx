import { createRoot } from "react-dom/client";
import { App } from "../../src/renderer/App";
import type { ElectronApi } from "../../src/shared/preload-api";
import type { CollectorPersistenceState } from "../../src/shared/collector";
import { createVisualFixture } from "./fixtures";
import { createVisualElectronApi } from "./mock-electron-api";
import "../../src/renderer/theme.css";
import "../../src/renderer/styles.css";

const fixture = createVisualFixture("dense");
fixture.snapshot.settings.switchToCollectorOnClipboard = false;
let clipboardListener: ((links: string[]) => void) | undefined;
const stateListeners = new Set<Parameters<ElectronApi["onStateUpdate"]>[0]>();
let saved: CollectorPersistenceState = { packages: [], collapsedPackageIds: [] };
let preparedCount = 0;
let releasePreparation: (() => void) | undefined;
let delayPreparation = false;
window.rd = {
  ...createVisualElectronApi(fixture),
  onClipboardDetected: (listener) => { clipboardListener = listener; return () => { clipboardListener = undefined; }; },
  onStateUpdate: (listener) => { stateListeners.add(listener); return () => { stateListeners.delete(listener); }; },
  updateSettings: async (settings) => {
    Object.assign(fixture.snapshot.settings, settings);
    fixture.snapshot.snapshotRevision = (fixture.snapshot.snapshotRevision ?? 0) + 1;
    for (const listener of stateListeners) listener(structuredClone(fixture.snapshot));
    return structuredClone(fixture.snapshot.settings);
  },
  prepareCollectorText: async ({ rawText, addedAt }) => {
    const id = `navigation-${++preparedCount}`;
    if (delayPreparation) await new Promise<void>((resolve) => { releasePreparation = resolve; });
    return {
      packages: [{ id, name: id, nameSource: "explicit", addedAt, links: [{ id: `${id}-link`, url: rawText, fileName: `${id}.rar`, fileSizeBytes: null, hoster: "example.test", availability: "unknown", status: "unknown", addedAt }] }],
      invalidCount: 0, duplicateCount: 0
    };
  },
  saveCollectorState: async (state) => { saved = structuredClone(state); return structuredClone(state); }
};

const report = document.createElement("output");
document.body.append(report);
createRoot(document.getElementById("root")!).render(<App />);
const waitFor = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 10000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Navigation check timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
const activeView = (): string | undefined => document.querySelector<HTMLElement>("[data-visual-active-view]")?.dataset.visualActiveView;
const navigate = async (view: string): Promise<void> => {
  document.querySelector<HTMLButtonElement>(`[data-main-view="${view}"]`)!.click();
  await waitFor(() => activeView() === view);
};
const check = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };

async function verify(): Promise<void> {
  await waitFor(() => Boolean(clipboardListener) && activeView() === "downloads");
  clipboardListener!(["https://example.test/background.rar"]);
  await waitFor(() => saved.packages.length === 1);
  check(activeView() === "downloads", "Default changed the downloads tab");
  await navigate("settings");
  clipboardListener!(["https://example.test/settings.rar"]);
  await waitFor(() => saved.packages.length === 2);
  check(activeView() === "settings", "Background import interrupted settings");
  await window.rd.updateSettings({ switchToCollectorOnClipboard: true });
  await new Promise((resolve) => setTimeout(resolve, 900));
  clipboardListener!(["https://example.test/enabled.rar"]);
  await waitFor(() => saved.packages.length === 3 && activeView() === "collector");
  await navigate("downloads");
  delayPreparation = true;
  clipboardListener!(["https://example.test/disabled-during-import.rar"]);
  await waitFor(() => Boolean(releasePreparation));
  await window.rd.updateSettings({ switchToCollectorOnClipboard: false });
  await new Promise((resolve) => setTimeout(resolve, 900));
  releasePreparation!();
  await waitFor(() => saved.packages.length === 4);
  check(activeView() === "downloads", "An in-flight import ignored disabling the setting");
  report.textContent = JSON.stringify({ passed: true, checks: ["default keeps downloads", "background preserves settings", "opt-in opens collector", "opt-out during import prevents switch"], savedPackages: saved.packages.length });
}

void verify().catch((error) => { report.textContent = String(error); });
