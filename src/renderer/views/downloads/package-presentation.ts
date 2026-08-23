import type { DownloadItem } from "../../../shared/types";
import type { DownloadPackageRow } from "./downloads-model";

export interface PackageProgressPresentation {
  done: number;
  failed: number;
  cancelled: number;
  total: number;
  value: number;
}

export interface PackagePresentation {
  progress: PackageProgressPresentation;
  status: string;
  details: string;
  activeOperationLabel: string;
  extractFailure?: DownloadItem;
  extractFailureCount: number;
  retryCount: number;
  waitDiskCount: number;
  extractingCount: number;
}

function extractionPercent(fullStatus: string): number {
  const match = fullStatus.match(/^(?:Entpacken\s+|Finalisieren\s*-\s*)(\d+)%/i);
  return match ? Math.max(0, Math.min(100, Number(match[1]))) / 100 : 0;
}

function isExtractFailure(fullStatus: string): boolean {
  return /^(?:Entpack-Fehler|Entpacken\s*-\s*(?:Fehler|Error))/i.test(fullStatus);
}

function isExtractionLifecycle(fullStatus: string): boolean {
  return /^(?:Entpack|Passwort|Finalisieren)/i.test(fullStatus);
}

function isArchiveItem(item: DownloadItem): boolean {
  return /\.(?:rar|r\d{2,3}|zip|7z|tar|gz|bz2|xz|tgz|tbz2|txz|\d{3})$/i.test(item.fileName || item.targetPath || "");
}

function isRetrying(item: DownloadItem): boolean {
  return /(?:Link-Umwandlung erneut|Wiederholung|Retry|erneut)/i.test(item.fullStatus || "")
    || (item.retries > 0 && (item.status === "queued" || item.status === "validating" || item.status === "reconnect_wait"));
}

function isLinkConversionRetry(item: DownloadItem): boolean {
  return /(?:Link-Umwandlung erneut|Retrying link conversion)/i.test(item.fullStatus || "");
}

function activePackageOperationLabel(packageStatus: DownloadPackageRow["package"]["status"], label: string): string {
  if (!label) return "";
  if (/^(?:Entpacken\s+\d+%|Entpacken\s*\(\d+\/\d+\)\s*-\s*Nächstes Archiv|Passwort\b|Password\b|Finalisieren\b|Finalizing\b)/i.test(label)) {
    return packageStatus === "extracting" ? label : "";
  }
  return /^(?:Archive stabilisieren|Entpacken vorbereiten|Entpacken wird neu gestartet|Nested Entpacken|Renaming|Tonspur|Aufräumen|Verschiebe Videos)\b/i.test(label)
    ? label
    : "";
}

function downloadFraction(item: DownloadItem): number {
  if (item.status === "completed") {
    return 1;
  }
  if (item.totalBytes && item.totalBytes > 0) {
    return Math.max(0, Math.min(1, item.downloadedBytes / item.totalBytes));
  }
  return Math.max(0, Math.min(1, (item.progressPercent || 0) / 100));
}

export function buildPackagePresentation(row: DownloadPackageRow): PackagePresentation {
  const cleanedCompleted = Math.max(0, Number(row.package.cleanedCompletedItemCount || 0));
  const cleanedExtracted = Math.max(0, Number(row.package.cleanedExtractedItemCount || 0));
  let done = cleanedCompleted;
  let failed = 0;
  let cancelled = 0;
  let downloadUnits = cleanedCompleted;
  let extractionUnits = cleanedExtracted;
  let extractionLifecycle = row.package.status === "extracting"
    || /^(?:Entpack|Passwort)/i.test(row.package.postProcessLabel || "")
    || (row.allItems.some(isArchiveItem) && !row.allItems.every((item) => /^Fertig\b/i.test(item.fullStatus || "")));
  let extracting = 0;
  let retrying = 0;
  let linkConversionRetrying = 0;
  let waitsForDisk = 0;
  let integrityChecking = 0;
  let extractionPending = 0;
  let waitingForParts = 0;
  const extractFailures: DownloadItem[] = [];

  for (const item of row.allItems) {
    if (item.status === "completed") done += 1;
    else if (item.status === "failed") failed += 1;
    else if (item.status === "cancelled") cancelled += 1;
    downloadUnits += downloadFraction(item);
    const fullStatus = item.fullStatus || "";
    if (item.status === "integrity_check") integrityChecking += 1;
    if (/^Entpacken\s*-\s*Ausstehend\b/i.test(fullStatus)) extractionPending += 1;
    if (/^Entpacken\s*-\s*Warten auf Parts\b/i.test(fullStatus)) waitingForParts += 1;
    if (/^Entpackt\b/i.test(fullStatus)) {
      extractionUnits += 1;
      extractionLifecycle = true;
    } else {
      const progress = extractionPercent(fullStatus);
      if (progress > 0 || /^Entpacken\s+\d+%/i.test(fullStatus) || /^Finalisieren\b/i.test(fullStatus)) {
        extracting += 1;
        extractionUnits += progress;
      }
      if (isExtractFailure(fullStatus)) {
        extractFailures.push(item);
      }
      if (isExtractionLifecycle(fullStatus)) {
        extractionLifecycle = true;
      }
    }
    if (isRetrying(item)) {
      retrying += 1;
      if (isLinkConversionRetry(item)) linkConversionRetrying += 1;
    }
    if (/Warte auf Festplatte/i.test(fullStatus)) waitsForDisk += 1;
  }

  const total = Math.max(1, cleanedCompleted + row.allItems.length);
  const downloadValue = Math.floor(Math.min(1, downloadUnits / total) * (extractionLifecycle ? 90 : 100));
  const extractionValue = extractionLifecycle ? Math.floor(Math.min(1, extractionUnits / total) * 10) : 0;
  const allExtracted = extractionLifecycle && extractionUnits >= total;
  const value = allExtracted ? 100 : Math.min(extractionLifecycle ? 99 : 100, downloadValue + extractionValue);

  const parts: string[] = [];
  const retryLabel = linkConversionRetrying > 0
    ? "Link-Umwandlung erneut"
    : `${retrying} Wiederholung${retrying === 1 ? "" : "en"}`;
  if (extractFailures.length > 0) parts.push(`${extractFailures.length} Entpackfehler`);
  if (retrying > 0) parts.push(retryLabel);
  if (failed > 0) parts.push(`${failed} Fehler`);
  if (cancelled > 0) parts.push(`${cancelled} abgebrochen`);
  const details = parts.length > 0 ? parts.join(" · ") : done >= total ? "Fertig" : `${done}/${total} fertig`;
  const downloadsComplete = row.allItems.every((item) => downloadFraction(item) >= 1);
  const packageExtractLabel = (row.package.postProcessLabel || "").trim();
  const activeOperationLabel = activePackageOperationLabel(row.package.status, packageExtractLabel);
  const downloading = row.package.status === "downloading"
    || row.package.status === "validating"
    || row.allItems.some((item) => item.status === "downloading" || item.status === "validating");

  let status = allExtracted ? "Entpackt" : details;
  if (activeOperationLabel) {
    status = activeOperationLabel;
  } else if (waitsForDisk > 0) {
    status = "Warte auf Festplatte";
  } else if (integrityChecking > 0) {
    status = "CRC-Check läuft";
  } else if (extractFailures.length > 0 && retrying > 0) {
    status = `${extractFailures.length} Entpackfehler · ${retryLabel}`;
  } else if (retrying > 0) {
    status = retryLabel;
  } else if (downloading) {
    status = "Download läuft";
  } else if (extractFailures.length > 0) {
    status = downloadsComplete ? `Download fertig · ${extractFailures.length} Entpackfehler` : `${extractFailures.length} Entpackfehler`;
  } else if (extracting > 0) {
    status = "Entpacken";
  } else if (extractionPending > 0) {
    status = "Entpacken - Ausstehend";
  } else if (waitingForParts > 0) {
    status = "Entpacken - Warten auf Parts";
  } else if (row.package.status === "extracting") {
    status = "Entpacken";
  }

  return {
    progress: { done, failed, cancelled, total, value },
    status,
    details,
    activeOperationLabel,
    extractFailure: extractFailures[0],
    extractFailureCount: extractFailures.length,
    retryCount: retrying,
    waitDiskCount: waitsForDisk,
    extractingCount: extracting
  };
}
