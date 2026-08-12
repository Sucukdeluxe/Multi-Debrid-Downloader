export const DOWNLOAD_PACKAGE_ROW_HEIGHT = 40;
export const DOWNLOAD_FILE_ROW_HEIGHT = 38;
export const DOWNLOAD_VIRTUAL_OVERSCAN_ROWS = 8;
export const DOWNLOAD_VIRTUAL_DEFAULT_VIEWPORT_HEIGHT = 720;

export interface DownloadVirtualRowInput {
  id: string;
  height: number;
}

export interface DownloadVirtualPositionedRow<T extends DownloadVirtualRowInput> {
  id: string;
  index: number;
  top: number;
  height: number;
  pinned: boolean;
  source: T;
}

export interface DownloadVirtualWindow<T extends DownloadVirtualRowInput> {
  rows: DownloadVirtualPositionedRow<T>[];
  totalHeight: number;
  startIndex: number;
  endIndex: number;
}

export interface DownloadVirtualWindowOptions {
  scrollTop: number;
  viewportHeight: number;
  overscan?: number;
  pinnedIds?: Iterable<string | null | undefined>;
}

function finiteDimension(value: number, fallback = 0): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function calculateDownloadVirtualWindow<T extends DownloadVirtualRowInput>(rows: readonly T[], options: DownloadVirtualWindowOptions): DownloadVirtualWindow<T> {
  if (rows.length === 0) return { rows: [], totalHeight: 0, startIndex: 0, endIndex: -1 };

  const overscan = Math.max(0, Math.floor(finiteDimension(options.overscan ?? DOWNLOAD_VIRTUAL_OVERSCAN_ROWS)));
  const scrollTop = finiteDimension(options.scrollTop);
  const viewportHeight = finiteDimension(options.viewportHeight, DOWNLOAD_VIRTUAL_DEFAULT_VIEWPORT_HEIGHT);
  const viewportBottom = scrollTop + viewportHeight;
  const pinnedIds = new Set(Array.from(options.pinnedIds ?? []).filter((id): id is string => Boolean(id)));
  const tops: number[] = [];
  let totalHeight = 0;
  let firstVisible = -1;
  let lastVisible = -1;

  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const height = finiteDimension(row.height);
    const top = totalHeight;
    const bottom = top + height;
    tops.push(top);
    totalHeight = bottom;
    if (firstVisible === -1 && bottom > scrollTop) firstVisible = index;
    if (top < viewportBottom) lastVisible = index;
  }

  if (firstVisible === -1) firstVisible = rows.length - 1;
  if (lastVisible < firstVisible) lastVisible = firstVisible;

  const startIndex = Math.max(0, firstVisible - overscan);
  const endIndex = Math.min(rows.length - 1, lastVisible + overscan);
  const selected = new Set<number>();
  for (let index = startIndex; index <= endIndex; index += 1) {
    selected.add(index);
  }
  for (let index = 0; index < rows.length; index += 1) {
    if (pinnedIds.has(rows[index].id)) selected.add(index);
  }

  const positioned = [...selected].sort((left, right) => left - right).map((index) => {
    const source = rows[index];
    return {
      id: source.id,
      index,
      top: tops[index],
      height: finiteDimension(source.height),
      pinned: pinnedIds.has(source.id),
      source
    };
  });

  return { rows: positioned, totalHeight, startIndex, endIndex };
}
