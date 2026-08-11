import path from "node:path";
import { pathToFileURL } from "node:url";
import { describe, expect, it } from "vitest";
import { assertTrustedIpcSender } from "../src/main/ipc-security";

function eventFor(url: string) {
  return {
    senderFrame: { url },
    sender: {
      getURL: () => url
    }
  };
}

describe("ipc-security", () => {
  it("accepts IPC from the configured Vite development renderer origin", () => {
    expect(() => assertTrustedIpcSender(eventFor("http://localhost:5180/settings"), {
      isPackaged: false,
      devServerUrl: "http://localhost:5180",
      appPath: "C:\\Program Files\\MDD"
    })).not.toThrow();
  });

  it("rejects IPC from development-origin lookalikes", () => {
    expect(() => assertTrustedIpcSender(eventFor("http://localhost.evil.example:5180/settings"), {
      isPackaged: false,
      devServerUrl: "http://localhost:5180",
      appPath: "C:\\Program Files\\MDD"
    })).toThrow("IPC-Absender ist nicht vertrauenswürdig");
  });

  it("accepts IPC from the packaged renderer file tree", () => {
    const appPath = path.join("C:", "Program Files", "MDD", "resources", "app.asar");
    const rendererUrl = pathToFileURL(path.join(appPath, "build", "renderer", "index.html")).toString();

    expect(() => assertTrustedIpcSender(eventFor(rendererUrl), {
      isPackaged: true,
      devServerUrl: "http://localhost:5180",
      appPath
    })).not.toThrow();
  });

  it("rejects IPC from local files outside the packaged renderer tree", () => {
    const appPath = path.join("C:", "Program Files", "MDD", "resources", "app.asar");
    const attackerUrl = pathToFileURL(path.join("C:", "Users", "Public", "attacker.html")).toString();

    expect(() => assertTrustedIpcSender(eventFor(attackerUrl), {
      isPackaged: true,
      devServerUrl: "http://localhost:5180",
      appPath
    })).toThrow("IPC-Absender ist nicht vertrauenswürdig");
  });

  it("rejects IPC when Electron provides no sender URL", () => {
    expect(() => assertTrustedIpcSender({
      senderFrame: null,
      sender: {
        getURL: () => ""
      }
    }, {
      isPackaged: false,
      devServerUrl: "http://localhost:5180",
      appPath: "C:\\Program Files\\MDD"
    })).toThrow("IPC-Absender ist nicht vertrauenswürdig");
  });
});
