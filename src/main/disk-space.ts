import fs from "node:fs";
import path from "node:path";

export type DiskReservationPhase = "download" | "extract" | "remux";

export type DiskVolumeStats = {
  path: string;
  volumeKey: string;
  freeBytes: number;
  totalBytes: number;
};

export type DiskReservationRequest = {
  phase: DiskReservationPhase;
  ownerId: string;
  targetPath: string;
  requiredBytes: number | null;
  alreadyPresentBytes?: number;
  signal?: AbortSignal;
};

export type DiskWaitEvent = {
  phase: DiskReservationPhase;
  ownerId: string;
  volumeKey: string;
  requiredBytes: number;
  availableBytes: number;
  deficitBytes: number;
  safetyBytes: number;
  retryAt: number;
};

export class DiskCapacityError extends Error {
  public readonly event: DiskWaitEvent;

  public constructor(event: DiskWaitEvent) {
    super("Insufficient disk capacity");
    this.name = "DiskCapacityError";
    this.event = event;
  }
}

type DiskReservationCoordinatorOptions = {
  safetyBytes?: number;
  retryDelayMs?: number;
  now?: () => number;
  statVolume?: (targetPath: string) => Promise<DiskVolumeStats>;
};

type DiskReservationUpdate = Pick<DiskReservationRequest, "requiredBytes" | "alreadyPresentBytes" | "signal">;

export type DiskReservationLease = {
  readonly volumeKey: string | null;
  readonly released: boolean;
  readonly reservedBytes: number;
  update(update: DiskReservationUpdate): Promise<void>;
  release(): void;
};

export function calculateRemainingReservationBytes(requiredBytes: number | null, alreadyPresentBytes = 0): number | null {
  if (!Number.isFinite(requiredBytes) || requiredBytes === null || requiredBytes < 0) return null;
  return Math.max(0, Math.floor(requiredBytes) - Math.max(0, Math.floor(alreadyPresentBytes)));
}

export function calculateExtractionReservationBytes(archiveBytes: Array<number | null | undefined>): number | null {
  const known = archiveBytes.filter((value): value is number => typeof value === "number" && Number.isFinite(value) && value > 0);
  if (known.length === 0) return null;
  return known.reduce((total, value) => total + Math.floor(value), 0);
}

async function defaultStatVolume(targetPath: string): Promise<DiskVolumeStats> {
  let candidate = path.resolve(targetPath);
  while (true) {
    try {
      const stat = await fs.promises.stat(candidate);
      const directory = stat.isDirectory() ? candidate : path.dirname(candidate);
      const info = await fs.promises.statfs(directory);
      const freeBytes = Number(info.bavail) * Number(info.bsize);
      const totalBytes = Number(info.blocks) * Number(info.bsize);
      return { path: directory, volumeKey: path.parse(directory).root.toLowerCase(), freeBytes, totalBytes };
    } catch {
      const parent = path.dirname(candidate);
      if (parent === candidate) throw new Error(`Unable to resolve disk volume for ${targetPath}`);
      candidate = parent;
    }
  }
}

function waitForDiskOperation<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation;
  if (signal.aborted) {
    void operation.catch(() => {});
    return Promise.reject(new Error("aborted:disk-reservation"));
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(new Error("aborted:disk-reservation"));
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

export class DiskReservationCoordinator {
  private readonly safetyBytes: number;
  private readonly retryDelayMs: number;
  private readonly now: () => number;
  private readonly statVolume: (targetPath: string) => Promise<DiskVolumeStats>;
  private readonly reservedByVolume = new Map<string, number>();
  private readonly leases = new Map<string, { volumeKey: string; reservedBytes: number; targetPath: string }>();
  private queue = Promise.resolve();

  public constructor(options: DiskReservationCoordinatorOptions = {}) {
    this.safetyBytes = Math.max(0, Math.floor(options.safetyBytes ?? 256 * 1024 * 1024));
    this.retryDelayMs = Math.max(1000, Math.floor(options.retryDelayMs ?? 30000));
    this.now = options.now ?? Date.now;
    this.statVolume = options.statVolume ?? defaultStatVolume;
  }

  public async reserve(request: DiskReservationRequest): Promise<DiskReservationLease> {
    return this.enqueue(async () => {
      const requiredBytes = calculateRemainingReservationBytes(request.requiredBytes, request.alreadyPresentBytes ?? 0);
      if (requiredBytes === null) return this.createLease(request.ownerId, request.targetPath, null, 0);
      const volume = await waitForDiskOperation(this.statVolume(request.targetPath), request.signal);
      const reserved = this.reservedByVolume.get(volume.volumeKey) ?? 0;
      const availableBytes = Math.max(0, Math.floor(volume.freeBytes) - reserved - this.safetyBytes);
      if (requiredBytes > availableBytes) {
        throw new DiskCapacityError({
          phase: request.phase,
          ownerId: request.ownerId,
          volumeKey: volume.volumeKey,
          requiredBytes,
          availableBytes,
          deficitBytes: requiredBytes - availableBytes,
          safetyBytes: this.safetyBytes,
          retryAt: this.now() + this.retryDelayMs
        });
      }
      return this.createLease(request.ownerId, request.targetPath, volume.volumeKey, requiredBytes);
    });
  }

  public getReservedBytesByVolume(): ReadonlyMap<string, number> {
    return new Map(this.reservedByVolume);
  }

  private createLease(ownerId: string, targetPath: string, volumeKey: string | null, reservedBytes: number): DiskReservationLease {
    const leaseId = `${ownerId}:${Math.random().toString(16).slice(2)}`;
    const coordinator = this;
    if (volumeKey) {
      this.leases.set(leaseId, { volumeKey, reservedBytes, targetPath });
      this.reservedByVolume.set(volumeKey, (this.reservedByVolume.get(volumeKey) ?? 0) + reservedBytes);
    }
    let released = false;
    return {
      get volumeKey() { return volumeKey; },
      get released() { return released; },
      get reservedBytes() { return coordinator.leases.get(leaseId)?.reservedBytes ?? 0; },
      update: async (update) => {
        await coordinator.enqueue(async () => {
          if (released || !volumeKey) return;
          const lease = coordinator.leases.get(leaseId);
          if (!lease) return;
          const nextBytes = calculateRemainingReservationBytes(update.requiredBytes, update.alreadyPresentBytes ?? 0);
          if (nextBytes === null) return;
          const delta = nextBytes - lease.reservedBytes;
          if (delta > 0) {
            const volume = await waitForDiskOperation(coordinator.statVolume(lease.targetPath), update.signal);
            const available = Math.max(0, Math.floor(volume.freeBytes) - (coordinator.reservedByVolume.get(volumeKey) ?? 0) - coordinator.safetyBytes);
            if (delta > available) throw new DiskCapacityError({ phase: "download", ownerId, volumeKey, requiredBytes: nextBytes, availableBytes: available, deficitBytes: delta - available, safetyBytes: coordinator.safetyBytes, retryAt: coordinator.now() + coordinator.retryDelayMs });
          }
          lease.reservedBytes = nextBytes;
          coordinator.reservedByVolume.set(volumeKey, Math.max(0, (coordinator.reservedByVolume.get(volumeKey) ?? 0) + delta));
        });
      },
      release: () => {
        if (released) return;
        released = true;
        const lease = coordinator.leases.get(leaseId);
        coordinator.leases.delete(leaseId);
        if (!lease) return;
        const next = Math.max(0, (coordinator.reservedByVolume.get(lease.volumeKey) ?? 0) - lease.reservedBytes);
        coordinator.reservedByVolume.set(lease.volumeKey, next);
      }
    };
  }

  private async enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queue.then(operation, operation);
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }
}
