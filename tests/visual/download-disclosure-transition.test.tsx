import { describe, expect, it } from "vitest";
import type { DownloadLogicalRow } from "../../src/renderer/views/downloads/downloads-model";
import {
  activateDownloadDisclosureTransition,
  prepareDownloadDisclosureTransition,
  stableDownloadDisclosureRows,
  type DownloadDisclosureRow
} from "../../src/renderer/views/downloads/download-disclosure-transition";
import {
  DOWNLOAD_FILE_ROW_HEIGHT,
  DOWNLOAD_PACKAGE_ROW_HEIGHT
} from "../../src/renderer/views/downloads/download-virtualizer";

type DisclosureFrameRow = {
  id: string;
  top: number;
  bottom: number;
  opacity: number;
};

function packageRow(id: string, collapsed: boolean, itemIds: readonly string[]): DownloadLogicalRow {
  return {
    type: "package",
    id,
    packageId: id,
    height: DOWNLOAD_PACKAGE_ROW_HEIGHT,
    packageRow: {
      id,
      collapsed,
      items: itemIds.map((itemId) => ({ id: itemId, packageId: id }))
    }
  } as unknown as DownloadLogicalRow;
}

function itemRow(id: string, packageId: string): DownloadLogicalRow {
  return {
    type: "item",
    id,
    packageId,
    height: DOWNLOAD_FILE_ROW_HEIGHT,
    item: { id, packageId }
  } as unknown as DownloadLogicalRow;
}

function logicalRows(firstCollapsed: boolean): DownloadLogicalRow[] {
  return [
    packageRow("package-a", firstCollapsed, ["a-1", "a-2"]),
    ...(firstCollapsed ? [] : [itemRow("a-1", "package-a"), itemRow("a-2", "package-a")]),
    packageRow("package-b", false, ["b-1"]),
    itemRow("b-1", "package-b")
  ];
}

function disclosureFrame(
  startRows: readonly DownloadDisclosureRow[],
  targetRows: readonly DownloadDisclosureRow[],
  progress: number
): DisclosureFrameRow[] {
  const targetById = new Map(targetRows.map((row) => [row.id, row]));
  let top = 0;
  return startRows.map((row) => {
    const target = targetById.get(row.id) ?? row;
    const height = row.height + (target.height - row.height) * progress;
    const opacity = row.disclosureOpacity + (target.disclosureOpacity - row.disclosureOpacity) * progress;
    const frameRow = { id: row.id, top, bottom: top + height, opacity };
    top += height;
    return frameRow;
  });
}

function prepareFrameRows(beforeCollapsed: boolean, afterCollapsed: boolean): {
  start: DownloadDisclosureRow[];
  target: DownloadDisclosureRow[];
} {
  const prepared = prepareDownloadDisclosureTransition(
    stableDownloadDisclosureRows(logicalRows(beforeCollapsed)),
    logicalRows(afterCollapsed)
  );
  expect(prepared.animated).toBe(true);
  return {
    start: prepared.rows,
    target: activateDownloadDisclosureTransition(prepared.rows)
  };
}

describe("download disclosure render contract", () => {
  it.each([
    { beforeCollapsed: true, afterCollapsed: false, startOpacity: 0, targetOpacity: 1 },
    { beforeCollapsed: false, afterCollapsed: true, startOpacity: 1, targetOpacity: 0 }
  ])("keeps the shared clipping group ahead of the following package in every measured frame", ({ beforeCollapsed, afterCollapsed, startOpacity, targetOpacity }) => {
    const { start, target } = prepareFrameRows(beforeCollapsed, afterCollapsed);
    const measuredFrames = [0, 0.2, 0.5, 0.8, 1].map((progress) => disclosureFrame(start, target, progress));

    for (const frame of measuredFrames) {
      const group = frame.find((row) => row.id === "package-a:items");
      const following = frame.find((row) => row.id === "package-b");
      expect(group).toBeDefined();
      expect(following).toBeDefined();
      expect(group!.bottom).toBeLessThanOrEqual(following!.top + 1);
    }

    const groupOpacities = measuredFrames.map((frame) => frame.find((row) => row.id === "package-a:items")!.opacity);
    expect(groupOpacities[0]).toBe(startOpacity);
    expect(groupOpacities.at(-1)).toBe(targetOpacity);
    expect(groupOpacities[2]).toBe((startOpacity + targetOpacity) / 2);
  });
});
