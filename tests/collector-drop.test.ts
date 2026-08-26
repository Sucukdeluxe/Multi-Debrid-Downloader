import { describe, expect, it, vi } from "vitest";
import { resolveDroppedDlcPaths, routeDroppedDlcFiles } from "../src/renderer/collector-drop";

describe("collector DLC drop routing", () => {
  it("resolves native DLC paths without using File.path", () => {
    const first = { name: "first.dlc" } as File;
    const ignored = { name: "notes.txt" } as File;
    const second = { name: "SECOND.DLC" } as File;
    const getPath = vi.fn((file: File) => file === first ? "C:\\Drops\\first.dlc" : "C:\\Drops\\second.dlc");

    expect(resolveDroppedDlcPaths([first, ignored, second], getPath)).toEqual([
      "C:\\Drops\\first.dlc",
      "C:\\Drops\\second.dlc"
    ]);
    expect(getPath.mock.calls.map(([file]) => file)).toEqual([first, second]);
  });

  it("sends Downloads drops directly to addContainers and never to an inspector", async () => {
    const file = { name: "queue.dlc" } as File;
    const addContainers = vi.fn(async () => ({ addedPackages: 2, addedLinks: 16 }));
    const inspectContainers = vi.fn(async () => ({ packages: [], invalidCount: 0, duplicateCount: 0 }));

    await expect(routeDroppedDlcFiles([file], "downloads", () => "C:\\Drops\\queue.dlc", {
      addContainers,
      inspectContainers
    })).resolves.toEqual({
      kind: "downloads",
      result: { addedPackages: 2, addedLinks: 16 }
    });
    expect(addContainers).toHaveBeenCalledTimes(1);
    expect(inspectContainers).not.toHaveBeenCalled();
  });

  it("sends Collector drops only to structure inspection", async () => {
    const file = { name: "preview.dlc" } as File;
    const addContainers = vi.fn(async () => ({ addedPackages: 1, addedLinks: 1 }));
    const structure = { packages: [{ id: "package-1", name: "Serie", links: [], addedAt: 1000 }], invalidCount: 0, duplicateCount: 0 };
    const inspectContainers = vi.fn(async () => structure);

    await expect(routeDroppedDlcFiles([file], "collector", () => "C:\\Drops\\preview.dlc", {
      addContainers,
      inspectContainers
    }, 1000)).resolves.toEqual({ kind: "collector", result: structure });
    expect(inspectContainers).toHaveBeenCalledWith(["C:\\Drops\\preview.dlc"], 1000);
    expect(addContainers).not.toHaveBeenCalled();
  });

  it("does not let a hanging Collector inspection block a Downloads drop", async () => {
    const collectorFile = { name: "slow.dlc" } as File;
    const downloadFile = { name: "fast.dlc" } as File;
    const inspectContainers = vi.fn(() => new Promise<never>(() => {}));
    const addContainers = vi.fn(async () => ({ addedPackages: 1, addedLinks: 8 }));

    void routeDroppedDlcFiles([collectorFile], "collector", () => "C:\\Drops\\slow.dlc", { addContainers, inspectContainers }, 1000);
    await expect(routeDroppedDlcFiles([downloadFile], "downloads", () => "C:\\Drops\\fast.dlc", {
      addContainers,
      inspectContainers
    })).resolves.toEqual({
      kind: "downloads",
      result: { addedPackages: 1, addedLinks: 8 }
    });
  });

  it("returns a controlled empty result when no native DLC path is available", async () => {
    const file = { name: "missing.dlc" } as File;
    const addContainers = vi.fn();
    const inspectContainers = vi.fn();

    await expect(routeDroppedDlcFiles([file], "downloads", () => "", { addContainers, inspectContainers })).resolves.toEqual({ kind: "empty" });
    expect(addContainers).not.toHaveBeenCalled();
    expect(inspectContainers).not.toHaveBeenCalled();
  });
});
