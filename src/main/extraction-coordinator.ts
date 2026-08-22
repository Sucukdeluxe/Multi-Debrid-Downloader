export type ExtractionOperationContext = Readonly<{
  operationId: string;
  packageId: string;
  generation: number;
  runOwnerId: string;
}>;

export type ExtractionArchiveMember = Readonly<{
  path: string;
  size: number | null;
}>;

export type ExtractionLeaseRequest = Readonly<{
  phase: "extract";
  ownerId: string;
  targetPath: string;
  requiredBytes: number | null;
  memberPaths: readonly string[];
}>;

export type ExtractionDiskLease = {
  readonly released?: boolean;
  release(): void;
};

export type BeginExtractionOperationOptions = {
  context: ExtractionOperationContext;
  targetPath?: string;
  members?: readonly ExtractionArchiveMember[];
  acquireLease?: (request: ExtractionLeaseRequest) => Promise<ExtractionDiskLease>;
};

export type ExtractionOperation = {
  readonly context: ExtractionOperationContext;
  finalize(finalizeScope?: () => void | Promise<void>): Promise<void>;
};

type ArchiveJob = {
  archiveId: string;
  execute: (signal: AbortSignal) => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason?: unknown) => void;
};

type OperationState = {
  handle: ExtractionOperation;
  context: ExtractionOperationContext;
  queued: ArchiveJob[];
  active: Set<Promise<void>>;
  controllers: Set<AbortController>;
  drain: Deferred<void>;
  drained: boolean;
  lease: ExtractionDiskLease | null;
  leaseReleased: boolean;
  cancelReason: string | null;
  closing: boolean;
  finalizePromise: Promise<void> | null;
};

type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
};

function deferred<T>(): Deferred<T> {
  let resolve!: Deferred<T>["resolve"];
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function normalizedLimit(value: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(1, Math.floor(parsed)) : 1;
}

function memberKey(memberPath: string): string {
  return String(memberPath || "").replace(/\//g, "\\").toLocaleLowerCase("en-US");
}

function deduplicateMembers(members: readonly ExtractionArchiveMember[]): ExtractionArchiveMember[] {
  const unique = new Map<string, ExtractionArchiveMember>();
  for (const member of members) {
    const key = memberKey(member.path);
    if (!key || unique.has(key)) {
      continue;
    }
    unique.set(key, Object.freeze({
      path: member.path,
      size: typeof member.size === "number" && Number.isFinite(member.size)
        ? Math.max(0, Math.floor(member.size))
        : null
    }));
  }
  return [...unique.values()];
}

function reservationBytes(members: readonly ExtractionArchiveMember[]): number | null {
  const known = members
    .map((member) => member.size)
    .filter((size): size is number => typeof size === "number" && Number.isFinite(size));
  return known.length > 0 ? known.reduce((total, size) => total + Math.max(0, Math.floor(size)), 0) : null;
}

export class ExtractionCancelledError extends Error {
  public constructor(reason: string) {
    super(`Extraction cancelled: ${reason}`);
    this.name = "ExtractionCancelledError";
  }
}

export class ExtractionCoordinator {
  private limit: number;
  private activeCount = 0;
  private closed = false;
  private lastServedOperationId: string | null = null;
  private readonly operations = new Map<string, OperationState>();
  private readonly readyOperationIds: string[] = [];
  private readonly readyOperationSet = new Set<string>();

  public constructor(limit: number) {
    this.limit = normalizedLimit(limit);
  }

  public async beginOperation(options: BeginExtractionOperationOptions): Promise<ExtractionOperation> {
    if (this.closed) {
      throw new ExtractionCancelledError("shutdown");
    }
    const context = Object.freeze({
      operationId: String(options.context.operationId),
      packageId: String(options.context.packageId),
      generation: Math.max(0, Math.floor(Number(options.context.generation) || 0)),
      runOwnerId: String(options.context.runOwnerId)
    });
    if (!context.operationId || !context.packageId || this.operations.has(context.operationId)) {
      throw new Error(`Invalid extraction operation: ${context.operationId}`);
    }
    const state = {} as OperationState;
    const handle: ExtractionOperation = Object.freeze({
      context,
      finalize: (finalizeScope?: () => void | Promise<void>) => this.finalizeOperation(state, finalizeScope)
    });
    Object.assign(state, {
      handle,
      context,
      queued: [],
      active: new Set<Promise<void>>(),
      controllers: new Set<AbortController>(),
      drain: deferred<void>(),
      drained: false,
      lease: null,
      leaseReleased: false,
      cancelReason: null,
      closing: false,
      finalizePromise: null
    });
    this.operations.set(context.operationId, state);

    try {
      if (options.acquireLease) {
        const members = deduplicateMembers(options.members || []);
        state.lease = await options.acquireLease({
          phase: "extract",
          ownerId: context.operationId,
          targetPath: String(options.targetPath || ""),
          requiredBytes: reservationBytes(members),
          memberPaths: Object.freeze(members.map((member) => member.path))
        });
      }
      if (this.closed || state.cancelReason) {
        this.releaseLease(state);
        this.operations.delete(context.operationId);
        throw new ExtractionCancelledError(state.cancelReason || "shutdown");
      }
      return handle;
    } catch (error) {
      if (this.operations.get(context.operationId) === state) {
        this.operations.delete(context.operationId);
      }
      throw error;
    }
  }

  public scheduleArchive<T>(
    operation: ExtractionOperation,
    archiveId: string,
    execute: (signal: AbortSignal) => Promise<T>
  ): Promise<T> {
    const state = this.operations.get(operation.context.operationId);
    if (!state || state.handle !== operation || state.closing || state.cancelReason || this.closed) {
      return Promise.reject(new ExtractionCancelledError(state?.cancelReason || (this.closed ? "shutdown" : "operation_closed")));
    }
    if (state.drained) {
      state.drain = deferred<void>();
      state.drained = false;
    }
    const promise = new Promise<T>((resolve, reject) => {
      state.queued.push({ archiveId, execute, resolve: (value) => resolve(value as T), reject });
    });
    this.markReady(state);
    this.pump();
    return promise;
  }

  public resize(limit: number): void {
    this.limit = normalizedLimit(limit);
    this.pump();
  }

  public async cancelRun(runOwnerId: string, reason = "run_cancelled"): Promise<void> {
    await this.cancelMatching((state) => state.context.runOwnerId === runOwnerId, reason);
  }

  public async cancelPackage(packageId: string, reason = "package_cancelled"): Promise<void> {
    await this.cancelMatching((state) => state.context.packageId === packageId, reason);
  }

  public async shutdownAndDrain(deadlineAt: number): Promise<void> {
    this.closed = true;
    const states = [...this.operations.values()];
    for (const state of states) {
      this.cancelQueued(state, "shutdown");
      state.cancelReason ||= "shutdown";
    }
    await Promise.resolve();
    for (const state of states) {
      for (const controller of state.controllers) {
        if (!controller.signal.aborted) {
          controller.abort("shutdown");
        }
      }
      this.resolveDrainIfIdle(state);
    }
    await this.waitUntilDeadline(Promise.all(states.map((state) => state.drain.promise)), deadlineAt);
    const finalizers = states.map((state) => state.finalizePromise).filter((value): value is Promise<void> => Boolean(value));
    if (finalizers.length > 0) {
      await this.waitUntilDeadline(Promise.allSettled(finalizers), deadlineAt);
    }
    for (const state of states) {
      this.releaseLease(state);
    }
  }

  private async finalizeOperation(state: OperationState, finalizeScope?: () => void | Promise<void>): Promise<void> {
    if (state.finalizePromise) {
      return state.finalizePromise;
    }
    state.closing = true;
    this.resolveDrainIfIdle(state);
    state.finalizePromise = (async () => {
      try {
        await state.drain.promise;
        await finalizeScope?.();
      } finally {
        this.releaseLease(state);
        if (this.operations.get(state.context.operationId) === state) {
          this.operations.delete(state.context.operationId);
        }
        this.removeReady(state.context.operationId);
      }
    })();
    return state.finalizePromise;
  }

  private async cancelMatching(predicate: (state: OperationState) => boolean, reason: string): Promise<void> {
    const matches = [...this.operations.values()].filter(predicate);
    for (const state of matches) {
      state.cancelReason ||= reason;
      this.cancelQueued(state, reason);
      for (const controller of state.controllers) {
        if (!controller.signal.aborted) {
          controller.abort(reason);
        }
      }
      this.resolveDrainIfIdle(state);
    }
    await Promise.all(matches.map((state) => state.drain.promise));
  }

  private cancelQueued(state: OperationState, reason: string): void {
    const error = new ExtractionCancelledError(reason);
    for (const job of state.queued.splice(0)) {
      job.reject(error);
    }
    this.removeReady(state.context.operationId);
  }

  private markReady(state: OperationState): void {
    const operationId = state.context.operationId;
    if (state.queued.length === 0 || this.readyOperationSet.has(operationId)) {
      return;
    }
    this.readyOperationSet.add(operationId);
    this.readyOperationIds.push(operationId);
  }

  private removeReady(operationId: string): void {
    if (!this.readyOperationSet.delete(operationId)) {
      return;
    }
    let index = this.readyOperationIds.indexOf(operationId);
    while (index >= 0) {
      this.readyOperationIds.splice(index, 1);
      index = this.readyOperationIds.indexOf(operationId);
    }
  }

  private takeNextState(): OperationState | null {
    if (this.readyOperationIds.length === 0) {
      return null;
    }
    let selectedIndex = 0;
    if (this.lastServedOperationId) {
      const differentIndex = this.readyOperationIds.findIndex((operationId) => operationId !== this.lastServedOperationId);
      if (differentIndex >= 0) {
        selectedIndex = differentIndex;
      }
    }
    const [operationId] = this.readyOperationIds.splice(selectedIndex, 1);
    this.readyOperationSet.delete(operationId);
    const state = this.operations.get(operationId);
    if (!state || state.queued.length === 0 || state.cancelReason) {
      return this.takeNextState();
    }
    this.lastServedOperationId = operationId;
    return state;
  }

  private pump(): void {
    if (this.closed) {
      return;
    }
    while (this.activeCount < this.limit) {
      const state = this.takeNextState();
      if (!state) {
        return;
      }
      const job = state.queued.shift();
      if (!job) {
        this.resolveDrainIfIdle(state);
        continue;
      }
      if (state.queued.length > 0) {
        this.markReady(state);
      }
      this.startJob(state, job);
    }
  }

  private startJob(state: OperationState, job: ArchiveJob): void {
    const controller = new AbortController();
    state.controllers.add(controller);
    this.activeCount += 1;
    let released = false;
    const releasePermit = (): void => {
      if (released) {
        return;
      }
      released = true;
      this.activeCount = Math.max(0, this.activeCount - 1);
    };
    const active = Promise.resolve()
      .then(() => job.execute(controller.signal))
      .then(job.resolve, job.reject)
      .finally(() => {
        releasePermit();
        state.controllers.delete(controller);
        state.active.delete(active);
        this.resolveDrainIfIdle(state);
        this.pump();
      });
    state.active.add(active);
  }

  private resolveDrainIfIdle(state: OperationState): void {
    if (!state.drained && state.queued.length === 0 && state.active.size === 0) {
      state.drained = true;
      state.drain.resolve();
    }
  }

  private releaseLease(state: OperationState): void {
    if (state.leaseReleased) {
      return;
    }
    state.leaseReleased = true;
    state.lease?.release();
  }

  private async waitUntilDeadline<T>(task: Promise<T>, deadlineAt: number): Promise<void> {
    const remainingMs = Math.max(0, deadlineAt - Date.now());
    if (remainingMs <= 0) {
      return;
    }
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const elapsed = new Promise<void>((resolve) => {
      timeout = setTimeout(resolve, remainingMs);
    });
    await Promise.race([task.then(() => undefined, () => undefined), elapsed]);
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}
