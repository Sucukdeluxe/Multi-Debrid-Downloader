import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveAppIconPath } from "../src/main/app-icon";

describe("application icon path", () => {
  it("uses the unpacked resource copy in packaged builds", () => {
    expect(resolveAppIconPath(true, "C:\\app\\resources\\app.asar", "C:\\app\\resources")).toBe(
      path.join("C:\\app\\resources", "assets", "app_icon.ico")
    );
  });

  it("uses the source asset in development", () => {
    expect(resolveAppIconPath(false, "C:\\repo", "C:\\app\\resources")).toBe(
      path.join("C:\\repo", "assets", "app_icon.ico")
    );
  });
});
