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
