import { normalizeAccountUsageRules } from "../shared/account-usage-rules";
import { getRealDebridAccounts } from "../shared/real-debrid-accounts";
import { getMegaDebridAccountsForMode } from "../shared/mega-debrid-accounts";
import { parseDebridLinkApiKeys } from "../shared/debrid-link-keys";
import type { AppSettings } from "../shared/types";

export function normalizeConfiguredAccountRules(settings: AppSettings) {
  return normalizeAccountUsageRules(settings.accountUsageRules, {
    realdebrid: getRealDebridAccounts(settings).map((account) => account.id),
    "megadebrid-api": getMegaDebridAccountsForMode(settings, "api").map((account) => account.id),
    "megadebrid-web": getMegaDebridAccountsForMode(settings, "web").map((account) => account.id),
    debridlink: parseDebridLinkApiKeys(settings.debridLinkApiKeys).map((account) => account.id)
  });
}
