import { createRoot } from "react-dom/client";
import { App } from "../../src/renderer/App";
import type { ElectronApi } from "../../src/shared/preload-api";
import { sortPackageOrderByAvailability } from "../../src/renderer/package-order";
import { createVisualFixture } from "./fixtures";
import { createVisualElectronApi } from "./mock-electron-api";
import "../../src/renderer/theme.css";
import "../../src/renderer/styles.css";

const fixture = createVisualFixture("dense");
fixture.snapshot.settings.animatePackageDisclosure = true;
const listeners = new Set<Parameters<ElectronApi["onStateUpdate"]>[0]>();
const emit = (): void => {
  fixture.snapshot.snapshotRevision = (fixture.snapshot.snapshotRevision ?? 0) + 1;
  for (const listener of listeners) listener(structuredClone(fixture.snapshot));
};
window.rd = {
  ...createVisualElectronApi(fixture),
  onStateUpdate: (listener) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  reorderPackages: async (order) => {
    emit();
    await new Promise((resolve) => setTimeout(resolve, 750));
    fixture.snapshot.session.packageOrder = [...order];
    emit();
  }
};

const report = document.createElement("output");
report.style.cssText = "position:fixed;bottom:0;left:0;z-index:9999;background:#fff;color:#111;font-size:12px;padding:8px";
report.textContent = "Prüfung wird vorbereitet";
document.body.append(report);
createRoot(document.getElementById("root")!).render(<App />);

async function verify(): Promise<void> {
  const frame = (): Promise<void> => new Promise((resolve) => requestAnimationFrame(() => resolve()));
  const findSortButton = (): HTMLButtonElement | undefined => [...document.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => /^Verfügbarkeit(?: [↑↓])?$/.test(button.textContent?.trim() ?? ""));
  for (let attempt = 0; attempt < 180 && !findSortButton(); attempt++) await frame();
  const sortButton = findSortButton();
  if (!sortButton) throw new Error("Verfügbarkeitsspalte fehlt");
  const results = [];
  const originalOrder = [...fixture.snapshot.session.packageOrder];
  for (let turn = 0; turn < 6; turn++) {
    const phase = turn % 3;
    const expected = (phase === 2 ? originalOrder : sortPackageOrderByAvailability(
      fixture.snapshot.session.packageOrder,
      fixture.snapshot.session.packages,
      fixture.snapshot.session.items,
      phase === 1
    )).map((id) => fixture.snapshot.session.packages[id].name);
    let wrongOrderUpdates = 0;
    const orderChanges: string[][] = [];
    const body = document.querySelector<HTMLElement>(".downloads-table-body")!;
    const observer = new MutationObserver(() => {
      const actual = [...body.querySelectorAll("article strong")].map((element) => element.textContent ?? "");
      if (JSON.stringify(actual) !== JSON.stringify(orderChanges.at(-1))) orderChanges.push(actual);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) wrongOrderUpdates++;
    });
    observer.observe(body, { childList: true, subtree: true });
    sortButton.click();
    const deadline = performance.now() + 1600;
    let frames = 0;
    let wrongOrderFrames = 0;
    let movingFrames = 0;
    while (performance.now() < deadline) {
      await frame();
      frames++;
      const body = document.querySelector<HTMLElement>(".downloads-table-body")!;
      const actual = [...body.querySelectorAll("article strong")].map((element) => element.textContent);
      if (JSON.stringify(actual) !== JSON.stringify(expected)) wrongOrderFrames++;
      const rows = [...body.querySelectorAll<HTMLElement>(".downloads-virtual-row")];
      if (rows.some((row) => {
        const target = Number.parseFloat(row.style.getPropertyValue("--downloads-virtual-row-top"));
        const transform = new DOMMatrixReadOnly(getComputedStyle(row).transform);
        return Math.abs(transform.m42 - target) > 0.5;
      })) movingFrames++;
    }
    observer.disconnect();
    const expectedAriaSort = phase === 2 ? "none" : phase === 0 ? "descending" : "ascending";
    const correctIndicator = sortButton.closest("[aria-sort]")?.getAttribute("aria-sort") === expectedAriaSort;
    results.push({ direction: ["online-first", "offline-first", "off"][phase], correctIndicator, frames, wrongOrderFrames, wrongOrderUpdates, movingFrames, orderChanges });
  }
  report.textContent = JSON.stringify({ passed: results.every((result) => result.correctIndicator && result.wrongOrderFrames === 0 && result.wrongOrderUpdates === 0 && result.movingFrames === 0), results });
}

void verify().catch((error) => { report.textContent = String(error); });
