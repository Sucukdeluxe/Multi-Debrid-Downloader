import type { AudioStripSummary, DebridProvider } from "../shared/types";

export const providerLabels: Record<DebridProvider, string> = {
  realdebrid: "Real-Debrid",
  megadebrid: "Mega-Debrid",
  "megadebrid-api": "Mega-Debrid API",
  "megadebrid-web": "Mega-Debrid Web",
  bestdebrid: "BestDebrid",
  alldebrid: "AllDebrid",
  ddownload: "DDownload",
  onefichier: "1Fichier",
  debridlink: "Debrid-Link",
  linksnappy: "LinkSnappy"
};

export function compactProviderLabels(labels: string[]): string {
  const groups = new Map<string, string[]>();
  for (const label of [...new Set(labels)]) {
    const match = label.match(/^(.+?)\s*\((.+)\)$/);
    if (!match) {
      groups.set(label, []);
      continue;
    }
    const details = groups.get(match[1]) ?? [];
    details.push(match[2]);
    groups.set(match[1], details);
  }
  return [...groups].map(([base, details]) => details.length === 0 ? base : `${base} (${details.join(" + ")})`).join(", ");
}

export function formatDateTime(timestamp: number): string {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${day}.${month}.${date.getFullYear()} - ${hours}:${minutes}`;
}

export function extractHoster(url: string): string {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "");
    const parts = host.split(".");
    return parts.length >= 2 ? parts[parts.length - 2] : host;
  } catch {
    return "";
  }
}

export function formatAudioStripSummary(summary: AudioStripSummary): { text: string; tooltip: string; attention: boolean } {
  const parts: string[] = [];
  const ok = summary.remuxed + summary.keptSingle;
  if (ok > 0) parts.push(`${ok} OK`);
  if (summary.skippedNoGerman > 0) parts.push(`${summary.skippedNoGerman} ohne DE-Tag`);
  if (summary.skippedNoTool > 0) parts.push("ffmpeg fehlt");
  if (summary.failed > 0) parts.push(`${summary.failed} Fehler`);
  return {
    text: `Tonspur: ${parts.join(" · ") || "—"}`,
    tooltip: summary.files.map((entry) => `${entry.name}: ${entry.action} (${entry.reason}${entry.languages ? `, Spuren: ${entry.languages}` : ""})`).join("\n"),
    attention: summary.skippedNoGerman > 0 || summary.skippedNoTool > 0 || summary.failed > 0
  };
}

export function formatSpeedMbps(speedBps: number): string {
  return `${(Math.max(0, speedBps || 0) / (1024 * 1024)).toFixed(2)} MB/s`;
}

export function humanSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(2)} MB`;
  if (bytes < 1024 ** 4) return `${(bytes / 1024 ** 3).toFixed(2)} GB`;
  return `${(bytes / 1024 ** 4).toFixed(3)} TB`;
}
