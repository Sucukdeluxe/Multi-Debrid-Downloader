import React, { type ReactElement } from "react";
import { describe, expect, it } from "vitest";
import { App } from "../src/renderer/App";
import type { ElectronApi } from "../src/shared/preload-api";
import * as visualFixtures from "./visual/fixtures";
import * as visualMain from "./visual/main";
import { createVisualElectronApi } from "./visual/mock-electron-api";

const { createVisualFixture } = visualFixtures;

interface TestVisualRoot {
  innerText: string;
  textContent: string | null;
  dataset: {
    visualError?: string;
  };
}

interface TestVisualMarker {
  visualReady?: string;
  visualScenario?: string;
}

function createTestVisualBootstrap(
  search: string,
  initialInnerText: string,
  onFrame: (frame: number, rootElement: TestVisualRoot) => void,
  maxFrames = 2
) {
  const rootElement: TestVisualRoot = {
    innerText: initialInnerText,
    textContent: initialInnerText,
    dataset: {}
  };
  const marker: TestVisualMarker = {};
  const createdRootElements: TestVisualRoot[] = [];
  const renderedElements: ReactElement[] = [];
  const assignedApis: ElectronApi[] = [];
  const markerValuesByFrame: Array<string | undefined> = [];
  const clockInstalls: string[] = [];
  let frameCount = 0;

  const runtime = {
    search,
    rootElement,
    marker,
    maxFrames,
    installClock(): void {
      clockInstalls.push(search);
    },
    setElectronApi(api: ElectronApi): void {
      assignedApis.push(api);
    },
    createRoot(element: TestVisualRoot) {
      createdRootElements.push(element);
      return {
        render(renderedElement: ReactElement): void {
          renderedElements.push(renderedElement);
        }
      };
    },
    requestFrame(callback: FrameRequestCallback): number {
      frameCount += 1;
      markerValuesByFrame.push(marker.visualReady);
      onFrame(frameCount, rootElement);
      callback(0);
      return frameCount;
    }
  };

  return {
    runtime,
    rootElement,
    marker,
    createdRootElements,
    renderedElements,
    assignedApis,
    markerValuesByFrame,
    clockInstalls
  };
}

describe("visual fixtures", () => {
  it("keeps empty, dense and update states deterministic and distinct", () => {
    const empty = createVisualFixture("empty");
    const dense = createVisualFixture("dense");
    const update = createVisualFixture("update");
    expect(Object.keys(empty.snapshot.session.packages)).toHaveLength(0);
    expect(Object.keys(dense.snapshot.session.packages).length).toBeGreaterThan(1);
    expect(update.update.latestTag).toBe("v9.9.9");
    expect(createVisualFixture("dense")).toEqual(dense);
  });

  it("freezes runtime and recurring chart timers across visual frames", async () => {
    const dense = createVisualFixture("dense");
    const originalDateNow = Date.now;
    let timerTicks = 0;
    const timerTarget = {
      setInterval(handler: TimerHandler, _timeout?: number): number {
        if (typeof handler === "function") {
          handler();
        }
        return 1;
      }
    };
    const restore = visualFixtures.installVisualClock(timerTarget);

    try {
      const runtime = (): number => dense.snapshot.stats.sessionRuntimeMs
        + Math.max(0, Date.now() - dense.snapshot.stats.runtimeMeasuredAt);
      const firstRuntime = runtime();
      const frameTimes: number[] = [];
      timerTarget.setInterval(() => { timerTicks += 1; }, 250);
      await visualFixtures.waitForVisualFrames((callback) => {
        frameTimes.push(Date.now());
        callback(0);
        return frameTimes.length;
      });
      timerTarget.setInterval(() => { timerTicks += 1; }, 250);
      timerTarget.setInterval(() => { timerTicks += 1; }, 1000);

      expect(Date.now()).toBe(1786312800000);
      expect(firstRuntime).toBe(3600000);
      expect(runtime()).toBe(firstRuntime);
      expect(frameTimes).toEqual([1786312800000, 1786312800000]);
      expect(timerTicks).toBe(0);
    } finally {
      restore();
    }

    expect(Date.now).toBe(originalDateNow);
  });

  it("aligns dense account table values with credential-derived account IDs", async () => {
    const dense = createVisualFixture("dense");
    const settings = dense.snapshot.settings;
    const megaAccount = dense.snapshot.accounts.find((account) => account.kind === "megadebrid-api");
    const debridLinkKeys = dense.snapshot.accounts.filter((account) => account.kind === "debridlink-api");
    const megaAccountId = megaAccount?.accountId || "";

    expect(megaAccountId).toBe("mda_2f92guyzhdf6j");
    expect(debridLinkKeys.map((entry) => entry.accountId)).toEqual([
      "dlk_1ix5qlyx6mtm1",
      "dlk_1ix5pfvlg4nkg"
    ]);
    expect(settings.debridAccountStatuses[megaAccountId]?.valid).toBe(true);
    expect(settings.megaDebridAccountDailyLimitBytes[megaAccountId]).toBeGreaterThan(0);
    expect(settings.megaDebridAccountDailyUsageBytes[megaAccountId]).toBeGreaterThan(0);
    expect(settings.megaDebridAccountTotalUsageBytes[megaAccountId]).toBeGreaterThan(
      settings.megaDebridAccountDailyUsageBytes[megaAccountId]
    );

    for (const entry of debridLinkKeys) {
      expect(settings.debridAccountStatuses[entry.accountId]?.valid).toBe(true);
      expect(settings.debridLinkApiKeyDailyLimitBytes[entry.accountId]).toBeGreaterThan(0);
      expect(settings.debridLinkApiKeyDailyUsageBytes[entry.accountId]).toBeGreaterThan(0);
      expect(settings.debridLinkApiKeyDailyUsageBytes[entry.accountId]).toBeLessThan(
        settings.debridLinkApiKeyDailyLimitBytes[entry.accountId]
      );
      expect(settings.debridLinkApiKeyTotalUsageBytes[entry.accountId]).toBeGreaterThan(
        settings.debridLinkApiKeyDailyUsageBytes[entry.accountId]
      );
    }

    const debridLinkItem = Object.values(dense.snapshot.session.items).find(
      (item) => item.provider === "debridlink"
    );
    expect(debridLinkItem?.providerAccountId).toBe(debridLinkKeys[0].accountId);
    const hostLimits = await createVisualElectronApi(dense).getDebridLinkHostLimits();
    expect(hostLimits[0]?.keyId).toBe(debridLinkKeys[0].accountId);
  });

  it("stores every mutable bridge state inside the visual fixture", async () => {
    const dense = createVisualFixture("dense");
    const api = createVisualElectronApi(dense);

    await api.setTraceEnabled(true);
    expect(dense).toHaveProperty("traceConfig.enabled", true);

    await api.enableRemoteDiagnostics({
      hostMode: "network",
      publicHost: "capture.example.test",
      port: 8123,
      allowlist: ["192.0.2.10"],
      name: "Capture Harness"
    });
    expect(dense).toHaveProperty("remoteDiagnostics.status.running", true);
    expect(dense).toHaveProperty("remoteDiagnostics.status.port", 8123);
    expect(dense).toHaveProperty("remoteDiagnostics.publicHost", "capture.example.test");

    await api.disableRemoteDiagnostics();
    expect(dense).toHaveProperty("remoteDiagnostics.status.running", false);
  });

  it("emits the priority-sorted snapshot so visual tests can observe package motion", async () => {
    const dense = createVisualFixture("dense");
    const api = createVisualElectronApi(dense);
    const snapshots: string[][] = [];
    const unsubscribe = api.onStateUpdate((snapshot) => snapshots.push([...snapshot.session.packageOrder]));
    const target = dense.snapshot.session.packageOrder[0];

    await api.setPackagePriority(target, "low");

    expect(dense.snapshot.session.packageOrder.at(-1)).toBe(target);
    expect(snapshots.at(-1)?.at(-1)).toBe(target);
    unsubscribe();
  });

  it("can boot the isolated renderer with animations disabled", async () => {
    const dense = createVisualFixture("dense");
    const api = createVisualElectronApi(dense, "?animations=off");

    expect((await api.getSnapshot()).settings.animatePackageDisclosure).toBe(false);
  });

  it("keeps a configured archive password list stateful in the isolated renderer", async () => {
    const dense = createVisualFixture("dense");
    const api = createVisualElectronApi(dense, "?archive-passwords=configured");

    expect(await api.getArchivePasswordList()).toEqual({
      passwords: "visual-archive-password-one\nvisual-archive-password-two"
    });
    expect((await api.getSnapshot()).settings.archivePasswordListConfigured).toBe(true);

    await api.updateSettings({ archivePasswordList: "updated-visual-password" });

    expect(await api.getArchivePasswordList()).toEqual({ passwords: "updated-visual-password" });
  });

  it("boots the dense query once and waits for both visible package names", async () => {
    expect(typeof window).toBe("undefined");
    const harness = createTestVisualBootstrap(
      "?scenario=dense",
      "Dokumentation Staffel 1",
      (frame, rootElement) => {
        if (frame === 3) {
          rootElement.innerText = "Dokumentation Staffel 1 Konzertmitschnitt 2026";
        }
      }
    );

    await visualMain.startVisualHarness(harness.runtime);

    expect(harness.clockInstalls).toHaveLength(1);
    expect(harness.createdRootElements).toEqual([harness.rootElement]);
    expect(harness.renderedElements).toHaveLength(1);
    expect(harness.renderedElements[0].type).toBe(App);
    expect(harness.renderedElements[0].type).not.toBe(React.StrictMode);
    expect(harness.assignedApis).toHaveLength(1);
    const snapshot = await harness.assignedApis[0].getSnapshot();
    expect(Object.values(snapshot.session.packages).map((pkg) => pkg.name)).toEqual([
      "Dokumentation Staffel 1",
      "Konzertmitschnitt 2026",
      "Archiv mit Wiederholung"
    ]);
    expect(harness.marker.visualScenario).toBe("dense");
    expect(harness.markerValuesByFrame).toEqual([undefined, undefined, undefined]);
    expect(harness.marker.visualReady).toBe("true");
    expect(harness.rootElement.dataset.visualError).toBeUndefined();
    expect(typeof window).toBe("undefined");
  });

  it("resolves the update query and waits for visible v9.9.9 evidence", async () => {
    const harness = createTestVisualBootstrap(
      "?scenario=update",
      "Update verfügbar",
      (frame, rootElement) => {
        if (frame === 3) {
          rootElement.innerText = "Update verfügbar v9.9.9";
        }
      }
    );

    await visualMain.startVisualHarness(harness.runtime);

    expect(harness.createdRootElements).toHaveLength(1);
    expect(harness.renderedElements).toHaveLength(1);
    expect(harness.marker.visualScenario).toBe("update");
    expect(harness.markerValuesByFrame).toEqual([undefined, undefined, undefined]);
    expect(harness.marker.visualReady).toBe("true");
    expect((await harness.assignedApis[0].checkUpdates()).latestTag).toBe("v9.9.9");
  });

  it("catches missing update evidence inside the bootstrap and exposes a local error", async () => {
    const harness = createTestVisualBootstrap(
      "?scenario=update",
      "Update verfügbar",
      () => undefined,
      0
    );
    harness.marker.visualReady = "true";

    await expect(visualMain.startVisualHarness(harness.runtime)).resolves.toBeUndefined();

    expect(harness.createdRootElements).toHaveLength(1);
    expect(harness.renderedElements).toHaveLength(1);
    expect(harness.marker.visualScenario).toBe("update");
    expect(harness.markerValuesByFrame).toEqual([undefined, undefined]);
    expect(harness.marker.visualReady).toBeUndefined();
    expect(harness.rootElement.dataset.visualError).toBe("true");
    expect(harness.rootElement.textContent).toBe(
      'Visual-Harness-Fehler: Visual-Harness-Szenario "update" ist nicht bereit: v9.9.9 fehlt'
    );
  });
});
