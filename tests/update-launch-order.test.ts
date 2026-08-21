import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { buildDeferredInstallerLaunch } from "../src/main/update";

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

async function waitForFile(filePath: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(filePath)) {
    if (Date.now() >= deadline) {
      throw new Error("marker timeout");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

describe.runIf(process.platform === "win32")("deferred update launch", () => {
  it("starts the installer only after the previous application process exits", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "mdd-update-launch-"));
    tempDirs.push(root);
    const installerPath = path.join(root, "installer.cmd");
    const markerPath = path.join(root, "started.txt");
    fs.writeFileSync(installerPath, `@echo off\r\n> "${markerPath}" echo started\r\n`, "utf8");
    const previous = spawn(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", "ping 127.0.0.1 -n 3 > nul"], {
      stdio: "ignore",
      windowsHide: true
    });
    if (!previous.pid) {
      throw new Error("previous process missing pid");
    }
    const deferred = buildDeferredInstallerLaunch(installerPath, previous.pid);
    const launcher = spawn(deferred.command, deferred.args, {
      stdio: "ignore",
      windowsHide: true
    });

    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(fs.existsSync(markerPath)).toBe(false);

    await new Promise<void>((resolve, reject) => {
      previous.once("exit", () => resolve());
      previous.once("error", reject);
    });
    await waitForFile(markerPath, 5_000);
    expect(fs.readFileSync(markerPath, "utf8").trim()).toBe("started");

    launcher.unref();
  });
});
