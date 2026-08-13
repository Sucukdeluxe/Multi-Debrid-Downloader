import { describe, expect, it, vi } from "vitest";
import { AppController } from "../src/main/app-controller";

vi.mock("electron", () => ({
  app: { getPath: () => "C:\\MDD\\Test" },
  BrowserWindow: class {},
  clipboard: {},
  dialog: {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  Menu: { buildFromTemplate: vi.fn(), setApplicationMenu: vi.fn() },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: vi.fn(), decryptString: vi.fn() },
  shell: {},
  Tray: class {}
}));

describe("reset controller boundary", () => {
  it("audits reset completion only after the manager operation succeeds", async () => {
    const packagePromise = Promise.resolve();
    const itemPromise = Promise.resolve();
    const controller = Object.create(AppController.prototype) as {
      manager: {
        resetPackage: ReturnType<typeof vi.fn>;
        resetItems: ReturnType<typeof vi.fn>;
      };
      audit: ReturnType<typeof vi.fn>;
      resetPackage: (packageId: string) => Promise<void>;
      resetItems: (itemIds: string[]) => Promise<void>;
    };
    controller.manager = {
      resetPackage: vi.fn(() => packagePromise),
      resetItems: vi.fn(() => itemPromise)
    };
    controller.audit = vi.fn();

    await controller.resetPackage("package-1");
    await controller.resetItems(["item-1"]);

    expect(controller.audit.mock.calls.map((call) => call[1])).toEqual([
      "Paket-Reset angefordert",
      "Paket-Reset abgeschlossen",
      "Item-Reset angefordert",
      "Item-Reset abgeschlossen"
    ]);
  });

  it("audits reset failures instead of reporting a false success", async () => {
    const controller = Object.create(AppController.prototype) as {
      manager: {
        resetPackage: ReturnType<typeof vi.fn>;
        resetItems: ReturnType<typeof vi.fn>;
      };
      audit: ReturnType<typeof vi.fn>;
      resetPackage: (packageId: string) => Promise<void>;
      resetItems: (itemIds: string[]) => Promise<void>;
    };
    controller.manager = {
      resetPackage: vi.fn(async () => { throw new Error("C:\\private\\locked.part"); }),
      resetItems: vi.fn(async () => { throw new Error("item locked"); })
    };
    controller.audit = vi.fn();

    await expect(controller.resetPackage("package-1")).rejects.toThrow();
    await expect(controller.resetItems(["item-1"])).rejects.toThrow();

    expect(controller.audit.mock.calls.map((call) => call[1])).toEqual([
      "Paket-Reset angefordert",
      "Paket-Reset fehlgeschlagen",
      "Item-Reset angefordert",
      "Item-Reset fehlgeschlagen"
    ]);
  });
});

describe("session control diagnostics", () => {
  it("records requested and applied phases for stop and pause", () => {
    const snapshot = {
      session: {
        running: true,
        paused: false,
        packages: { "package-1": {} },
        items: {
          "item-1": { status: "downloading" },
          "item-2": { status: "queued" }
        }
      }
    };
    const controller = Object.create(AppController.prototype) as {
      manager: {
        stop: ReturnType<typeof vi.fn>;
        togglePause: ReturnType<typeof vi.fn>;
        getSnapshot: ReturnType<typeof vi.fn>;
      };
      audit: ReturnType<typeof vi.fn>;
      stop: () => void;
      togglePause: () => boolean;
    };
    controller.manager = {
      stop: vi.fn(() => { snapshot.session.running = false; }),
      togglePause: vi.fn(() => {
        snapshot.session.running = true;
        snapshot.session.paused = true;
        return true;
      }),
      getSnapshot: vi.fn(() => snapshot)
    };
    controller.audit = vi.fn();

    controller.stop();
    controller.togglePause();

    expect(controller.audit.mock.calls.map((call) => call[1])).toEqual([
      "Session-Stopp angefordert",
      "Session-Stopp angewendet",
      "Pause angefordert",
      "Pause angewendet"
    ]);
  });
});

describe("support bundle diagnostics", () => {
  it("records selection and export phases without target paths", () => {
    const controller = Object.create(AppController.prototype) as {
      manager: {
        getSnapshot: ReturnType<typeof vi.fn>;
      };
      audit: ReturnType<typeof vi.fn>;
      recordSupportBundleExportSelected: () => void;
      recordSupportBundleExportLifecycle: (event: {
        phase: "write" | "failure";
        durationMs: number;
        totalDurationMs: number;
        bytes?: number;
        failedPhase?: "write";
        code?: string;
      }) => void;
    };
    controller.manager = {
      getSnapshot: vi.fn(() => ({
        session: {
          running: true,
          paused: false,
          packages: { "package-1": {} },
          items: {
            "item-1": { status: "downloading" },
            "item-2": { status: "queued" }
          }
        }
      }))
    };
    controller.audit = vi.fn();

    controller.recordSupportBundleExportSelected();
    controller.recordSupportBundleExportLifecycle({
      phase: "write",
      durationMs: 250,
      totalDurationMs: 700,
      bytes: 4096
    });
    controller.recordSupportBundleExportLifecycle({
      phase: "failure",
      durationMs: 300,
      totalDurationMs: 1000,
      failedPhase: "write",
      code: "ENOSPC"
    });

    expect(controller.audit.mock.calls).toEqual([
      ["INFO", "Support-Bundle-Ziel ausgewählt", {
        phase: "selected",
        running: true,
        paused: false,
        packageCount: 1,
        itemCount: 2,
        activeItemCount: 1
      }],
      ["INFO", "Support-Bundle geschrieben", {
        phase: "write",
        durationMs: 250,
        totalDurationMs: 700,
        bytes: 4096
      }],
      ["ERROR", "Support-Bundle-Export fehlgeschlagen", {
        phase: "failure",
        durationMs: 300,
        totalDurationMs: 1000,
        failedPhase: "write",
        code: "ENOSPC"
      }]
    ]);
    expect(JSON.stringify(controller.audit.mock.calls)).not.toContain("C:\\");
  });
});
