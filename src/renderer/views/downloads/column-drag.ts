export interface ColumnDragMeasurement {
  id: string;
  left: number;
  width: number;
}

export const DOWNLOAD_COLUMN_MOVE_DURATION_MS = 220;

export interface ColumnDragPreview {
  order: string[];
  offsets: Record<string, number>;
  settleOffsets: Record<string, number>;
}

export interface DownloadColumnDragSession {
  active: boolean;
  draggedId: string;
  measurements: ColumnDragMeasurement[];
  pointerId: number;
  preview: ColumnDragPreview;
  root: HTMLElement;
  startX: number;
}

export function calculateColumnDragPreview(columns: readonly ColumnDragMeasurement[], draggedId: string, deltaX: number): ColumnDragPreview {
  const dragged = columns.find((column) => column.id === draggedId);
  if (!dragged) {
    const order = columns.map((column) => column.id);
    const offsets = Object.fromEntries(order.map((id) => [id, 0]));
    return { order, offsets, settleOffsets: { ...offsets } };
  }

  const draggedCenter = dragged.left + dragged.width / 2 + deltaX;
  const remaining = columns.filter((column) => column.id !== draggedId);
  let targetIndex = remaining.findIndex((column) => draggedCenter < column.left + column.width / 2);
  if (targetIndex < 0) targetIndex = remaining.length;

  const order = remaining.map((column) => column.id);
  order.splice(targetIndex, 0, draggedId);

  const originalById = new Map(columns.map((column) => [column.id, column]));
  const targetLeftById = new Map<string, number>();
  let nextLeft = columns[0]?.left ?? 0;
  for (const id of order) {
    const column = originalById.get(id);
    if (!column) continue;
    targetLeftById.set(id, nextLeft);
    nextLeft += column.width;
  }

  const settleOffsets = Object.fromEntries(columns.map((column) => [column.id, (targetLeftById.get(column.id) ?? column.left) - column.left]));
  const offsets = { ...settleOffsets, [draggedId]: deltaX };
  return { order, offsets, settleOffsets };
}

function setColumnOffsets(root: HTMLElement, offsets: Record<string, number>, excludedId?: string): void {
  for (const [id, offset] of Object.entries(offsets)) {
    if (id === excludedId) continue;
    root.style.setProperty(`--downloads-column-drag-${id}`, `${offset}px`);
  }
}

function setDraggedColumn(root: HTMLElement, draggedId: string, dragging: boolean): void {
  if (dragging && root.dataset.columnDragging !== draggedId) {
    root.querySelectorAll<HTMLElement>("[data-column-dragging]").forEach((element) => delete element.dataset.columnDragging);
    root.querySelectorAll<HTMLElement>(`[data-download-column="${draggedId}"]`).forEach((element) => { element.dataset.columnDragging = "true"; });
    root.dataset.columnDragging = draggedId;
  } else if (!dragging && root.dataset.columnDragging) {
    root.querySelectorAll<HTMLElement>("[data-column-dragging]").forEach((element) => delete element.dataset.columnDragging);
    delete root.dataset.columnDragging;
  }
}

export function beginDownloadColumnDrag(element: HTMLElement, draggedId: string, pointerId: number, clientX: number, animationsEnabled = true): DownloadColumnDragSession | null {
  const root = element.closest<HTMLElement>(".downloads-table");
  const header = element.closest<HTMLElement>(".downloads-table-header");
  if (!root || !header) return null;
  const measurements = Array.from(header.querySelectorAll<HTMLElement>(".downloads-column-header[data-download-column]")).map((column) => {
    const rect = column.getBoundingClientRect();
    return { id: column.dataset.downloadColumn ?? "", left: rect.left, width: rect.width };
  }).filter((column) => column.id && column.width > 0);
  if (!measurements.some((column) => column.id === draggedId)) return null;
  root.classList.toggle("is-column-drag-motion-disabled", !animationsEnabled);
  return {
    active: false,
    draggedId,
    measurements,
    pointerId,
    preview: calculateColumnDragPreview(measurements, draggedId, 0),
    root,
    startX: clientX
  };
}

export function updateDownloadColumnDrag(session: DownloadColumnDragSession, clientX: number): boolean {
  const deltaX = clientX - session.startX;
  if (!session.active && Math.abs(deltaX) < 5) return false;
  if (!session.active) {
    session.active = true;
    session.root.classList.add("is-column-drag-active");
    setDraggedColumn(session.root, session.draggedId, true);
  }
  const nextPreview = calculateColumnDragPreview(session.measurements, session.draggedId, deltaX);
  session.root.style.setProperty("--downloads-active-drag-x", `${deltaX}px`);
  if (nextPreview.order.join("|") !== session.preview.order.join("|")) {
    setColumnOffsets(session.root, nextPreview.offsets, session.draggedId);
  }
  session.preview = nextPreview;
  return true;
}

export function clearDownloadColumnDrag(session: DownloadColumnDragSession): void {
  session.root.classList.remove("is-column-drag-active", "is-column-drag-motion-disabled", "is-column-drag-settling");
  session.root.style.removeProperty("--downloads-active-drag-x");
  session.measurements.forEach((measurement) => session.root.style.removeProperty(`--downloads-column-drag-${measurement.id}`));
  session.root.querySelectorAll<HTMLElement>("[data-column-dragging]").forEach((element) => delete element.dataset.columnDragging);
  delete session.root.dataset.columnDragging;
}

export function commitDownloadColumnDrag(
  session: DownloadColumnDragSession,
  order: string[],
  commit: (order: string[]) => void,
  prepare: () => void = () => {},
  animationsEnabled = true
): Animation[] {
  if (!animationsEnabled) {
    clearDownloadColumnDrag(session);
    prepare();
    commit(order);
    return [];
  }
  const originalOrder = session.measurements.map((measurement) => measurement.id);
  const movedIds = originalOrder.filter((id, index) => (
    order[index] !== id || Math.abs(session.preview.settleOffsets[id] ?? 0) >= 0.5
  ));
  const selector = movedIds.map((id) => `[data-download-column="${id}"]`).join(", ");
  const elements = selector ? Array.from(session.root.querySelectorAll<HTMLElement>(selector)) : [];
  const before = new Map(elements.map((element) => [element, element.getBoundingClientRect()]));
  clearDownloadColumnDrag(session);
  prepare();
  commit(order);
  session.root.classList.add("is-column-drag-settling");
  const animations: Animation[] = [];
  for (const element of elements) {
    const first = before.get(element);
    if (!first) continue;
    const last = element.getBoundingClientRect();
    const deltaX = first.left - last.left;
    if (Math.abs(deltaX) < 0.5) continue;
    for (const target of Array.from(element.children)) {
      if (target.matches(".downloads-column-move-controls")) continue;
      const animation = target.animate([
        { transform: `translate3d(${deltaX}px, 0, 0)` },
        { transform: "translate3d(0, 0, 0)" }
      ], {
        duration: DOWNLOAD_COLUMN_MOVE_DURATION_MS,
        easing: "cubic-bezier(0.22, 1, 0.36, 1)",
        fill: "both"
      });
      animation.finished.catch(() => {});
      animations.push(animation);
    }
  }
  return animations;
}

export interface DownloadColumnOrderPersistence {
  applyAuthoritative: (order: string[]) => void;
  enqueue: (order: string[]) => void;
  whenIdle: () => Promise<void>;
}

export function createDownloadColumnOrderPersistence(
  initialOrder: string[],
  persist: (order: string[]) => Promise<string[]>,
  apply: (order: string[]) => void
): DownloadColumnOrderPersistence {
  let confirmed = initialOrder;
  let queued: string[] | null = null;
  let active: Promise<void> | null = null;
  let epoch = 0;

  const drain = async (): Promise<void> => {
    while (queued) {
      const order = queued;
      queued = null;
      const requestEpoch = epoch;
      try {
        const persisted = await persist(order);
        if (requestEpoch !== epoch) continue;
        confirmed = persisted.length > 0 ? persisted : order;
        if (!queued) apply(confirmed);
      } catch {
        if (requestEpoch === epoch && !queued) apply(confirmed);
      }
    }
  };

  const start = (): void => {
    if (active) return;
    active = drain().finally(() => {
      active = null;
      if (queued) start();
    });
  };

  return {
    applyAuthoritative: (order) => {
      epoch += 1;
      confirmed = order;
      apply(order);
      queued = active ? order : null;
    },
    enqueue: (order) => {
      queued = order;
      start();
    },
    whenIdle: async () => {
      while (active) await active;
    }
  };
}
