import { describe, expect, it } from "vitest";
import * as extractorModule from "../src/main/extractor";

describe("extractor password progress", () => {
  it("retains the active password attempt across pulse and percentage updates", () => {
    const merge = (extractorModule as Record<string, unknown>).mergeExtractPasswordProgress as ((
      current: Record<string, unknown> | undefined,
      update: Record<string, unknown> | undefined
    ) => Record<string, unknown> | undefined) | undefined;
    expect(merge).toBeTypeOf("function");
    if (!merge) return;

    const secondAttempt = { passwordAttempt: 2, passwordTotal: 7 };
    expect(merge(undefined, secondAttempt)).toEqual(secondAttempt);
    expect(merge(secondAttempt, undefined)).toEqual(secondAttempt);
    expect(merge(secondAttempt, { passwordAttempt: 3, passwordTotal: 7 })).toEqual({
      passwordAttempt: 3,
      passwordTotal: 7
    });
  });
});
