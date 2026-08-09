import { describe, expect, it } from "vitest";
import { updateDownloadSpeedHistory } from "../src/renderer/download-speed-state";

describe("download speed history", () => {
  it("keeps the smoothed display and history across successive updates", () => {
    const first = updateDownloadSpeedHistory({ history: [], display: 0 }, 100, 10);
    const second = updateDownloadSpeedHistory(first, 100, 10);

    expect(second.display).toBeGreaterThan(first.display);
    expect(second.history).toHaveLength(2);
    expect(second.history[0]).toBe(first.display);
  });

  it("keeps only the configured number of samples", () => {
    let state = { history: [] as number[], display: 0 };
    for (let index = 0; index < 5; index += 1) {
      state = updateDownloadSpeedHistory(state, index + 1, 3);
    }

    expect(state.history).toHaveLength(3);
  });
});
