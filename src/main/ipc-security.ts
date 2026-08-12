import path from "node:path";
import { fileURLToPath } from "node:url";

export type TrustedIpcOptions = {
  isPackaged: boolean;
  devServerUrl: string;
  appPath: string;
};

type IpcSenderEvent = {
  senderFrame?: { url: string } | null;
  sender?: { getURL?: () => string };
};

export function assertTrustedIpcSender(event: IpcSenderEvent, options: TrustedIpcOptions): void {
  const senderUrl = String(event.senderFrame?.url || event.sender?.getURL?.() || "");
  if (!senderUrl || !isTrustedSenderUrl(senderUrl, options)) {
    throw new Error("IPC-Absender ist nicht vertrauenswürdig");
  }
}

function isTrustedSenderUrl(senderUrl: string, options: TrustedIpcOptions): boolean {
  if (options.isPackaged) {
    return isPackagedRendererUrl(senderUrl, options.appPath);
  }
  try {
    const sender = new URL(senderUrl);
    const expected = new URL(options.devServerUrl);
    return sender.origin === expected.origin;
  } catch {
    return false;
  }
}

function isPackagedRendererUrl(senderUrl: string, appPath: string): boolean {
  try {
    const parsed = new URL(senderUrl);
    if (parsed.protocol !== "file:") {
      return false;
    }
    const senderPath = path.resolve(fileURLToPath(parsed));
    const rendererPath = path.resolve(appPath, "build", "renderer");
    const actualPath = process.platform === "win32" ? senderPath.toLowerCase() : senderPath;
    const trustedRendererPath = process.platform === "win32" ? rendererPath.toLowerCase() : rendererPath;
    return actualPath === trustedRendererPath || actualPath.startsWith(trustedRendererPath + path.sep);
  } catch {
    return false;
  }
}
