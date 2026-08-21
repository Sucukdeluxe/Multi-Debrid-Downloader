# Rolling Account Statistics

## Goal

Add a true rolling 24-hour statistics range that shows how much traffic each configured download account transferred. The range must answer questions such as how many bytes each Real-Debrid web account downloaded during the preceding 24 hours, independent of calendar-day boundaries.

## Non-goals

- Existing Session, Today, Seven Days, 30 Days, and Total statistics keep their current calendar and provider semantics.
- Historical per-account traffic from versions that did not record timestamps cannot be reconstructed.
- The feature does not retain download URLs, file names, credentials, email addresses, or raw login data.
- The renderer does not receive the minute-level ledger.

## Persisted data model

The statistics file advances from ledger version 1 to version 2. Existing day buckets remain unchanged. Version 2 adds a sparse list of minute buckets:

```ts
interface StatisticsAccountMinuteUsage {
  provider: DebridProvider;
  label: string;
  bytes: number;
}

interface StatisticsMinuteBucket {
  minute: number;
  downloadedBytes: number;
  accounts: Record<string, StatisticsAccountMinuteUsage>;
}

interface StatisticsLedger {
  version: 2;
  startedAt: number;
  days: StatisticsDayBucket[];
  minutes: StatisticsMinuteBucket[];
}
```

`minute` is the Unix timestamp in milliseconds rounded down to the start of the UTC minute. Minute buckets exist only when at least one byte was recorded. Account keys are opaque account IDs already used by the account pool. They must never be derived from or replaced by credentials.

Each stored label is a short, safe display label derived from the account routing layer. It preserves useful attribution when an account is later removed. Normalization trims the label, limits its length, strips control characters, masks email-like values, and falls back to the provider display name when no safe account label is available.

Transfers without a concrete account ID are grouped under a stable provider fallback key. This keeps the total internally consistent without inventing account identity.

## Recording and retention

The existing provider and daily counters continue to update exactly as before. The same accepted byte delta additionally updates the current minute bucket with the effective provider, concrete account ID, safe account label, and byte count.

The ledger retains at most the preceding 48 hours of minute buckets. Retention is enforced during normalization, recording, and persistence. A 48-hour window allows clock-boundary-safe rolling aggregation while keeping the maximum structure bounded to 2,880 sparse minute buckets.

Repeated byte updates within one minute mutate the in-memory current bucket instead of allocating a new entry. Existing statistics persistence batching remains responsible for writing the ledger, so network chunks do not create one disk write each.

## Rolling aggregation

The main process computes a rolling summary for the preceding 24 hours at minute precision. It includes buckets whose minute timestamp is between `floor((now - 24 hours) / one minute) * one minute` and the current minute, inclusive. The result can therefore include at most the partial boundary minute beyond the exact cutoff, but it never falls back to calendar-day semantics.

The aggregate contains:

```ts
interface StatisticsAccountUsage {
  id: string;
  provider: DebridProvider;
  label: string;
  bytes: number;
}

interface StatisticsRolling24Hours {
  from: number;
  to: number;
  downloadedBytes: number;
  accounts: StatisticsAccountUsage[];
}
```

Rows are sorted by descending byte count and then by label and opaque ID for deterministic output. The sum of account rows must equal `downloadedBytes`, including provider fallback rows.

The aggregate is maintained incrementally while bytes are recorded and rebuilt at most once per minute when old buckets expire. Reset operations and ledger replacement invalidate it immediately. The frequent UI snapshot contains only this bounded aggregate, never the raw minute buckets. Its existing daily statistics projection sets `minutes` to an empty list before crossing the main-to-renderer boundary.

## User interface

The Statistics sidebar adds **Last 24 Hours** directly after **Today**. The German interface label is **Letzte 24 Stunden**.

For this range:

- Data volume shows the rolling 24-hour byte total.
- Files, success rate, average speed, and errors show a dash because the existing outcome and active-time data is only day-scoped and cannot be assigned exactly to a rolling boundary.
- The usage section heading changes from Provider to Accounts.
- Each row displays the provider and safe account label, for example `Real-Debrid · xSucukDE`.
- The data column displays the account byte total.
- The results column displays a dash because completed and failed file outcomes are not attributed to an account by the current download model.
- An empty window explains that no account traffic has been recorded during the last 24 hours.

Other ranges continue to display provider rows and their existing outcome metrics.

## Migration and coverage

Loading a version 1 ledger produces a version 2 ledger with the same day buckets and an empty minute list. No day totals are copied into minute buckets because their exact timestamps and account attribution are unknown.

The new range therefore starts collecting exact data after the upgrade. Until a full 24 hours have elapsed, the interface states that the displayed range contains the recorded portion since the upgrade. Once the earliest retained minute is at least 24 hours old, the coverage message becomes a normal rolling-range description.

Malformed minute buckets, unknown providers, invalid timestamps, unsafe IDs, negative byte counts, and invalid labels are discarded or normalized without affecting valid daily history.

## Reset, backup, and restore

Session reset keeps the rolling ledger because the range is not session-scoped. Total statistics reset clears both daily and minute history. Statistics-file backup and recovery handle version 2 as one ledger; a recovered version 1 file migrates through the same normalization path.

## Privacy and security

- Account IDs remain opaque and contain no credential material.
- Labels are display-only, length-bounded, control-character-free, and email-masked before persistence.
- Tokens, passwords, cookies, URLs, file names, target paths, and raw account responses are never stored in minute buckets.
- Renderer snapshots expose only the aggregated account rows required by the visible range.
- Support exports apply their existing account-label redaction to the aggregate and never include the raw minute ledger unless the support format explicitly introduces a separately reviewed sanitized representation.

## Acceptance criteria

- A transfer split across midnight appears entirely in Last 24 Hours until its minute buckets age out.
- Two accounts of the same provider receive separate rows and exact byte attribution.
- API and web accounts can appear together without sharing an ID or label.
- Disabling, deleting, or renaming an account does not move already recorded bytes to another account.
- A version 1 statistics file loads without losing existing day history.
- Buckets older than 48 hours are pruned and malformed entries cannot inflate totals.
- The sum of displayed account rows equals the displayed rolling data volume.
- Frequent snapshots do not serialize or scan the raw minute ledger.
- Total reset clears rolling account statistics; session reset does not.
- Focused tests cover minute boundaries, midnight, 24-hour expiry, migration, deletion, fallback attribution, label sanitization, reset behavior, and renderer presentation.
