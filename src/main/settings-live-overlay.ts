import { getDebridLinkApiKeyIds } from "../shared/debrid-link-keys";
import { getMegaDebridAccountIds, getMegaDebridAccountStatusId, mergeMegaDebridCredentialPools } from "../shared/mega-debrid-accounts";
import type { AppSettings } from "../shared/types";

export function overlayLiveUsageCounters(target: AppSettings, liveSettings: AppSettings, liveTotalRuntimeMs: number): void {
  const debridLinkKeyIds = new Set(getDebridLinkApiKeyIds(target.debridLinkApiKeys));
  const megaAccountIds = new Set(getMegaDebridAccountIds(mergeMegaDebridCredentialPools(target.megaDebridApiCredentials || "", target.megaDebridWebCredentials || "") || target.megaCredentials || "", target.megaPassword || ""));
  const megaAccountStatusIds = [...megaAccountIds].flatMap((accountId) => [
    accountId,
    getMegaDebridAccountStatusId(accountId, "api"),
    getMegaDebridAccountStatusId(accountId, "web")
  ]);
  const validAccountIds = new Set([...debridLinkKeyIds, ...megaAccountStatusIds]);
  target.totalDownloadedAllTime = Math.max(target.totalDownloadedAllTime || 0, liveSettings.totalDownloadedAllTime || 0);
  target.totalCompletedFilesAllTime = Math.max(target.totalCompletedFilesAllTime || 0, liveSettings.totalCompletedFilesAllTime || 0);
  target.totalRuntimeAllTimeMs = Math.max(target.totalRuntimeAllTimeMs || 0, liveTotalRuntimeMs);
  target.providerDailyUsageDay = liveSettings.providerDailyUsageDay;
  target.providerDailyUsageBytes = { ...(liveSettings.providerDailyUsageBytes || {}) };
  target.providerTotalUsageBytes = { ...(liveSettings.providerTotalUsageBytes || {}) };
  target.debridLinkApiKeyDailyUsageBytes = Object.fromEntries(
    Object.entries(liveSettings.debridLinkApiKeyDailyUsageBytes || {}).filter(([keyId]) => debridLinkKeyIds.has(keyId))
  );
  target.debridLinkApiKeyTotalUsageBytes = Object.fromEntries(
    Object.entries(liveSettings.debridLinkApiKeyTotalUsageBytes || {}).filter(([keyId]) => debridLinkKeyIds.has(keyId))
  );
  target.megaDebridAccountDailyUsageBytes = Object.fromEntries(
    Object.entries(liveSettings.megaDebridAccountDailyUsageBytes || {}).filter(([accountId]) => megaAccountIds.has(accountId))
  );
  target.megaDebridAccountTotalUsageBytes = Object.fromEntries(
    Object.entries(liveSettings.megaDebridAccountTotalUsageBytes || {}).filter(([accountId]) => megaAccountIds.has(accountId))
  );
  target.debridAccountStatuses = Object.fromEntries(
    Object.entries(liveSettings.debridAccountStatuses || {}).filter(([accountId]) => validAccountIds.has(accountId))
  );
}
