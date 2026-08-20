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
    { afterLeft: 150, beforeLeft: 0, expectedDelta: -150, next: ["size", "name", "status"] },
    { afterLeft: 0, beforeLeft: 150, expectedDelta: 150, next: ["name", "size", "status"] }
  ])("commits the target grid before animating from a $expectedDelta px inverse offset", ({ afterLeft, beforeLeft, expectedDelta, next }) => {
    const commitDownloadColumnDrag = (columnDrag as unknown as {
      commitDownloadColumnDrag?: (session: DownloadColumnDragSession, order: string[], commit: (order: string[]) => void, prepare: () => void) => Animation[];
    }).commitDownloadColumnDrag;
    expect(commitDownloadColumnDrag).toBeTypeOf("function");
    if (!commitDownloadColumnDrag) return;

    const events: string[] = [];
    let committed = false;
    const outerAnimate = vi.fn(() => ({ finished: Promise.resolve() } as unknown as Animation));
    const animate = vi.fn(() => ({ finished: Promise.resolve() } as unknown as Animation));
    const motionTarget = { animate } as unknown as HTMLElement;
    const element = {
      animate: outerAnimate,
      children: [motionTarget],
      getBoundingClientRect: () => ({ left: committed ? afterLeft : beforeLeft, width: 300 })
    } as unknown as HTMLElement;
    const root = {
      classList: { add: () => events.push("add-class"), remove: () => events.push("clear-classes") },
      dataset: { columnDragging: "name" },
      querySelectorAll: (selector: string) => selector === "[data-download-column]" ? [element] : [],
      style: {
        removeProperty: (property: string) => events.push(`clear:${property}`)
      }
    } as unknown as HTMLElement;
    const session = {
      active: true,
      draggedId: "name",
      measurements: columns,
      pointerId: -1,
      preview: calculateColumnDragPreview(columns, "name", next[0] === "name" ? -160 : 160),
      root,
      startX: 0
    } as DownloadColumnDragSession;

    const animations = commitDownloadColumnDrag(session, next, (order) => {
      committed = true;
      events.push(`commit:${order.join("|")}`);
    }, () => events.push("prepare-grid"));

    expect(animations).toHaveLength(1);
    expect(events).toContain("prepare-grid");
    expect(events.indexOf("prepare-grid")).toBeLessThan(events.indexOf(`commit:${next.join("|")}`));
    expect(events).toContain(`commit:${next.join("|")}`);
    expect(outerAnimate).not.toHaveBeenCalled();
    expect(animate).toHaveBeenCalledWith([
      { transform: `translate3d(${expectedDelta}px, 0, 0)` },
      { transform: "translate3d(0, 0, 0)" }
    ], expect.objectContaining({ duration: 220 }));
  });

  it("commits immediately without WAAPI when application animations are disabled", () => {
    const animate = vi.fn(() => ({ finished: Promise.resolve() } as unknown as Animation));
    let committed = false;
    const element = {
      children: [{ animate }],
      getBoundingClientRect: () => ({ left: committed ? 150 : 0, width: 300 })
    } as unknown as HTMLElement;
    const root = {
      classList: { add: vi.fn(), remove: vi.fn() },
      dataset: {},
      querySelectorAll: (selector: string) => selector === "[data-download-column]" ? [element] : [],
      style: { removeProperty: vi.fn() }
    } as unknown as HTMLElement;
    const session = {
      active: true,
      draggedId: "name",
      measurements: columns,
      pointerId: -1,
      preview: calculateColumnDragPreview(columns, "name", 160),
      root,
      startX: 0
    } as DownloadColumnDragSession;

    const animations = columnDrag.commitDownloadColumnDrag(session, ["size", "name", "status"], () => {
      committed = true;
    }, () => {}, false);

    expect(committed).toBe(true);
    expect(animations).toEqual([]);
    expect(animate).not.toHaveBeenCalled();
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
