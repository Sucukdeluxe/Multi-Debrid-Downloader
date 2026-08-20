import { describe, expect, it, vi } from "vitest";
import * as columnDrag from "../src/renderer/views/downloads/column-drag";
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

  it.each([
    { draggedId: "name", measurements: columns, next: ["size", "name", "status"] },
    {
      draggedId: "name",
      measurements: [
        { id: "size", left: 0, width: 150 },
        { id: "name", left: 150, width: 300 },
        { id: "status", left: 450, width: 100 }
      ],
      next: ["name", "size", "status"]
    }
  ])("clears transforms before committing a $draggedId grid move", ({ draggedId, measurements, next }) => {
    const commitDownloadColumnDrag = (columnDrag as unknown as {
      commitDownloadColumnDrag?: (session: DownloadColumnDragSession, order: string[], commit: (order: string[]) => void) => void;
    }).commitDownloadColumnDrag;
    expect(commitDownloadColumnDrag).toBeTypeOf("function");
    if (!commitDownloadColumnDrag) return;

    const events: string[] = [];
    const root = {
      classList: { remove: () => events.push("clear-classes") },
      dataset: { columnDragging: draggedId },
      querySelectorAll: () => [],
      style: {
        removeProperty: (property: string) => events.push(`clear:${property}`)
      }
    } as unknown as HTMLElement;
    const session = {
      active: true,
      draggedId,
      measurements,
      pointerId: -1,
      preview: calculateColumnDragPreview(measurements, draggedId, next[0] === draggedId ? -160 : 160),
      root,
      startX: 0
    } as DownloadColumnDragSession;

    commitDownloadColumnDrag(session, next, (order) => {
      events.push(`commit:${order.join("|")}`);
    });

    expect(events.at(-1)).toBe(`commit:${next.join("|")}`);
    expect(events.slice(0, -1)).toContain("clear:--downloads-column-drag-name");
    expect(events.slice(0, -1)).toContain("clear:--downloads-column-drag-size");
  });

  it("serializes and coalesces rapid persistence requests", async () => {
    const createDownloadColumnOrderPersistence = (columnDrag as unknown as {
      createDownloadColumnOrderPersistence?: (
        initial: string[],
        persist: (order: string[]) => Promise<string[]>,
        apply: (order: string[]) => void
      ) => { enqueue: (order: string[]) => void; whenIdle: () => Promise<void> };
    }).createDownloadColumnOrderPersistence;
    expect(createDownloadColumnOrderPersistence).toBeTypeOf("function");
    if (!createDownloadColumnOrderPersistence) return;

    const pending: Array<(order: string[]) => void> = [];
    const persisted: string[][] = [];
    const applied: string[][] = [];
    const coordinator = createDownloadColumnOrderPersistence(["name", "size"], (order) => {
      persisted.push(order);
      return new Promise((resolve) => pending.push(resolve));
    }, (order) => applied.push(order));

    coordinator.enqueue(["size", "name"]);
    coordinator.enqueue(["name", "size"]);
    coordinator.enqueue(["size", "name"]);
    expect(persisted).toEqual([["size", "name"]]);

    pending.shift()?.(["size", "name"]);
    await vi.waitFor(() => expect(persisted).toEqual([["size", "name"], ["size", "name"]]));
    pending.shift()?.(["size", "name"]);
    await coordinator.whenIdle();

    expect(applied.at(-1)).toEqual(["size", "name"]);
  });

  it("reasserts an authoritative import after an older request finishes", async () => {
    const createDownloadColumnOrderPersistence = (columnDrag as unknown as {
      createDownloadColumnOrderPersistence?: (
        initial: string[],
        persist: (order: string[]) => Promise<string[]>,
        apply: (order: string[]) => void
      ) => { applyAuthoritative: (order: string[]) => void; enqueue: (order: string[]) => void; whenIdle: () => Promise<void> };
    }).createDownloadColumnOrderPersistence;
    expect(createDownloadColumnOrderPersistence).toBeTypeOf("function");
    if (!createDownloadColumnOrderPersistence) return;

    const pending: Array<(order: string[]) => void> = [];
    const persisted: string[][] = [];
    const applied: string[][] = [];
    const coordinator = createDownloadColumnOrderPersistence(["name", "size"], (order) => {
      persisted.push(order);
      return new Promise((resolve) => pending.push(resolve));
    }, (order) => applied.push(order));

    coordinator.enqueue(["size", "name"]);
    coordinator.applyAuthoritative(["status", "name", "size"]);
    pending.shift()?.(["size", "name"]);
    await vi.waitFor(() => expect(persisted.at(-1)).toEqual(["status", "name", "size"]));
    pending.shift()?.(["status", "name", "size"]);
    await coordinator.whenIdle();

    expect(applied.at(-1)).toEqual(["status", "name", "size"]);
  });
});
