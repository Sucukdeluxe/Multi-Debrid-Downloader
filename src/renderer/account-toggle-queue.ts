import type { DebridProvider, RendererSettingsUpdate } from "../shared/types";

export type AccountToggleTarget =
  | { kind: "provider"; provider: DebridProvider }
  | { kind: "debridlink"; accountId: string }
  | { kind: "mega-api"; accountId: string }
  | { kind: "mega-web"; accountId: string };

export interface AccountToggleSettings {
  disabledProviders: DebridProvider[];
  debridLinkDisabledKeyIds: string[];
  megaDebridApiEnabled: boolean;
  megaDebridWebEnabled: boolean;
  megaDebridDisabledAccountIds: string[];
  megaDebridApiDisabledAccountIds: string[];
  megaDebridWebDisabledAccountIds: string[];
}

function setListEntry<T extends string>(values: T[], value: T, present: boolean): T[] {
  return present
    ? [...new Set([...values, value])]
    : values.filter((entry) => entry !== value);
}

export function setAccountTargetEnabled<T extends AccountToggleSettings>(
  settings: T,
  target: AccountToggleTarget,
  enabled: boolean
): T {
  if (target.kind === "provider") {
    return {
      ...settings,
      disabledProviders: setListEntry(settings.disabledProviders, target.provider, !enabled)
    };
  }
  if (target.kind === "debridlink") {
    return {
      ...settings,
      debridLinkDisabledKeyIds: setListEntry(settings.debridLinkDisabledKeyIds, target.accountId, !enabled)
    };
  }
  const apiDisabled = target.kind === "mega-api"
    ? setListEntry(settings.megaDebridApiDisabledAccountIds, target.accountId, !enabled)
    : settings.megaDebridApiDisabledAccountIds;
  const webDisabled = target.kind === "mega-web"
    ? setListEntry(settings.megaDebridWebDisabledAccountIds, target.accountId, !enabled)
    : settings.megaDebridWebDisabledAccountIds;
  return {
    ...settings,
    megaDebridApiEnabled: target.kind === "mega-api" && enabled ? true : settings.megaDebridApiEnabled,
    megaDebridWebEnabled: target.kind === "mega-web" && enabled ? true : settings.megaDebridWebEnabled,
    megaDebridApiDisabledAccountIds: apiDisabled,
    megaDebridWebDisabledAccountIds: webDisabled,
    megaDebridDisabledAccountIds: [...new Set([...apiDisabled, ...webDisabled])]
  };
}

export function buildAccountToggleSettingsUpdate(settings: AccountToggleSettings): RendererSettingsUpdate {
  return {
    disabledProviders: settings.disabledProviders,
    debridLinkDisabledKeyIds: settings.debridLinkDisabledKeyIds,
    megaDebridApiEnabled: settings.megaDebridApiEnabled,
    megaDebridWebEnabled: settings.megaDebridWebEnabled,
    megaDebridDisabledAccountIds: settings.megaDebridDisabledAccountIds,
    megaDebridApiDisabledAccountIds: settings.megaDebridApiDisabledAccountIds,
    megaDebridWebDisabledAccountIds: settings.megaDebridWebDisabledAccountIds
  };
}

export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();

  public enqueue<T>(task: () => Promise<T>): Promise<T> {
    const result = this.tail.then(task);
    this.tail = result.then(() => undefined, () => undefined);
    return result;
  }
}
