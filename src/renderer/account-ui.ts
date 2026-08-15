import type { DebridProvider } from "../shared/types";

export type AccountModeFilter = "all" | "api" | "web";

export interface AccountModeOption {
  modeLabel: string;
}

export function sortAccountServices(labels: readonly string[]): string[] {
  return [...new Set(labels)].sort((left, right) => left.localeCompare(right, "de-DE", { sensitivity: "base" }));
}

export function getAvailableAccountOptions<T extends { service: string }>(
  options: readonly T[],
  configuredServices: readonly string[]
): T[] {
  const configured = new Set(configuredServices);
  return options.filter((option) => option.service === "realdebrid"
    || option.service === "megadebrid-api"
    || option.service === "megadebrid-web"
    || option.service === "debridlink"
    || !configured.has(option.service));
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

export function filterAccountDialogOptions<T extends {
  serviceLabel: string;
  title: string;
  modeLabel: string;
  pickerDescription: string;
}>(options: readonly T[], query: string, serviceFilter: string): T[] {
  const normalizedQuery = query.trim().toLocaleLowerCase("de-DE");
  return options.filter((option) => {
    if (serviceFilter !== "all" && option.serviceLabel !== serviceFilter) {
      return false;
    }
    if (!normalizedQuery) {
      return true;
    }
    return [option.title, option.modeLabel, option.pickerDescription]
      .join(" ")
      .toLocaleLowerCase("de-DE")
      .includes(normalizedQuery);
  }).sort((left, right) => left.serviceLabel.localeCompare(right.serviceLabel, "de-DE", { sensitivity: "base" })
    || left.title.localeCompare(right.title, "de-DE", { sensitivity: "base" }));
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

export function updateAccountRowSelection(selectedRowKeys: readonly string[], rowKey: string, additive: boolean): string[] {
  if (!additive) {
    return [rowKey];
  }
  const next = new Set(selectedRowKeys);
  if (next.has(rowKey)) {
    next.delete(rowKey);
  } else {
    next.add(rowKey);
  }
  return [...next];
}

export function pruneAccountRowSelections(selectedRowKeys: readonly string[], existingRowKeys: readonly string[]): string[] {
  const existing = new Set(existingRowKeys);
  return [...new Set(selectedRowKeys)].filter((rowKey) => existing.has(rowKey));
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

export function resolveAccountStatusState(
  disabled: boolean,
  checkedStatus?: { valid: boolean; isPremium: boolean }
): "disabled" | "unchecked" | "invalid" | "free" | "premium" {
  if (checkedStatus && !checkedStatus.valid) {
    return "invalid";
  }
  if (disabled) {
    return "disabled";
  }
  if (!checkedStatus) {
    return "unchecked";
  }
  return checkedStatus.isPremium ? "premium" : "free";
}

export async function runOptimisticAccountUpdate<T>(
  apply: () => void,
  persist: () => Promise<T>,
  rollback: () => void
): Promise<T> {
  apply();
  try {
    return await persist();
  } catch (error) {
    rollback();
    throw error;
  }
}

export function buildScopedAccountEnabledState(
  currentDisabledProviders: DebridProvider[],
  providerIds: DebridProvider[],
  currentDisabledAccountIds: string[],
  accountId: string,
  enabled: boolean
): { disabledProviders: DebridProvider[]; disabledAccountIds: string[] } {
  const providers = new Set(providerIds);
  return {
    disabledProviders: enabled
      ? currentDisabledProviders.filter((provider) => !providers.has(provider))
      : [...currentDisabledProviders],
    disabledAccountIds: enabled
      ? currentDisabledAccountIds.filter((id) => id !== accountId)
      : [...new Set([...currentDisabledAccountIds, accountId])]
  };
}
