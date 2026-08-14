import fs from "node:fs";
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

  it("ships a high-resolution transparent PNG and complete Windows icon sizes", () => {
    const png = fs.readFileSync(path.resolve("assets/app_icon.png"));
    expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(png.readUInt32BE(16)).toBeGreaterThanOrEqual(1024);
    expect(png.readUInt32BE(20)).toBeGreaterThanOrEqual(1024);
    expect([4, 6]).toContain(png[25]);

    const ico = fs.readFileSync(path.resolve("assets/app_icon.ico"));
    const frameCount = ico.readUInt16LE(4);
    const sizes = Array.from({ length: frameCount }, (_, index) => {
      const offset = 6 + index * 16;
      return ico[offset] || 256;
    });
    expect(sizes).toEqual(expect.arrayContaining([16, 32, 48, 256]));
  });
});
