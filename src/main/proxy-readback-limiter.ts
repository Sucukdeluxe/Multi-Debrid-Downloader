interface Waiter {
  signal: AbortSignal;
  abort: () => void;
  resolve: (release: () => void) => void;
  reject: (error: Error) => void;
}

export class ProxyReadbackLimiter {
  private active = 0;
  private readonly waiting: Waiter[] = [];

  public constructor(private readonly limit: number) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("invalid_readback_limit");
  }

  public snapshot() {
    return { limit: this.limit, active: this.active, waiting: this.waiting.length };
  }

  public acquire(signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) return Promise.reject(new Error("aborted:proxy_download"));
    if (this.active < this.limit) {
      this.active++;
      return Promise.resolve(this.createRelease());
    }
    return new Promise((resolve, reject) => {
      const waiter: Waiter = {
        signal, resolve, reject,
        abort: () => {
          const index = this.waiting.indexOf(waiter);
          if (index < 0) return;
          this.waiting.splice(index, 1);
          signal.removeEventListener("abort", waiter.abort);
          reject(new Error("aborted:proxy_download"));
        }
      };
      this.waiting.push(waiter);
      signal.addEventListener("abort", waiter.abort, { once: true });
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.active--;
      while (this.waiting.length && this.active < this.limit) {
        const waiter = this.waiting.shift()!;
        waiter.signal.removeEventListener("abort", waiter.abort);
        if (waiter.signal.aborted) {
          waiter.reject(new Error("aborted:proxy_download"));
          continue;
        }
        this.active++;
        waiter.resolve(this.createRelease());
      }
    };
  }
}
