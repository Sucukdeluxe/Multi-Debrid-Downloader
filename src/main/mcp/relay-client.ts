import type { McpCredentials, McpRelayCommand } from "../../shared/mcp";

async function boundedJson(response: Response): Promise<unknown> {
  if (!response.body) throw new Error("empty_response");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2_000_000) throw new Error("relay_poll_too_large");
      chunks.push(value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export interface RelayEndpoint {
  handle(command: McpRelayCommand, signal: AbortSignal): Promise<unknown>;
  closeSession(id: string): Promise<void>;
}

export class RelayAgent {
  private abort = new AbortController();
  private active = new Map<string, { abort: AbortController; sessionId: string }>();
  private seen = new Set<string>();
  private task: Promise<void> | null = null;
  private state: "online" | "offline" | "blocked" = "offline";
  constructor(private credentials: McpCredentials, private endpoint: RelayEndpoint, private status: (state: "online" | "offline" | "blocked", active: number) => void, private request: typeof fetch = fetch) {}
  start(): void { if (!this.task) this.task = this.loop(); }
  private publish(state = this.state): void { this.state = state; this.status(state, this.active.size); }
  async stop(): Promise<void> {
    this.abort.abort();
    for (const job of this.active.values()) job.abort.abort();
    await this.task;
  }
  private async wait(ms: number): Promise<void> {
    if (this.abort.signal.aborted) return;
    await new Promise<void>(resolve => {
      const done = () => { clearTimeout(timer); this.abort.signal.removeEventListener("abort", done); resolve(); };
      const timer = setTimeout(done, ms);
      this.abort.signal.addEventListener("abort", done, { once: true });
    });
  }
  private async loop(): Promise<void> {
    let failures = 0;
    while (!this.abort.signal.aborted) {
      try {
        const response = await this.request(`${this.credentials.relayUrl}/v1/agent/${this.credentials.installationId}/poll`, { headers: { Authorization: `Bearer ${this.credentials.agentToken}` }, redirect: "error", signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(30_000)]) });
        if (response.status === 401 || response.status === 403) { await response.body?.cancel(); this.publish("blocked"); return; }
        if (!response.ok) { await response.body?.cancel(); throw new Error("relay_poll_failed"); }
        const payload = await boundedJson(response) as { commands: McpRelayCommand[]; cancellations: string[]; closedSessions: string[] };
        if (!Array.isArray(payload.commands) || payload.commands.length > 32 || !Array.isArray(payload.cancellations) || !Array.isArray(payload.closedSessions)) throw new Error("invalid_relay_response");
        failures = 0;
        this.publish("online");
        for (const id of payload.cancellations) this.active.get(id)?.abort.abort();
        for (const id of payload.closedSessions) {
          for (const entry of this.active.values()) if (entry.sessionId === id) entry.abort.abort();
          await this.endpoint.closeSession(id);
        }
        for (const command of payload.commands) this.dispatch(command);
      } catch {
        if (this.abort.signal.aborted) break;
        this.publish("offline");
        await this.wait(Math.min(15_000, 500 * 2 ** Math.min(failures++, 5)));
      }
    }
  }
  private dispatch(command: McpRelayCommand): void {
    const uuid = /^[a-f0-9-]{36}$/;
    if (this.abort.signal.aborted || !command || typeof command.requestId !== "string" || !uuid.test(command.requestId) || typeof command.sessionId !== "string" || !uuid.test(command.sessionId) || !command.message || command.message.jsonrpc !== "2.0" || command.principal?.installationId !== this.credentials.installationId || command.principal.id !== `${this.credentials.installationId}:client` || command.principal.role !== "client" || !Number.isFinite(command.deadline) || command.deadline <= Date.now() || this.active.size >= 32 || this.seen.has(command.requestId)) return;
    this.seen.add(command.requestId);
    if (this.seen.size > 4096) this.seen.delete(this.seen.values().next().value!);
    const abort = new AbortController();
    const signal = AbortSignal.any([abort.signal, this.abort.signal, AbortSignal.timeout(Math.min(120_000, command.deadline - Date.now()))]);
    this.active.set(command.requestId, { abort, sessionId: command.sessionId });
    this.publish();
    void (async () => {
      let response: unknown = null;
      try { response = await this.endpoint.handle(command, signal); }
      catch { if (Object.hasOwn(command.message, "id")) response = { jsonrpc: "2.0", id: command.message.id, error: { code: -32000, message: "MCP request failed or was cancelled" } }; }
      try {
        if (this.abort.signal.aborted) return;
        const result = await this.request(`${this.credentials.relayUrl}/v1/agent/${this.credentials.installationId}/results`, { method: "POST", headers: { Authorization: `Bearer ${this.credentials.agentToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ requestId: command.requestId, response }), redirect: "error", signal: AbortSignal.any([this.abort.signal, AbortSignal.timeout(15_000)]) });
        await result.body?.cancel();
      } catch { }
      finally { this.active.delete(command.requestId); if (!this.abort.signal.aborted) this.publish(); }
    })();
  }
}
