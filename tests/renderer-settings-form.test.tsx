import { describe, expect, it, vi } from "vitest";
import type { RendererSettings, UiSnapshot } from "../src/shared/types";
import {
  buildDailyScheduleSettingsUpdate,
  persistDailyScheduleSettingsUpdate
} from "../src/renderer/App";

describe("daily schedule settings form", () => {
  it("maps local time and the chosen start day to the recurring schedule settings", () => {
    const now = new Date(2026, 7, 22, 18, 30, 0, 0);

    expect(buildDailyScheduleSettingsUpdate("08:15", "today", now)).toEqual({
      dailyStartEnabled: true,
      dailyStartMinuteOfDay: 8 * 60 + 15,
      dailyStartFirstLocalDate: "2026-08-22"
    });
    expect(buildDailyScheduleSettingsUpdate("23:45", "tomorrow", now)).toEqual({
      dailyStartEnabled: true,
      dailyStartMinuteOfDay: 23 * 60 + 45,
      dailyStartFirstLocalDate: "2026-08-23"
    });
  });

  it("applies persisted settings after a successful activation", async () => {
    const persisted = { dailyStartEnabled: true } as RendererSettings;
    const updateSettings = vi.fn().mockResolvedValue(persisted);
    const applySettings = vi.fn();
    const getSnapshot = vi.fn();
    const applySnapshot = vi.fn();
    const showError = vi.fn();
    const update = {
      dailyStartEnabled: true,
      dailyStartMinuteOfDay: 495,
      dailyStartFirstLocalDate: "2026-08-23"
    };

    await expect(persistDailyScheduleSettingsUpdate(update, "activate", {
      updateSettings,
      getSnapshot,
      applySettings,
      applySnapshot,
      showError
    })).resolves.toBe(true);

    expect(updateSettings).toHaveBeenCalledWith(update);
    expect(applySettings).toHaveBeenCalledWith(persisted);
    expect(getSnapshot).not.toHaveBeenCalled();
    expect(showError).not.toHaveBeenCalled();
  });

  it.each([
    ["activate" as const, "Zeitplan konnte nicht aktiviert werden: Error: Speichern fehlgeschlagen"],
    ["cancel" as const, "Zeitplan konnte nicht abgebrochen werden: Error: Speichern fehlgeschlagen"]
  ])("shows %s failures before reconciling the authoritative snapshot", async (operation, expectedMessage) => {
    const authoritative = { settings: { dailyStartEnabled: false } } as UiSnapshot;
    const sequence: string[] = [];
    const updateSettings = vi.fn().mockRejectedValue(new Error("Speichern fehlgeschlagen"));
    const getSnapshot = vi.fn(async () => {
      sequence.push("snapshot");
      return authoritative;
    });
    const applySnapshot = vi.fn((snapshot: UiSnapshot) => {
      sequence.push(`apply:${String(snapshot.settings.dailyStartEnabled)}`);
    });
    const showError = vi.fn((message: string) => {
      sequence.push(`error:${message}`);
    });

    await expect(persistDailyScheduleSettingsUpdate({ dailyStartEnabled: false }, operation, {
      updateSettings,
      getSnapshot,
      applySettings: vi.fn(),
      applySnapshot,
      showError
    })).resolves.toBe(false);

    expect(showError).toHaveBeenCalledWith(expectedMessage);
    expect(getSnapshot).toHaveBeenCalledTimes(1);
    expect(applySnapshot).toHaveBeenCalledWith(authoritative);
    expect(sequence).toEqual([`error:${expectedMessage}`, "snapshot", "apply:false"]);
  });
});
