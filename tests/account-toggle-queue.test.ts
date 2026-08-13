import { describe, expect, it } from "vitest";
import {
  SerialTaskQueue,
  setAccountTargetEnabled,
  type AccountToggleTarget
} from "../src/renderer/account-toggle-queue";

describe("account toggle queue", () => {
  it("keeps every rapid mutation and persists them in click order", async () => {
    const queue = new SerialTaskQueue();
    const calls: number[] = [];
    const first = queue.enqueue(async () => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      calls.push(1);
    });
    const second = queue.enqueue(async () => {
      calls.push(2);
    });
    const third = queue.enqueue(async () => {
      calls.push(3);
    });

    await Promise.all([first, second, third]);

    expect(calls).toEqual([1, 2, 3]);
  });

  it("continues after a failed mutation", async () => {
    const queue = new SerialTaskQueue();
    const calls: number[] = [];
    const failed = queue.enqueue(async () => {
      calls.push(1);
      throw new Error("failed");
    });
    const recovered = queue.enqueue(async () => {
      calls.push(2);
    });

    await expect(failed).rejects.toThrow("failed");
    await recovered;

    expect(calls).toEqual([1, 2]);
  });

  it("combines rapid Mega-Debrid Web activations without losing earlier clicks", () => {
    const accountIds = ["web-1", "web-2", "web-3"];
    let settings = {
      disabledProviders: [],
      debridLinkDisabledKeyIds: [],
      megaDebridApiDisabledAccountIds: [],
      megaDebridWebDisabledAccountIds: [...accountIds],
      megaDebridDisabledAccountIds: [...accountIds]
    };

    for (const accountId of accountIds) {
      const target: AccountToggleTarget = { kind: "mega-web", accountId };
      settings = setAccountTargetEnabled(settings, target, true);
    }

    expect(settings.megaDebridWebDisabledAccountIds).toEqual([]);
    expect(settings.megaDebridDisabledAccountIds).toEqual([]);
  });
});
