type Waiter = { grant(): void; signal?: AbortSignal; abort(): void };

export class ExtractionLimiter {
  constructor(private readonly abortMessage = "aborted:extract", private readonly ceiling = 8) {}
  private active = 0;
  private limit = 1;
  private waiters: Waiter[] = [];

  snapshot() {
    return { active: this.active, waiting: this.waiters.length, limit: this.limit };
  }

  updateLimit(limit: number): void {
    this.limit = Math.max(1, Math.min(this.ceiling, Math.floor(limit) || 1));
    this.drain();
  }

  acquire(limit: number, signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) return Promise.reject(new Error(this.abortMessage));
    this.limit = Math.max(1, Math.min(this.ceiling, Math.floor(limit) || 1));
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        signal,
        abort: () => {
          this.waiters = this.waiters.filter(entry => entry !== waiter);
          reject(new Error(this.abortMessage));
          this.drain();
        },
        grant: () => {
          this.active++;
          let released = false;
          resolve(() => {
            if (released) return;
            released = true;
            this.active--;
            this.drain();
          });
        }
      };
      signal?.addEventListener("abort", waiter.abort, { once: true });
      this.waiters.push(waiter);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.limit && this.waiters.length) {
      const waiter = this.waiters.shift()!;
      waiter.signal?.removeEventListener("abort", waiter.abort);
      waiter.grant();
    }
  }
}

export const extractionLimiter = new ExtractionLimiter();
