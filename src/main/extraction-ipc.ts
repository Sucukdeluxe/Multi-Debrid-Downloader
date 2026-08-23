import type { IpcMainInvokeEvent } from "electron";
import type { ExtractNowRequest } from "../shared/extract-now";
import { normalizeExtractNowRequest } from "../shared/extract-now";
import { IPC_CHANNELS } from "../shared/ipc";

export interface ExtractionIpcTarget {
  retryExtraction(packageId: string): Promise<void>;
  extractNow(request: ExtractNowRequest): Promise<void>;
}

export type TrustedIpcRegistrar = (
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown
) => void;

function normalizeRetryPackageId(value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error("packageId muss ein nicht-leerer String sein");
  }
  const packageId = value.trim();
  if (packageId.length > 256) {
    throw new Error("packageId darf höchstens 256 Zeichen lang sein");
  }
  return packageId;
}

export function registerExtractionIpcHandlers(registerTrusted: TrustedIpcRegistrar, target: ExtractionIpcTarget): void {
  registerTrusted(IPC_CHANNELS.RETRY_EXTRACTION, (_event, ...args) => {
    return target.retryExtraction(normalizeRetryPackageId(args[0]));
  });
  registerTrusted(IPC_CHANNELS.EXTRACT_NOW, (_event, ...args) => {
    return target.extractNow(normalizeExtractNowRequest(args[0]));
  });
}
