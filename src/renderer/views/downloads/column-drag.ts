export interface ColumnDragMeasurement {
  id: string;
  left: number;
  width: number;
}

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

export function beginDownloadColumnDrag(element: HTMLElement, draggedId: string, pointerId: number, clientX: number): DownloadColumnDragSession | null {
  const root = element.closest<HTMLElement>(".downloads-table");
  const header = element.closest<HTMLElement>(".downloads-table-header");
  if (!root || !header) return null;
  const measurements = Array.from(header.querySelectorAll<HTMLElement>(".downloads-column-header[data-download-column]")).map((column) => {
    const rect = column.getBoundingClientRect();
    return { id: column.dataset.downloadColumn ?? "", left: rect.left, width: rect.width };
  }).filter((column) => column.id && column.width > 0);
  if (!measurements.some((column) => column.id === draggedId)) return null;
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

export function settleDownloadColumnDrag(session: DownloadColumnDragSession, cancelled: boolean): string[] | null {
  if (!session.active) return null;
  const originalOrder = session.measurements.map((column) => column.id);
  const order = cancelled ? originalOrder : session.preview.order;
  const offsets = cancelled
    ? Object.fromEntries(originalOrder.map((id) => [id, 0]))
    : session.preview.settleOffsets;
  setColumnOffsets(session.root, offsets);
  session.root.style.removeProperty("--downloads-active-drag-x");
  setDraggedColumn(session.root, session.draggedId, false);
  session.root.classList.add("is-column-drag-settling");
  return order;
}

export function clearDownloadColumnDrag(session: DownloadColumnDragSession): void {
  session.root.classList.remove("is-column-drag-active", "is-column-drag-settling");
  session.root.style.removeProperty("--downloads-active-drag-x");
  session.measurements.forEach((measurement) => session.root.style.removeProperty(`--downloads-column-drag-${measurement.id}`));
  session.root.querySelectorAll<HTMLElement>("[data-column-dragging]").forEach((element) => delete element.dataset.columnDragging);
  delete session.root.dataset.columnDragging;
}
