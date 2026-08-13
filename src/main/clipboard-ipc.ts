import { clipboard } from "electron";
import { assertTrustedIpcSender, type TrustedIpcOptions } from "./ipc-security";
import { logger } from "./logger";

type ClipboardIpcEvent = {
  senderFrame?: { url: string } | null;
  sender?: { getURL?: () => string };
};

const CLIPBOARD_TEXT_MAX_BYTES = 16 * 1024 * 1024;

export function writeClipboardTextFromIpc(
  event: ClipboardIpcEvent,
  text: unknown,
  trustedOptions: TrustedIpcOptions
): true {
  assertTrustedIpcSender(event, trustedOptions);
  if (typeof text !== "string" || Buffer.byteLength(text, "utf8") > CLIPBOARD_TEXT_MAX_BYTES) {
    throw new Error("Ungültiger Zwischenablageinhalt");
  }
  const bytes = Buffer.byteLength(text, "utf8");
  try {
    clipboard.writeText(text);
  } catch (error) {
    logger.warn(`Zwischenablage-Schreiben fehlgeschlagen: ${String(error)}`);
    throw error;
  }
  logger.info(`Zwischenablage geschrieben: bytes=${bytes}`);
  return true;
}
