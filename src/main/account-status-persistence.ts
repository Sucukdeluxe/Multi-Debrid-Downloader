import type { DebridAccountStatus } from "../shared/types";

export function canPersistExpectedAccountStatus(statuses: readonly DebridAccountStatus[], expectedAccountId: string | undefined): boolean {
  return Boolean(expectedAccountId)
    && statuses.length === 1
    && statuses[0].valid
    && statuses[0].accountId === expectedAccountId;
}
