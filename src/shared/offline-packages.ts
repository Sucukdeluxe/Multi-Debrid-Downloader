import type { DownloadItem, PackageEntry } from "./types";

export function getPackagesWithOfflineLinks(
  packageIds: readonly string[],
  packages: Record<string, PackageEntry>,
  items: Record<string, DownloadItem>
): string[] {
  return [...new Set(packageIds)].filter((id) => packages[id]?.itemIds.some((itemId) => items[itemId]?.onlineStatus === "offline"));
}
