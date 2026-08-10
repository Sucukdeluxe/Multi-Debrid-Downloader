import { describe, expect, it } from "vitest";

describe("sliding selection scheduling", () => {
  it("applies the first mounted selection before scheduling later movements", async () => {
    const selectionModule = await import("../src/renderer/ui/SlidingSelection");
    const schedule = Reflect.get(selectionModule, "scheduleSelectionLayout");

    expect(schedule).toBeTypeOf("function");

    const events: string[] = [];
    const pending: { callback?: FrameRequestCallback } = {};
    const requestFrame = (callback: FrameRequestCallback): number => {
      events.push("request");
      pending.callback = callback;
      return 9;
    };
    const cancelFrame = (frame: number): void => {
      events.push(`cancel:${frame}`);
    };
    const apply = (): void => {
      events.push("apply");
    };
    const enableTransitions = (): void => {
      events.push("enable");
    };

    expect(schedule(false, 0, apply, requestFrame, cancelFrame, enableTransitions)).toBe(9);
    expect(events).toEqual(["apply", "request"]);

    pending.callback?.(0);
    expect(events).toEqual(["apply", "request", "enable"]);

    events.length = 0;
    expect(schedule(true, 4, apply, requestFrame, cancelFrame)).toBe(9);
    expect(events).toEqual(["cancel:4", "request"]);

    pending.callback?.(0);
    expect(events).toEqual(["cancel:4", "request", "apply"]);
  });
});
