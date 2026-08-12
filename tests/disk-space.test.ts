import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  DiskReservationCoordinator,
  calculateExtractionReservationBytes,
  calculateRemainingReservationBytes
} from "../src/main/disk-space";

describe("disk reservation coordinator", () => {
  it("reserves only the remaining known bytes and keeps the configured safety margin free", async () => {
    const coordinator = new DiskReservationCoordinator({
      safetyBytes: 100,
      now: () => 10,
      statVolume: async (targetPath) => ({
        path: targetPath,
        volumeKey: "volume-a",
        freeBytes: 1_000,
        totalBytes: 2_000
      })
    });

    const first = await coordinator.reserve({
      phase: "download",
      ownerId: "item-a",
      targetPath: path.join("C:\\", "downloads", "a.bin"),
      requiredBytes: 800,
      alreadyPresentBytes: 300
    });

    expect(first.reservedBytes).toBe(500);
    await expect(coordinator.reserve({
      phase: "download",
      ownerId: "item-b",
      targetPath: path.join("C:\\", "downloads", "b.bin"),
      requiredBytes: 450,
      alreadyPresentBytes: 0
    })).rejects.toMatchObject({
      event: expect.objectContaining({
        phase: "download",
        ownerId: "item-b",
        volumeKey: "volume-a",
        requiredBytes: 450,
        availableBytes: 400,
        deficitBytes: 50,
        safetyBytes: 100,
        retryAt: 30_010
      })
    });
  });

  it("lets unknown sizes pass without consuming volume capacity", async () => {
    const coordinator = new DiskReservationCoordinator({
      safetyBytes: 100,
      statVolume: async () => {
        throw new Error("capacity lookup should not run for unknown sizes");
      }
    });

    const lease = await coordinator.reserve({
      phase: "download",
      ownerId: "unknown-item",
      targetPath: path.join("D:\\", "downloads", "unknown.bin"),
      requiredBytes: null,
      alreadyPresentBytes: 0
    });

    expect(lease.reservedBytes).toBe(0);
    expect(coordinator.getReservedBytesByVolume().size).toBe(0);
  });

  it("updates and releases lease pressure on the owning volume", async () => {
    const coordinator = new DiskReservationCoordinator({
      safetyBytes: 100,
      statVolume: async (targetPath) => ({
        path: targetPath,
        volumeKey: "volume-b",
        freeBytes: 1_200,
        totalBytes: 2_000
      })
    });

    const lease = await coordinator.reserve({
      phase: "download",
      ownerId: "item-c",
      targetPath: path.join("E:\\", "downloads", "c.bin"),
      requiredBytes: 900,
      alreadyPresentBytes: 100
    });

    await lease.update({ requiredBytes: 600, alreadyPresentBytes: 400 });
    expect(lease.reservedBytes).toBe(200);
    expect(coordinator.getReservedBytesByVolume().get("volume-b")).toBe(200);

    lease.release();

    expect(lease.released).toBe(true);
    expect(coordinator.getReservedBytesByVolume().get("volume-b")).toBe(0);
  });

  it("serializes parallel reservations so one volume cannot be overbooked", async () => {
    const coordinator = new DiskReservationCoordinator({
      safetyBytes: 100,
      statVolume: async (targetPath) => ({
        path: targetPath,
        volumeKey: "volume-c",
        freeBytes: 1_000,
        totalBytes: 2_000
      })
    });

    const results = await Promise.allSettled([
      coordinator.reserve({
        phase: "download",
        ownerId: "item-d",
        targetPath: path.join("F:\\", "downloads", "d.bin"),
        requiredBytes: 600,
        alreadyPresentBytes: 0
      }),
      coordinator.reserve({
        phase: "download",
        ownerId: "item-e",
        targetPath: path.join("F:\\", "downloads", "e.bin"),
        requiredBytes: 600,
        alreadyPresentBytes: 0
      })
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
    expect(coordinator.getReservedBytesByVolume().get("volume-c")).toBe(600);
  });

  it("calculates conservative download and extraction reservation sizes", () => {
    expect(calculateRemainingReservationBytes(1_000, 250)).toBe(750);
    expect(calculateRemainingReservationBytes(1_000, 1_500)).toBe(0);
    expect(calculateRemainingReservationBytes(null, 250)).toBeNull();
    expect(calculateExtractionReservationBytes([500, null, 200, 0])).toBe(700);
    expect(calculateExtractionReservationBytes([null, 0])).toBeNull();
  });
});
