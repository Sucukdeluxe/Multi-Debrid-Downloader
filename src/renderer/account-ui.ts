import type { DebridProvider, RendererSettings, RendererSettingsUpdate } from "../shared/types";

const proxyOnlyAccountMessages = {
  proxy_list_missing: "Proxy-only ist aktiviert, aber es ist keine Proxy-Liste hinterlegt. Hinterlege sie unter Einstellungen → Geschwindigkeit & Proxy.",
  proxy_list_unreadable: "Proxy-only ist aktiviert, aber die hinterlegte Proxy-Liste kann nicht gelesen werden. Prüfe die Datei unter Einstellungen → Geschwindigkeit & Proxy.",
  proxy_list_empty: "Proxy-only ist aktiviert, aber die hinterlegte Proxy-Liste ist leer oder enthält keine gültigen HTTP-Proxys.",
  proxy_index_unavailable: "Proxy-only ist aktiviert, aber der feste API-Proxy ist in der Liste nicht verfügbar. Prüfe den Listeneintrag unter Einstellungen → Geschwindigkeit & Proxy.",
  proxy_unreachable: "Proxy-only ist aktiviert, aber der feste API-Proxy ist nicht erreichbar oder lehnt die Verbindung ab. Prüfe den Proxy unter Einstellungen → Geschwindigkeit & Proxy."
} as const;

export function formatAccountOperationError(prefix: string, error: unknown): string {
  const raw = String(error);
  const match = raw.match(/proxy_only_account:(proxy_list_missing|proxy_list_unreadable|proxy_list_empty|proxy_index_unavailable|proxy_unreachable)/);
  const detail = match ? proxyOnlyAccountMessages[match[1] as keyof typeof proxyOnlyAccountMessages] : raw;
  return `${prefix}: ${detail}`;
}

export type AccountToggleTarget =
  | { type: "provider"; provider: DebridProvider }
  | { type: "realdebrid"; accountId: string }
  | { type: "megadebrid"; provider: "megadebrid-api" | "megadebrid-web"; accountId: string }
  | { type: "debridlink"; accountId: string };

export type AccountToggleQueueResult<T> =
  | { status: "applied"; value: T }
  | { status: "failed"; error: unknown }
  | { status: "superseded" };

export interface AccountToggleQueue {
  enqueue<T>(key: string, task: (isCurrent: () => boolean) => Promise<T>): Promise<AccountToggleQueueResult<T>>;
}

export function resolveAccountToggleIntentEnabled(pendingEnabled: boolean | undefined, eventEnabled: boolean): boolean {
  return pendingEnabled === undefined ? eventEnabled : !pendingEnabled;
}

export function createAccountToggleQueue(): AccountToggleQueue {
  let tail = Promise.resolve();
  const versions = new Map<string, number>();
  return {
    enqueue<T>(key: string, task: (isCurrent: () => boolean) => Promise<T>): Promise<AccountToggleQueueResult<T>> {
      const version = (versions.get(key) || 0) + 1;
      versions.set(key, version);
      const isCurrent = (): boolean => versions.get(key) === version;
      const execute = async (): Promise<AccountToggleQueueResult<T>> => {
        if (!isCurrent()) return { status: "superseded" };
        try {
          const value = await task(isCurrent);
          return isCurrent() ? { status: "applied", value } : { status: "superseded" };
        } catch (error) {
          return isCurrent() ? { status: "failed", error } : { status: "superseded" };
        }
      };
      const result = tail.then(execute);
      tail = result.then(() => undefined);
      return result;
    }
  };
}

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
  checkedStatus?: { valid: boolean; isPremium: boolean; premiumUntilMs?: number | null },
  nowMs: number = Date.now()
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
  if (checkedStatus.isPremium
    && typeof checkedStatus.premiumUntilMs === "number"
    && Number.isFinite(checkedStatus.premiumUntilMs)
    && checkedStatus.premiumUntilMs > 0
    && checkedStatus.premiumUntilMs <= nowMs) {
    return "free";
  }
  return checkedStatus.isPremium ? "premium" : "free";
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

export function buildAccountTogglePatch(
  settings: RendererSettings,
  target: AccountToggleTarget,
  enabled: boolean
): RendererSettingsUpdate {
  if (target.type === "provider") {
    return {
      disabledProviders: enabled
        ? settings.disabledProviders.filter((provider) => provider !== target.provider)
        : [...new Set([...settings.disabledProviders, target.provider])]
    };
  }
  if (target.type === "realdebrid") {
    const next = buildScopedAccountEnabledState(
      settings.disabledProviders,
      ["realdebrid"],
      settings.realDebridDisabledAccountIds,
      target.accountId,
      enabled
    );
    return {
      disabledProviders: next.disabledProviders,
      realDebridDisabledAccountIds: next.disabledAccountIds
    };
  }
  if (target.type === "debridlink") {
    const next = buildScopedAccountEnabledState(
      settings.disabledProviders,
      ["debridlink"],
      settings.debridLinkDisabledKeyIds,
      target.accountId,
      enabled
    );
    return {
      disabledProviders: next.disabledProviders,
      debridLinkDisabledKeyIds: next.disabledAccountIds
    };
  }
  const web = target.provider === "megadebrid-web";
  const currentDisabledIds = web ? settings.megaDebridWebDisabledAccountIds : settings.megaDebridApiDisabledAccountIds;
  const next = buildScopedAccountEnabledState(
    settings.disabledProviders,
    ["megadebrid", target.provider],
    currentDisabledIds,
    target.accountId,
    enabled
  );
  const apiDisabledIds = web ? settings.megaDebridApiDisabledAccountIds : next.disabledAccountIds;
  const webDisabledIds = web ? next.disabledAccountIds : settings.megaDebridWebDisabledAccountIds;
  return {
    disabledProviders: next.disabledProviders,
    megaDebridApiEnabled: !web && enabled ? true : settings.megaDebridApiEnabled,
    megaDebridWebEnabled: web && enabled ? true : settings.megaDebridWebEnabled,
    megaDebridDisabledAccountIds: [...new Set([...apiDisabledIds, ...webDisabledIds])],
    megaDebridApiDisabledAccountIds: apiDisabledIds,
    megaDebridWebDisabledAccountIds: webDisabledIds
  };
}

export interface AccountToggleIntent {
  key: string;
  target: AccountToggleTarget;
  enabled: boolean;
  check?: () => Promise<{ valid: boolean; message?: string }>;
}

export interface AccountToggleIntentDependencies {
  getSettings: () => RendererSettings;
  persist: (patch: RendererSettingsUpdate) => Promise<RendererSettings>;
}

export function enqueueAccountToggleIntent(
  queue: AccountToggleQueue,
  intent: AccountToggleIntent,
  dependencies: AccountToggleIntentDependencies
): Promise<AccountToggleQueueResult<RendererSettings>> {
  return queue.enqueue(intent.key, async (isCurrent) => {
    if (intent.check) {
      const status = await intent.check();
      if (!isCurrent()) return dependencies.getSettings();
      if (!status.valid) throw new Error(status.message || "Accountprüfung fehlgeschlagen");
    }
    if (!isCurrent()) return dependencies.getSettings();
    const patch = buildAccountTogglePatch(dependencies.getSettings(), intent.target, intent.enabled);
    return dependencies.persist(patch);
  });
}

export function mergeAccountToggleSettings<T extends RendererSettings>(current: T, persisted: RendererSettings): T {
  return {
    ...current,
    disabledProviders: [...persisted.disabledProviders],
    realDebridDisabledAccountIds: [...persisted.realDebridDisabledAccountIds],
    debridLinkDisabledKeyIds: [...persisted.debridLinkDisabledKeyIds],
    megaDebridApiEnabled: persisted.megaDebridApiEnabled,
    megaDebridWebEnabled: persisted.megaDebridWebEnabled,
    megaDebridDisabledAccountIds: [...persisted.megaDebridDisabledAccountIds],
    megaDebridApiDisabledAccountIds: [...persisted.megaDebridApiDisabledAccountIds],
    megaDebridWebDisabledAccountIds: [...persisted.megaDebridWebDisabledAccountIds]
  };
}
