import type { DebridProvider } from "../shared/types";

export type AccountModeFilter = "all" | "api" | "web";

export interface AccountModeOption {
  modeLabel: string;
}

export function matchesAccountModeFilter(option: AccountModeOption, filter: AccountModeFilter): boolean {
  if (filter === "all") {
    return true;
  }
  if (filter === "api") {
    return option.modeLabel === "API";
  }
  return option.modeLabel.startsWith("Web");
}

export function buildConfiguredProviderOrder(
  currentOrder: readonly DebridProvider[],
  configuredProviders: readonly DebridProvider[]
): DebridProvider[] {
  const configured = new Set(configuredProviders);
  const result = currentOrder.filter((provider, index) => configured.has(provider) && currentOrder.indexOf(provider) === index);
  const included = new Set(result);
  for (const provider of configuredProviders) {
    if (!included.has(provider)) {
      result.push(provider);
      included.add(provider);
    }
  }
  return result;
}

export function pruneAccountRowSelection(selectedRowKey: string | null, existingRowKeys: readonly string[]): string | null {
  return selectedRowKey && existingRowKeys.includes(selectedRowKey) ? selectedRowKey : null;
}

export function resolveVisibleAccountKind<T extends string>(currentKind: T | null, visibleKinds: readonly T[]): T | null {
  return currentKind && visibleKinds.includes(currentKind) ? currentKind : visibleKinds[0] ?? null;
}

export function getAccountDialogSelectableOptions<T extends { service: string }>(
  allOptions: readonly T[],
  availableOptions: readonly T[],
  mode: "create" | "edit",
  editService: string | null
): T[] {
  return mode === "edit"
    ? allOptions.filter((option) => option.service === editService)
    : [...availableOptions];
}

export function isAccountRowSelectionKey(key: string, originatedOnRow: boolean): boolean {
  return originatedOnRow && (key === "Enter" || key === " ");
}

export function resolveAccountUsername(storedUsername: string, checkedEmail?: string): string {
  return checkedEmail?.trim() || storedUsername.trim() || "—";
}

export function buildBulkAccountEnabledState(
  currentDisabledProviders: DebridProvider[],
  configuredProviders: DebridProvider[],
  megaAccountIds: string[],
  debridLinkKeyIds: string[],
  enabled: boolean
): {
  disabledProviders: DebridProvider[];
  megaDebridDisabledAccountIds: string[];
  debridLinkDisabledKeyIds: string[];
} {
  const configured = new Set(configuredProviders);
  return {
    disabledProviders: enabled
      ? currentDisabledProviders.filter((provider) => !configured.has(provider))
      : [...new Set([...currentDisabledProviders, ...configuredProviders])],
    megaDebridDisabledAccountIds: enabled ? [] : [...new Set(megaAccountIds)],
    debridLinkDisabledKeyIds: enabled ? [] : [...new Set(debridLinkKeyIds)]
  };
}
