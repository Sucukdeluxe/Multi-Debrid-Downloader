import type { DownloadItem } from "./types";

const REGEX_ESCAPE_RE = /[.*+?^$(){}|[\]\\]/g;

function stripDuplicateSuffixBeforeExtension(fileName: string): string {
  return String(fileName || "").replace(/ \(\d+\)(?=\.[^.]+$)/, "");
}

export function resolveOfflineArchiveItemsFromList(archiveName: string, items: DownloadItem[]): DownloadItem[] {
  const normalizeArchiveMatchName = (value: string): string =>
    stripDuplicateSuffixBeforeExtension((String(value || "").replace(/\\/g, "/").split("/").pop() || ""));
  const entryLower = normalizeArchiveMatchName(archiveName).toLowerCase();
  const itemBaseName = (item: DownloadItem): string =>
    normalizeArchiveMatchName(item.targetPath || item.fileName || "");

  let pattern: RegExp | null = null;
  const multipartMatch = entryLower.match(/^(.*)\.part0*\d+\.rar$/);
  if (multipartMatch) {
    const prefix = multipartMatch[1].replace(REGEX_ESCAPE_RE, "\\$&");
    pattern = new RegExp(`^${prefix}\\.part\\d+\\.rar$`, "i");
  }
  if (!pattern) {
    const rarMatch = entryLower.match(/^(.*)\.r(?:ar|\d{2,3})$/);
    if (rarMatch) {
      const stem = rarMatch[1].replace(REGEX_ESCAPE_RE, "\\$&");
      pattern = new RegExp(`^${stem}\\.r(ar|\\d{2,3})$`, "i");
    }
  }
  if (!pattern) {
    const zipSplitMatch = entryLower.match(/^(.*)\.zip\.\d+$/);
    if (zipSplitMatch) {
      const stem = zipSplitMatch[1].replace(REGEX_ESCAPE_RE, "\\$&");
      pattern = new RegExp(`^${stem}\\.zip(\\.\\d+)?$`, "i");
    }
  }
  if (!pattern) {
    const sevenSplitMatch = entryLower.match(/^(.*)\.7z\.\d+$/);
    if (sevenSplitMatch) {
      const stem = sevenSplitMatch[1].replace(REGEX_ESCAPE_RE, "\\$&");
      pattern = new RegExp(`^${stem}\\.7z(\\.\\d+)?$`, "i");
    }
  }
  if (!pattern && /^(.*)\.\d{3}$/.test(entryLower) && !/\.(zip|7z)\.\d{3}$/.test(entryLower)) {
    const genericSplitMatch = entryLower.match(/^(.*)\.\d{3}$/);
    if (genericSplitMatch) {
      const stem = genericSplitMatch[1].replace(REGEX_ESCAPE_RE, "\\$&");
      pattern = new RegExp(`^${stem}\\.\\d{3}$`, "i");
    }
  }

  if (pattern) {
    const matched = items.filter((item) => pattern!.test(itemBaseName(item)));
    if (matched.length > 0) return matched;
  }

  return items.filter((item) => itemBaseName(item).toLowerCase() === entryLower);
}
