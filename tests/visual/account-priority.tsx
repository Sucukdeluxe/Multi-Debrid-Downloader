import { createRoot } from "react-dom/client";
import { App } from "../../src/renderer/App";
import { createVisualFixture } from "./fixtures";
import { createVisualElectronApi } from "./mock-electron-api";
import type { RendererSettingsUpdate } from "../../src/shared/types";
import "../../src/renderer/theme.css";
import "../../src/renderer/styles.css";

const fixture = createVisualFixture("dense");
fixture.snapshot.settings.language = "de";
fixture.snapshot.settings.theme = new URLSearchParams(location.search).get("theme") === "light" ? "light" : "dark";
fixture.snapshot.settings.themePreference = fixture.snapshot.settings.theme;
const baseApi = createVisualElectronApi(fixture);
let saved: RendererSettingsUpdate | undefined;
window.rd = { ...baseApi, updateSettings: async (settings) => { saved = structuredClone(settings); return baseApi.updateSettings(settings); } };
createRoot(document.getElementById("root")!).render(<App />);
const report = document.createElement("output");
document.body.append(report);
const waitFor = async (condition: () => boolean): Promise<void> => {
  const deadline = Date.now() + 10000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("Account priority check timed out");
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
};
const click = (selector: string): void => document.querySelector<HTMLElement>(selector)!.click();
const assert = (condition: boolean, message: string): void => { if (!condition) throw new Error(message); };

async function verify(): Promise<void> {
  await waitFor(() => Boolean(document.querySelector('[data-main-view="settings"]')));
  click('[data-main-view="settings"]');
  await waitFor(() => Boolean(document.querySelector(".settings-sidebar-item")));
  [...document.querySelectorAll<HTMLButtonElement>(".settings-sidebar-item")].find((button) => button.textContent === "Accounts")!.click();
  await waitFor(() => Boolean(document.querySelector("#settings-account-rules-tab")));
  click("#settings-account-rules-tab");
  await waitFor(() => Boolean(document.querySelector('[name="account-selection-debridlink"]')));
  const control = document.querySelector<HTMLInputElement>('[name="account-selection-debridlink"]')!.closest<HTMLDetailsElement>("details")!;
  control.open = true;
  const ids = () => [...control.querySelectorAll<HTMLElement>("[data-priority-account]")].map((row) => row.dataset.priorityAccount!);
  const original = ids();
  assert(original.length === 2, "Fixture needs two keys");
  const radios = control.querySelectorAll<HTMLInputElement>('input[type="radio"]');
  assert(radios[0].checked, "Automatic mode must be the default");
  radios[1].click();
  await waitFor(() => radios[1].checked);
  control.querySelectorAll<HTMLButtonElement>('[data-priority-account] button')[1].click();
  await waitFor(() => ids()[0] === original[1]);
  const transfer = new DataTransfer();
  const rows = control.querySelectorAll<HTMLElement>("[data-priority-account]");
  rows[0].dispatchEvent(new DragEvent("dragstart", { bubbles: true, dataTransfer: transfer }));
  rows[1].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: transfer }));
  await waitFor(() => ids()[0] === original[0]);
  const crossProvider = new DataTransfer();
  crossProvider.setData("application/x-mdd-account-priority", JSON.stringify({ provider: "realdebrid", id: original[1] }));
  rows[0].dispatchEvent(new DragEvent("drop", { bubbles: true, cancelable: true, dataTransfer: crossProvider }));
  assert(ids()[0] === original[0], "Cross-provider drag changed the account order");
  control.querySelectorAll<HTMLButtonElement>('[data-priority-account] button')[1].click();
  await waitFor(() => ids()[0] === original[1]);
  [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Einstellungen speichern")!.click();
  await waitFor(() => Boolean(saved?.accountUsageRules?.debridlink));
  assert(saved!.accountUsageRules!.debridlink!.mode === "priority", "Mode was not saved");
  assert(saved!.accountUsageRules!.debridlink!.accountIds.join() === [...original].reverse().join(), "Order was not saved");
  assert(control.scrollWidth <= control.clientWidth + 1, "Priority controls overflow horizontally");
  control.scrollIntoView({ block: "center" });
  report.textContent = JSON.stringify({ passed: true, theme: fixture.snapshot.settings.theme, checks: ["expand", "automatic default", "mode change", "arrow reorder", "drag reorder", "reject cross-provider drag", "save mode and order", "no horizontal overflow"] });
}
void verify().catch((error) => { report.textContent = String(error); });
