import { getDebridLinkApiKeyIds } from "../shared/debrid-link-keys";
import { getMegaDebridAccountIds, mergeMegaDebridCredentialPools } from "../shared/mega-debrid-accounts";
import { getRealDebridAccountIds } from "../shared/real-debrid-accounts";
import type { AppSettings } from "../shared/types";

export function overlayLiveUsageCounters(target: AppSettings, liveSettings: AppSettings, liveTotalRuntimeMs: number): void {
  const debridLinkKeyIds = new Set(getDebridLinkApiKeyIds(target.debridLinkApiKeys));
  const megaAccountIds = new Set(getMegaDebridAccountIds(mergeMegaDebridCredentialPools(target.megaDebridApiCredentials || "", target.megaDebridWebCredentials || "") || target.megaCredentials || "", target.megaPassword || ""));
  const realDebridAccountIds = new Set(getRealDebridAccountIds(target));
  const validAccountIds = new Set([
    ...debridLinkKeyIds,
    ...megaAccountIds,
    ...realDebridAccountIds,
    ...(realDebridAccountIds.size === 0 && (target.realDebridUseWebLogin || target.token.trim()) ? ["svc-realdebrid"] : [])
  ]);
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
  target.realDebridAccountDailyUsageBytes = Object.fromEntries(
    Object.entries(liveSettings.realDebridAccountDailyUsageBytes || {}).filter(([accountId]) => realDebridAccountIds.has(accountId))
  );
  target.realDebridAccountTotalUsageBytes = Object.fromEntries(
    Object.entries(liveSettings.realDebridAccountTotalUsageBytes || {}).filter(([accountId]) => realDebridAccountIds.has(accountId))
  );
  target.debridAccountStatuses = Object.fromEntries(
    Object.entries(liveSettings.debridAccountStatuses || {}).filter(([accountId]) => validAccountIds.has(accountId))
  );
}
