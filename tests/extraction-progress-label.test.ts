import { describe, expect, it } from "vitest";
import * as downloadManagerModule from "../src/main/download-manager";

describe("extraction progress labels", () => {
  it("keeps a finalizing archive at its real 99 percent instead of counting it as complete", () => {
    const format = (downloadManagerModule as Record<string, unknown>).formatExtractionProgressLabels as ((progress: Record<string, unknown>) => {
      itemLabel: string;
      packageLabel: string;
    }) | undefined;
    expect(format).toBeTypeOf("function");
    if (!format) return;

    expect(format({
      current: 0,
      total: 1,
      percent: 99,
      archiveName: "release.part01.rar",
      archivePercent: 99,
      elapsedMs: 17_000
    })).toEqual({
      itemLabel: "Finalisieren - 99% · release.part01.rar · 17s",
      packageLabel: "Finalisieren - 99% (0/1) · release.part01.rar · 17s"
    });
  });

  it("keeps password attempts more important than a stale 99 percent archive value", () => {
    const format = (downloadManagerModule as Record<string, unknown>).formatExtractionProgressLabels as ((progress: Record<string, unknown>) => {
      itemLabel: string;
      packageLabel: string;
    }) | undefined;
    expect(format).toBeTypeOf("function");
    if (!format) return;

    expect(format({
      current: 0,
      total: 1,
      percent: 99,
      archiveName: "release.part01.rar",
      archivePercent: 99,
      passwordAttempt: 7,
      passwordTotal: 7
    })).toEqual({
      itemLabel: "Passwort knacken: 100% (7/7) · release.part01.rar",
      packageLabel: "Passwort knacken: 100% (7/7)"
    });
  });
});
