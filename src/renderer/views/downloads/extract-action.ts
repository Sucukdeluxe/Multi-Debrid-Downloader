import type { DownloadItem, PackageEntry } from "../../../shared/types";
import type { ExtractNowRequest } from "../../../shared/extract-now";

export interface ExtractNowContextAction {
  label: string;
  request: ExtractNowRequest;
  targetCount: number;
}

export interface ExtractNowContextInput {
  contextItemId?: string;
  selectedPackageIds: readonly string[];
  selectedItemIds: readonly string[];
  packages: Record<string, PackageEntry>;
  items: Record<string, DownloadItem>;
}

function canExtractItem(item: DownloadItem | undefined, pkg: PackageEntry | undefined): item is DownloadItem {
  return Boolean(item && (
    item.status === "completed" && !/^Entpackt\b/i.test(item.fullStatus || "")
    || pkg?.manualExtractionPending === true
      && (pkg.manualExtractionRepairItemIds || []).includes(item.id)
      && ["queued", "reconnect_wait", "failed", "cancelled"].includes(item.status)
  ));
}

export function buildExtractNowContextAction(input: ExtractNowContextInput): ExtractNowContextAction | null {
  const packageIds = [...new Set(input.selectedPackageIds)].filter((packageId) => {
    const entry = input.packages[packageId];
    return Boolean(entry && !entry.cancelled && entry.itemIds.some((itemId) => canExtractItem(input.items[itemId], entry)));
  });
  const packageSet = new Set(packageIds);
  const selectedItemIds = input.selectedItemIds.length > 0
    ? input.selectedItemIds
    : input.contextItemId
      ? [input.contextItemId]
      : [];
  const itemIds = [...new Set(selectedItemIds)].filter((itemId) => {
    const item = input.items[itemId];
    return canExtractItem(item, item ? input.packages[item.packageId] : undefined) && !packageSet.has(item.packageId);
  });
  const targetCount = packageIds.length + itemIds.length;
  if (targetCount === 0) {
    return null;
  }
  return {
    label: targetCount > 1 ? `Jetzt entpacken (${targetCount})` : "Jetzt entpacken",
    request: { packageIds, itemIds },
    targetCount
  };
}
