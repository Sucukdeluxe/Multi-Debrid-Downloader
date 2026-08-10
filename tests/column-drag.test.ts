import { describe, expect, it, vi } from "vitest";
import { calculateColumnDragPreview, updateDownloadColumnDrag, type DownloadColumnDragSession } from "../src/renderer/views/downloads/column-drag";

const columns = [
  { id: "name", left: 0, width: 300 },
  { id: "size", left: 300, width: 150 },
  { id: "status", left: 450, width: 100 }
];

describe("animated download column drag", () => {
  it("moves a narrow right column left while adjacent columns make room", () => {
    expect(calculateColumnDragPreview(columns, "status", -420)).toEqual({
      order: ["status", "name", "size"],
      offsets: { name: 100, size: 100, status: -420 },
      settleOffsets: { name: 100, size: 100, status: -450 }
    });
  });

  it("moves a wide left column right using the measured column widths", () => {
    expect(calculateColumnDragPreview(columns, "name", 500)).toEqual({
      order: ["size", "status", "name"],
      offsets: { name: 500, size: -300, status: -300 },
      settleOffsets: { name: 250, size: -300, status: -300 }
    });
  });

  it("keeps the original order while the dragged center has not crossed a neighbor", () => {
    expect(calculateColumnDragPreview(columns, "size", 20).order).toEqual(["name", "size", "status"]);
  });

  it("writes only the continuous active offset while the target slot stays unchanged", () => {
    const setProperty = vi.fn();
    const root = {
      classList: { add: vi.fn() },
      dataset: { columnDragging: "size" },
      querySelectorAll: vi.fn(() => []),
      style: { setProperty }
    } as unknown as HTMLElement;
    const session = {
      active: true,
      draggedId: "size",
      measurements: columns,
      pointerId: 1,
      preview: calculateColumnDragPreview(columns, "size", 20),
      root,
      startX: 0
    } as DownloadColumnDragSession;

    updateDownloadColumnDrag(session, 25);

    expect(setProperty).toHaveBeenCalledTimes(1);
    expect(setProperty).toHaveBeenCalledWith("--downloads-active-drag-x", "25px");
  });
});
