import { describe, expect, it, vi } from "vitest";
import { importDroppedDlcFiles, resolveDroppedDlcPaths } from "../src/renderer/collector-drop";

describe("collector DLC drop", () => {
  it("resolves DLC paths through the preload bridge instead of File.path", () => {
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

  it("ignores files whose native path cannot be resolved", () => {
    const file = { name: "broken.dlc" } as File;

    expect(resolveDroppedDlcPaths([file], () => "")).toEqual([]);
    expect(resolveDroppedDlcPaths([file], () => { throw new Error("unavailable"); })).toEqual([]);
  });

  it("imports dropped DLC files directly into Downloads without collector analysis", async () => {
    const file = { name: "package.dlc" } as File;
    const addContainers = vi.fn(async () => ({ addedPackages: 2, addedLinks: 16 }));

    await expect(importDroppedDlcFiles([file], () => "C:\\Drops\\package.dlc", addContainers)).resolves.toEqual({
      addedPackages: 2,
      addedLinks: 16
    });
    expect(addContainers).toHaveBeenCalledWith(["C:\\Drops\\package.dlc"]);
  });
});
