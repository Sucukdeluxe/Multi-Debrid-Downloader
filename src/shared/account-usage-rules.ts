export const ACCOUNT_RULE_PROVIDERS = ["realdebrid", "megadebrid-api", "megadebrid-web", "debridlink"] as const;
export type AccountRuleProvider = typeof ACCOUNT_RULE_PROVIDERS[number];
export type AccountSelectionMode = "automatic" | "priority";
export interface AccountUsageRule {
  mode: AccountSelectionMode;
  accountIds: string[];
}
export type AccountUsageRules = Partial<Record<AccountRuleProvider, AccountUsageRule>>;

export function isAccountRuleProvider(provider: string): provider is AccountRuleProvider {
  return (ACCOUNT_RULE_PROVIDERS as readonly string[]).includes(provider);
}

export function reconcileAccountOrder(order: readonly string[], available: readonly string[]): string[] {
  const remaining = new Set(available);
  return [...order.filter((id) => remaining.delete(id)), ...remaining];
}

export function normalizeAccountUsageRules(value: unknown, available?: Partial<Record<AccountRuleProvider, readonly string[]>>): AccountUsageRules {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result: AccountUsageRules = {};
  for (const provider of ACCOUNT_RULE_PROVIDERS) {
    const raw = (value as Record<string, unknown>)[provider];
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const rule = raw as Record<string, unknown>;
    const ids = Array.isArray(rule.accountIds) ? [...new Set(rule.accountIds.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 256))].slice(0, 10000) : [];
    result[provider] = { mode: rule.mode === "priority" ? "priority" : "automatic", accountIds: available ? reconcileAccountOrder(ids, available[provider] ?? []) : ids };
  }
  return result;
}

export function orderAccountsByRule<T extends { id: string }>(accounts: readonly T[], rule?: AccountUsageRule): T[] {
  if (rule?.mode !== "priority") return [...accounts];
  const byId = new Map(accounts.map((account) => [account.id, account]));
  return reconcileAccountOrder(rule.accountIds, accounts.map((account) => account.id)).map((id) => byId.get(id)!);
}
