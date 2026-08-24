# Changelog

All notable changes to Multi-Debrid Downloader are documented in this file.

## [Unreleased]

## [2.0.72] - 2026-08-24

### Package history telemetry

- Store separate download, extraction, remux, post-processing, and total durations for completed package generations.
- Preserve accurate download file and byte totals while reporting archive groups, validated multipart counts, generated outputs, failure categories, and additive phase counters independently.
- Track parallel and interrupted archive work across restarts, distinguish partial, failed, and cancelled package results, and add dedicated history filters for partial and cancelled entries.
- Show detailed lifecycle timestamps, operation durations, result counts, failure phases, and sanitized error categories in expandable history rows and Discord notifications.

### Download controls

- Move the global package disclosure action into a responsive right-aligned toolbar group and disable it when the queue is empty.
- Replace the decorative package heading with a compact neutral filter group and keep all-package actions independent from active filters and search results.
- Coordinate package height and opacity transitions while continuing to honor the global animation setting and large-queue motion guard.
- Open contextual help on pointer hover, keyboard focus, or click and close it only after both pointer and focus leave the shared region.

### Deepbrid resume reliability

- Resume Deepbrid downloads that return open-ended `Content-Range` responses instead of repeatedly renewing an otherwise valid direct link.
- Prefer byte-exact HTTP totals over rounded provider metadata and preserve already complete archive files when a standard HTTP 416 response confirms their real size.

## [2.0.71] - 2026-08-24

### Deepbrid accounts

- Add Deepbrid API-key accounts with encrypted credential storage, account validation, premium status, expiration details, usage counters, and explicit secret reveal controls.
- Route downloads through Deepbrid in the normal provider order, hoster rules, daily limits, cooldown handling, and automatic fallback chain.
- Validate API responses, retry only rate limits and temporary failures, reject unsafe download targets and filenames, and keep keys and provider responses out of logs and diagnostics.
- Add the Deepbrid service icon and verified support for generating and downloading 1Fichier links.

### Recurring daily starts

- Add a persistent daily queue schedule using the local time zone with separate start-today and start-tomorrow choices.
- Reconcile schedules after restarts, account changes, suspend, and resume while preventing duplicate starts for the same local calendar day.
- Preserve existing one-time schedules during unrelated settings saves and show the next daily start as a live countdown.

### Discord notifications

- Add detailed package and run results, grouped or individual success messages, remaining-volume thresholds, confirmed download stalls, and recovery notifications.
- Persist notifications across restarts with bounded retries, rate-limit handling, FIFO delivery, shutdown recovery, and protection against transient disk-write failures.
- Store and export only fixed failure categories so local paths, URLs, provider accounts, and raw errors are excluded from Discord messages and support bundles.

### Hoster identification

- Show local 1Fichier and DDownload hoster icons with full names in tooltips throughout the download queue.

## [2.0.70] - 2026-08-24

### Real-Debrid browser accounts

- Generate unrestricted links through the authenticated Real-Debrid downloader form inside an isolated background browser session instead of routing browser accounts through the API-token path.
- Keep browser sessions separated per account, avoid background login popups, and recover safely from cancellation, page-load stalls, timeouts, renderer crashes, account disablement, deletion, and shutdown.
- Validate generated download URLs against Real-Debrid download hosts and preserve exact filenames and file sizes without accepting foreign or insecure targets.
- Report website login and provider errors clearly, reject multi-file folder links instead of silently returning an incomplete result, and keep API-token accounts unchanged.

### Download table

- Restore header sorting without interfering with column dragging and add sorting for the Service column.
- Sort packages from their currently visible rows and preserve definitive link availability across reset operations.
- Keep active, integrity-checked, and completed downloads visibly online when no separate availability result has been stored yet.

### Clipboard reliability

- Route link names, URLs, package batches, backup keys, diagnostics, error details, and masked account identifiers through the validated Electron clipboard writer.
- Support complete link-package copies up to one MiB and report failed clipboard writes instead of displaying false success messages.

### Item diagnostics

- Format new item-log start, event, and end timestamps as local `DD.MM.YYYY - HH:mm:ss` values while leaving machine-readable application, audit, package, and session logs unchanged.

## [2.0.67] - 2026-08-24

### Extraction stability

- Return archive extraction and package-status behavior to the verified v2.0.54 baseline after regressions in later releases.
- Keep the existing download, account, update, history, statistics, and backup capabilities from that stable baseline.

### 1Fichier and DDownload metadata

- Resolve public filenames, exact sizes, availability, and supported domain aliases before downloads start.
- Keep resolved filenames when a debrid provider later returns a generic `download.bin` name.
- Preserve partial-download resume paths while applying late metadata and safely rename completed files afterward.
- Recover interrupted metadata renames through an item-bound journal without adopting unrelated same-name files.
- Restrict DDownload redirects to HTTPS targets carrying the same file identity and keep challenge pages in an unknown state instead of marking them offline.

### Windows appearance

- Force the native Windows title bar to remain dark across local desktop, server, and Remote Desktop profiles.

## [2.0.54] - 2026-08-21

### Update validation

- Published a controlled follow-up version so installations running v2.0.53 can verify the repaired in-app updater handoff end to end.

## [2.0.53] - 2026-08-21

### In-app updates

- Started the verified NSIS installer directly before application shutdown so Windows Server and RDP process-job cleanup cannot terminate an intermediate PowerShell launcher.
- Kept the running application open when Windows rejects the installer process instead of reporting a successful update and quitting without an installer.
- Delegated the complete process handoff to the installer with a 60-second graceful wait and a verified post-termination wait before replacing application files.

## [2.0.52] - 2026-08-21

### Rolling account statistics

- Added a true rolling Last 24 Hours range directly after Today in Statistics.
- Attributed downloaded traffic to the exact Real-Debrid, Mega-Debrid, or Debrid-Link account that produced each direct link.
- Displayed the known account username with its provider while retaining safe fallback labels for accounts without checked identity data.
- Kept the rolling total accurate across midnight, account disablement, deletion, application restarts, and session-statistics resets.
- Started exact rolling account collection after the upgrade without inventing historical account ownership from older daily totals.

### Statistics precision and performance

- Kept primary statistics data totals in gigabytes above 1 TB so large daily volumes remain precise, for example 1,250 GB instead of 1.2 TB.
- Stored traffic in sparse minute buckets with a bounded 48-hour retention window.
- Maintained the visible 24-hour aggregate incrementally and kept raw minute history out of frequent renderer snapshots.
- Preserved full rolling history in encrypted full backups while removing account IDs and labels from support statistics.

## [2.0.51] - 2026-08-21

### In-app updates

- Refreshed the latest release metadata immediately before every installer download instead of reusing a previous update check.
- Read the running version from the installed package metadata so the displayed version cannot lag behind the installed application.
- Added a release gate that rejects packaged main bundles built for an older version.
- Kept a dismissed update prompt closed for the same target version until the next application start while still allowing newer releases and manual checks to appear.
- Changed the Update available button from blue to green.

### Release verification

- Added real Windows process-order and installed-package version coverage for the complete update handoff.
- Required a fresh application build after the release version changes before packaging the installer.

## [2.0.50] - 2026-08-21

### In-app updates

- Deferred silent installer startup until the current application process has fully exited so the new version can acquire the single-instance lock.
- Added an installer-level process handoff that also protects upgrades launched by v2.0.48 and v2.0.49.
- Reduced the delay between a verified update download and application shutdown from five seconds to 250 milliseconds.
- Added Windows process-order regression coverage and made the public release verifier require the update-safe NSIS include.

## [2.0.49] - 2026-08-21

### Download table

- Added a right-click column menu with a one-step reset to the default column layout.
- Clarified visible-column state with green checkmarks, normal menu text, and a centered reset action.
- Kept availability labels aligned across one- and two-digit package counts while reducing excess spacing before the online state.

### Account status

- Added the last successful or failed account-check time directly below each stored status.
- Updated relative check times automatically while the application remains open.
- Changed expired premium access to the existing Free Account state instead of leaving stale Premium active text visible.

### History

- Updated an already open History view immediately after a completed or deleted package is stored without polling or repeatedly reloading the full history file.
- Removed multi-selected history entries through one validated IPC request and one atomic history-file update.
- Preserved configured history limits above 500 entries during single and bulk removal operations.

### Remaining volume

- Added a translated hover explanation when the remaining download volume contains files whose sizes are not known yet.
- Kept fully known queues unchanged while exposing the same explanation to assistive technology.

## [2.0.48] - 2026-08-20

### Download table

- Eliminated brief flicker and snap-back when moving download columns left or right.
- Made column moves respond immediately while keeping transitions smooth and column widths stable.
- Kept column move controls vertically centered throughout the animation.
- Prevented live download updates, rapid repeated moves, and in-flight settings saves from reverting the selected column order.
- Applied column changes instantly when animations are disabled.

## [2.0.47] - 2026-08-20

### Live updates

- Standardized running download snapshots and progress metrics on a 750 ms cadence for every queue size.
- Aligned session volume, remaining volume, speed, ETA, the header speed sparkline, and the bandwidth chart to the same refresh interval.
- Removed the extra active-download renderer delay so the UI presents each completed snapshot immediately without stacking latency.
- Prevented normal progress updates from retriggering rolling metric transitions before the previous transition can finish.

## [2.0.46] - 2026-08-20

### Archive passwords

- Restored the saved archive password list automatically when the Extraction settings section is opened.
- Kept the visible password list intact after settings saves, account updates, and live state refreshes.
- Prevented late password-list loads from overwriting unsaved edits and invalidated stale loads during backup imports.
- Kept archive passwords out of general renderer snapshots and exposed them only through a dedicated trusted IPC channel.

## [2.0.45] - 2026-08-19

### Account availability

- Kept a configured Real-Debrid account pool authoritative when every account is disabled instead of reviving legacy browser-login fields.
- Released stale in-memory Real-Debrid cooldown and sticky state when an account is explicitly re-enabled so the Start action becomes available without restarting the application.
- Preserved configured per-account daily limits and usage while refreshing only transient runtime state.

## [2.0.44] - 2026-08-17

### Live updates

- Reduced visible download, remaining-volume, speed, ETA, and availability refresh churn for queues with 250 or more items by using a calm 500 ms cadence.
- Updated live speed sparklines and the bandwidth chart to redraw every 500 ms instead of every 250 ms.
- Kept small queues responsive and retained the stronger 700 ms protection for queues with 1,500 or more items.

## [2.0.43] - 2026-08-16

### Product identity

- Renamed the packaged application, installer, portable executable, support bundles, update repository, and public download references to Multi-Debrid-Downloader.
- Migrated the legacy application data directory automatically so existing settings, accounts, queue state, history, statistics, and runtime logs remain available after the rename.
- Preserved the existing Windows application identity to support in-place updates while retaining the legacy data directory as a safe fallback when Windows temporarily blocks the migration.
- Updated diagnostics, exported link headers, host checks, user agents, release verification, and public documentation to use the current product name.

### Account runtime

- Added a Runtime tab to account management with provider summaries for available accounts, active downloads, and daily traffic.
- Added per-account runtime details for current state, active downloads, daily traffic, session success rate, last use, and cooldown or skip reason.
- Kept API and browser accounts with matching identifiers isolated by provider and access mode throughout runtime attribution.
- Removed runtime counters for deleted accounts and limited renderer data to sanitized states and aggregate counters without credentials, API responses, or raw provider errors.

## [2.0.42] - 2026-08-15

### Real-Debrid accounts

- Added support for multiple Real-Debrid API-token and browser-login accounts in the same account pool.
- Kept every browser account in an isolated persistent or transient session so cookies, tokens, login windows, and queued actions cannot leak between accounts.
- Added independent account activation, daily limits, daily usage, lifetime usage, status records, identity details, editing, removal, and credential reveal controls.
- Migrated existing single-account Real-Debrid settings and browser sessions into the new pool without discarding saved credentials or account status.
- Assigned opaque account identifiers and kept API tokens, browser tokens, cookies, and credential-derived fingerprints out of renderer state and diagnostics.

### Rotation and recovery

- Rotated eligible Real-Debrid API and browser accounts with fair ordering, sticky reuse, in-flight exclusion, account cooldowns, and daily-limit enforcement.
- Continued within the same conversion request after account-specific authentication, rate-limit, timeout, and transport failures.
- Kept provider-wide hoster failures and permanent link failures from cooling down or rotating otherwise healthy accounts.
- Attributed downloaded traffic to the exact account that generated the unrestricted link while preserving provider-wide totals.
- Rebuilt account rotation state immediately after live account, credential, enablement, or limit changes.

### Account checks and login behavior

- Refreshed an account before enabling it and rolled the toggle back when the account is invalid or cannot be checked.
- Preserved Real-Debrid usernames and email addresses independently in browser-account status rows.
- Prevented manually closed Real-Debrid login windows from reopening through queued or repeated work.
- Restricted browser window creation to explicit login actions so activation, status checks, downloads, missing sessions, and fair-use failures remain noninteractive.
- Cleaned up aborted, failed, deleted, and superseded browser sessions without allowing delayed probes to restore stale tokens or status records.

### Interface and downloads

- Added precise service filtering and alphabetical service ordering to the account-add dialog.
- Kept Real-Debrid API and browser-login choices available after another Real-Debrid account has already been configured.
- Continued link availability checks after downloads start so items cannot remain stuck on Checking while actively downloading.
- Added account-specific login, check, edit, enable, disable, remove, and reveal actions throughout the settings interface.

## [2.0.41] - 2026-08-15

### Accounts

- Split account refresh into active-account and all-account checks with matching result counts.
- Show failed check results for disabled accounts when all configured accounts are refreshed.
- Apply individual and bulk account enablement changes immediately while settings are saved, with automatic rollback after a failed save.
- Re-enable parent providers and Mega-Debrid modes when an individual disabled account or API key is enabled.
- Disable the active-account refresh action when no enabled checkable account exists.
- Added Windows-style account selection with Ctrl or Command, selected-account counts, batch removal, and global Escape clearing.
- Removed the redundant global account activation switch so individual account toggles remain authoritative.
- Added persistent, resizable account-table columns and retained their widths across restarts.
- Moved the account-enabled control below the daily limit field in the account editor.
- Added an explicit reveal action for stored credentials while keeping secrets out of renderer snapshots, diagnostics, and copied account details.
- Kept credential reveal requests scoped to the selected account and validated through the trusted application boundary.
- Stored Debrid-Link usernames and email addresses separately and migrated legacy cached identities that placed usernames in the email column.
- Kept missing Debrid-Link email addresses empty instead of duplicating another identity field.
- Simplified username and email tooltips to show only the copy action while preserving accessible labels.
- Added a dedicated Action column with stable edge alignment across window sizes and resizable table layouts.
- Kept account selections visually distinct without leaving a stale focus outline after Escape.
- Prevented double-clicking an account action button from opening the account editor behind its context menu.
- Simplified account menu headings to one hoster and access-type label without dangling separators or empty identity fields.

### Downloads and queue controls

- Moved the Remaining metric above the all-time Total value in the download summary.
- Kept the currently selected priority as a disabled no-op so choosing it does not close the package context menu.
- Reordered high, standard, and low priority packages consistently while preserving stable order inside each priority group.
- Added smooth package movement when priority changes and extended the reorder transition to three seconds for easier visual tracking.
- Renamed the package-only motion preference to a general animation setting shared by package disclosure, priority movement, and history details.
- Cancelled active package movement immediately when animations are disabled.
- Removed phantom horizontal and vertical scrollbars from newly opened package context menus.
- Moved the cleanup confirmation opt-out below the dialog actions and aligned the decision controls consistently.

### Statistics

- Added a durable daily statistics ledger for downloaded data, completed files, failed results, active transfer duration, and provider outcomes.
- Made Today, Seven Days, and 30 Days aggregate every available day immediately instead of waiting for a complete calendar window.
- Preserved existing all-time counters while extending totals with newly recorded success, failure, duration, and provider result metrics.
- Added real file counts, success rates, average transfer speed, failure counts, and provider result totals to ranged statistics.
- Kept daily statistics bounded and normalized during load, save, backup export, and restore.

### History and interface

- Rebuilt the history table around one shared resizable grid so headers, rows, expanded details, and horizontal scrolling stay aligned.
- Persisted history column widths and kept them responsive across compact and wide windows.
- Anchored the history Action column to the table edge and aligned size values directly below their header.
- Reworked expanded history details into a cleaner grouped surface for provider, files, duration, average speed, target folder, and source URLs.
- Added smooth history expand and collapse motion governed by the general animation preference.
- Kept history disclosure immediate when animations are disabled.

## [2.0.40] - 2026-08-15

### Interface

- Fixed package rows continuing to slide after package expand and collapse motion was disabled in Settings.
- Applied the no-motion preference immediately to virtual row positions, heights, and opacity.

## [2.0.39] - 2026-08-15

### Settings

- Fixed settings saves after upgrades when account status records or legacy renderer data omit optional fields.
- Restored download starts and account actions that persist settings before continuing.

## [2.0.38] - 2026-08-15

### Interface

- Added a general setting to disable package expand and collapse motion on remote or lower-performance systems while keeping it enabled by default.

## [2.0.37] - 2026-08-14

### Account status

- Added persistent Real-Debrid API and browser-session account checks with premium status and account identity details.
- Updated the Real-Debrid account row automatically after a successful browser login and preserved the result across settings saves and restarts.

### Provider errors

- Limited failed conversion messages to providers that were actually attempted.
- Prevented aggregated fallback details from being mislabeled as a Debrid-Link failure.

### Interface

- Replaced the application and documentation artwork with the refreshed Multi-Debrid Downloader icon.
- Made populated username and email cells copy their value to the clipboard with a single click while keeping empty cells inactive.

### Downloads

- Restored smooth package expand and collapse motion without disabling large-queue virtualization.
- Kept package contents mounted throughout collapse transitions, including packages crossing the visible viewport boundary.
- Added a Remaining metric for unfinished download volume, with a lower-bound indicator when some file sizes are still unknown.

## [2.0.36] - 2026-08-14

### Download performance

- Restored the proven 2.0.28 download-processing baseline after later builds caused severe throughput drops and prolonged disk-wait states during large parallel queues.
- Removed the per-chunk stream failure race that accumulated pending promise reactions throughout long-running downloads.
- Preserved the startup reliability, credential protection, storage safeguards, large-queue virtualization, and updater behavior included in 2.0.28.

### Release safety

- Rebuilt the Windows installer and portable package from the verified rollback branch.
- Revalidated the complete client and backup API test suites before publication.

## [2.0.28] - 2026-08-12

### Startup reliability

- Fixed Electron security registration so native WebContents and session APIs retain their required receiver during application startup.
- Fixed packaged renderer IPC validation for case-insensitive Windows file paths.
- Added explicit startup and renderer-load error logging for future launch diagnostics.

## [2.0.27] - 2026-08-12

### Startup reliability

- Fixed Windows renderer startup validation so the packaged application accepts its own local renderer path regardless of path casing.
- Prevented the startup navigation guard from blocking the application window on case-insensitive Windows file systems.

## [2.0.26] - 2026-08-12

### Log storage

- Added a configurable log location in AppData or in a dedicated Desktop folder.
- Migrated recognised log files safely when changing location while keeping settings, credentials, and runtime data in AppData.
- Preserved active trace settings during log migration and routed startup recovery diagnostics to the selected log location.

## [2.0.25] - 2026-08-12

### Credential and application security

- Encrypted persisted provider credentials with the operating system credential protection and migrated legacy plaintext values safely.
- Removed provider secrets from renderer snapshots, account-check responses, settings backups, support diagnostics, and copied account details.
- Added passphrase-protected local backup encryption while keeping legacy backup import available without writing the legacy format again.
- Hardened Electron navigation, redirects, permissions, popup handling, remote-login windows, and IPC sender validation.
- Restricted remote diagnostics to loopback by default, Bearer authentication, POST-only mutations, rate limiting, non-cacheable responses, and token-free support URLs.

### Storage reliability

- Added volume-aware capacity reservations before download writes, archive extraction, and media remux operations.
- Accounted for concurrent reservations and a configurable safety margin so parallel work cannot overbook the same volume.
- Parked capacity-blocked work without consuming regular retry attempts and exposed structured disk-wait state for automatic recovery.

### Large queue performance

- Virtualized package and file rows with fixed row heights and overscan to keep very large queues responsive.
- Preserved logical range selection, select-all behavior, column dragging, context actions, expansion state, and inline renaming outside the rendered viewport.
- Kept the existing scroll container and limited DOM work without adding another runtime dependency.

### Status and reliability

- Removed archive names from visible finalization progress in both German and English while retaining compact phase progress.
- Added focused regression coverage for credential migration, backup encryption, Electron trust boundaries, diagnostics authentication, disk reservations, and virtualized download rows.

## [2.0.24] - 2026-08-11

### Download queue

- Kept every package in its existing visible queue position when downloads start, finish, pause, retry, or change status.
- Removed status-driven package grouping and the obsolete automatic progress-sorting setting.
- Blocked start, package start, item start, and resume actions when no active usable download account is available.
- Kept the initial Start action disabled until the main process confirms that an eligible account is active.

### Disk and extraction recovery

- Added a dedicated disk-wait recovery path for full, quota-limited, temporarily busy, and stalled write targets.
- Retried disk-blocked downloads automatically after storage becomes writable without consuming the normal download retry budget.
- Prioritized `Waiting for disk` at package level when one or more files are blocked by storage.
- Reported completed downloads with extraction failures as failed packages instead of showing a misleading completed file count.
- Removed redundant provider names from start, download, data-wait, and disk-wait status labels while preserving diagnostic details.

### Reliability and testing

- Added regression coverage for unavailable and disabled accounts, resume protection, disk-write recovery, retry accounting, package-level disk waits, extraction failures, compact runtime statuses, and stable queue ordering.
- Verified the complete client suite, TypeScript compilation, production build, release metadata, archive contents, and application self-check.

## [2.0.23] - 2026-08-11

### Update experience

- Changed the available-update header action to a dedicated light-blue treatment with dark high-contrast text.
- Added cumulative release notes for every stable version newer than the installed application, ordered from newest to oldest.
- Excluded draft releases, prereleases, the installed version, and older versions from cumulative update notes.
- Added a bounded vertical scroll area so long multi-version changelogs remain usable without overflowing the update dialog.

### Download queue

- Unified RapidGator main and short-link domains under one host identity for icons, host counts, routing, limits, and cooldowns.
- Centered service and status values beneath their corresponding column headings.
- Removed archive filenames from visible password-cracking progress while retaining full technical details in the status tooltip.
- Kept active packages in their activation order and appended newly active packages behind downloads that were already running.
- Removed status-driven automatic package expansion so collapse state changes only through explicit user actions.

### Account handling

- Separated Mega-Debrid API and Web Login credential pools so adding, editing, disabling, or removing one mode no longer changes the other mode.
- Migrated legacy shared Mega-Debrid credentials and disabled-account states into the explicitly enabled access mode, falling back to the preferred mode only for ambiguous legacy configurations.
- Kept mode-specific account availability and provider selection synchronized with live settings changes.
- Applied added, edited, disabled, and re-enabled Mega-Debrid accounts to the active scheduler without requiring an application restart.
- Invalidated cached Mega-Debrid Web Login sessions immediately when Web credentials change, prevented older in-flight, retried, and queued requests from restoring invalidated cookies, and left API-only changes isolated.
- Released only Mega-Debrid reset-parked queue items when a usable account pool becomes available while preserving unrelated retry delays.
- Prevented new Mega-Debrid account forms from exposing stored credentials in an unrelated token field.
- Removed both mode-specific Mega-Debrid credential pools from persisted settings when credential storage is disabled.
- Synchronized item and package status immediately when a provider retry is queued.

### Reliability and testing

- Kept the latest release notes as a fallback when the release history cannot be loaded.
- Added regression coverage for cumulative version filtering, ordering, update colors, changelog scrolling, RapidGator aliases, centered queue cells, compact password progress, independent Mega-Debrid API and Web Login pools, credential persistence, legacy migration, live session invalidation, live account-pool refresh, stable active ordering, and user-controlled package expansion.
- Verified the update dialog with twelve version sections at a 1120 by 760 pixel viewport.

## [2.0.22] - 2026-08-11

### History management

- Added a permanently visible destructive toolbar action for clearing the complete download history without selecting individual entries.
- Kept full-history deletion behind the existing confirmation dialog and disabled the action while history is empty or loading.
- Added complete English localization for the new history action.

### Reliability and testing

- Added regression coverage for full-history action visibility, danger styling, loading state, empty state, and dispatch behavior.
- Verified the updated History toolbar at 1920 and 1120 pixel window widths without horizontal overflow.

## [2.0.21] - 2026-08-11

### Responsive interface

- Refined Downloads, Link Collector, Settings, History, and Statistics layouts for 1920, 1366, and 1120 pixel window widths.
- Kept the Downloads action column reachable in compact windows while preserving useful space for names, status, service, speed, and availability.
- Moved the compact sidebar control into reserved header space so it no longer overlaps view content.
- Wrapped Link Collector search and actions cleanly at narrow widths without creating global horizontal scrolling.
- Reworked History pagination to keep the page size, information control, range, and navigation visible without overlap.

### Interaction and accessibility

- Added keyboard controls for moving Download columns and exposed sort state, mixed selection state, and active filters to assistive technology.
- Added keyboard-complete custom selectors, theme choices, account tabs, loading announcements, error announcements, and empty-search feedback in Settings.
- Added confirmation before removing collections or selected collection links, unique link-selection labels, and disabled empty collection submission.
- Added confirmation before resetting session or all-time statistics and accessible labels for the live bandwidth chart.
- Completed English localization for new pagination, account feedback, link-selection, and copy-control accessibility text.
- Replaced clickable text-only copy targets with native buttons and improved focus, control-border, success, warning, and danger contrast in both themes.

### Visual consistency

- Changed the live header speed graph and Statistics bandwidth line to the shared success green.
- Improved table-heading, progress, availability, account-status, and destructive-action contrast across all primary views.
- Preserved full service and status details through labels and tooltips when compact layouts require ellipsis.

### Reliability and testing

- Added regression coverage for compact table visibility, keyboard column movement, destructive confirmations, History pagination, accessible copy actions, Settings control states, and the updated chart colors.
- Expanded the visual verification matrix across every primary view at all supported audit widths.

## [2.0.20] - 2026-08-11

### Downloads and selection

- Added package selection through a normal row click while preserving Control, Command, and Shift selection behavior.
- Added package expansion and collapse through a double-click on unused row space while keeping the disclosure button available.
- Kept renaming, checkboxes, progress meters, links, form controls, and action buttons isolated from the row disclosure gesture.
- Replaced segmented selection markers with a continuous three-pixel success-colored edge across adjacent selected packages and files.
- Extended package selection markers across card separators so consecutive selected packages no longer show one-pixel gaps.

### Sidebar motion

- Removed the empty sidebar rail when the sidebar is collapsed.
- Added synchronized 520-millisecond width and panel transitions for smooth sidebar opening and closing.
- Kept the sidebar edge control visible and reachable while the sidebar content is fully hidden.
- Preserved the requested sidebar motion when Windows application animations are disabled.

### Reliability and testing

- Added regression coverage for zero-width sidebar collapse, synchronized sidebar motion, package row selection, double-click disclosure boundaries, and continuous selection markers.
- Added rendered-pixel verification for the updated interactions and continuous selection edge.

## [2.0.19] - 2026-08-11

### Interface fixes

- Restored smooth sidebar selection movement in development builds when React StrictMode restarts layout effects.
- Kept the active sidebar entry visible immediately while the shared selection marker moves to its new position.
- Disabled the service filter when fewer than two concrete services are available, preventing an empty or redundant dropdown from opening.

### Reliability and testing

- Added regression coverage for StrictMode transition initialization and service-filter availability states.

## [2.0.18] - 2026-08-11

### Downloads and status handling

- Preserved package byte totals, completed-item counts, and extraction progress when finished files are removed immediately from the queue.
- Persisted cleaned package contributions so progress remains stable across application restarts.
- Preserved final history file counts, byte totals, providers, and source URLs after immediate cleanup.
- Reset selected files and their package post-processing state atomically after extraction failures.
- Waited for cancelled extraction work and resume-state cleanup before restarting reset downloads.
- Replaced contradictory unchecked package availability counters with a compact unchecked state.
- Reduced extraction errors, pending extraction phases, password phases, and archive processing to concise visible status labels while retaining full diagnostics in tooltips and logs.
- Cleared stale archive labels before final package state notifications and history updates.
- Removed native whole-row dragging that could create a large drag preview while preserving header column reordering and explicit package move actions.
- Expanded inline package-name editing to the full available name-column width.

### Settings and account management

- Added history retention choices for the latest 100 or 250 entries.
- Kept permanent history retention selectable after using a bounded history preset.
- Replaced native settings selectors with smooth, keyboard-accessible dropdowns for consistent opening and closing motion.
- Reworked account creation into a compact searchable service table with separate service and access-type columns.
- Displayed only the credentials required by the selected account type.
- Separated usernames and email addresses in the account overview so verified email data no longer replaces a stored username.
- Kept Mega-Debrid access types explicit as `Mega-Debrid (API)` and `Mega-Debrid (Web)`.

### Interface fixes

- Centered the package sidebar heading and added a high-contrast light-blue module accent.
- Positioned context menus and nested menus before they become visible, preventing first-frame jumps at window edges.
- Closed open context menus immediately when another package or file is clicked.
- Kept context menus inside narrow application windows without introducing horizontal overflow.

### Reliability and testing

- Added regression coverage for cleanup-safe package progress, persisted progress aggregates, extraction reset state, compact availability, extraction diagnostics, native drag suppression, full-width renaming, animated settings selectors, account identity fields, and viewport-safe context menus.

## [2.0.17] - 2026-08-10

### Interface fixes

- Added smooth horizontal opening and closing transitions to the Backup, Logs, Remote Support, and Diagnostics submenus.
- Kept nested menus mounted during closing so their exit motion remains visible instead of disappearing immediately.
- Preserved left-side submenu placement in narrow windows without restoring horizontal overflow.
- Removed hidden submenu actions from keyboard navigation and respected reduced-motion preferences.
- Simplified Mega-Debrid API service labels by removing redundant access-mode suffixes while retaining the complete source label as a tooltip.
- Reduced download and extraction status cells to the active operation and percentage while keeping diagnostic details in tooltips.

### Reliability and testing

- Branded the development Electron executable with the application name, version metadata, and product icon for Windows system dialogs.
- Made development launches resilient to stale executable locks by isolating each runtime executable.
- Added regression coverage for persistent nested-menu rendering, hidden interaction states, and the shared submenu transition.
- Added a Windows regression check for development executable metadata.

## [2.0.16] - 2026-08-10

### Downloads and telemetry

- Started bandwidth-history collection with the active download session instead of waiting for the Statistics view to be opened.
- Kept the latest 60 seconds of speed samples available when Statistics is opened later.
- Updated the sidebar link counter immediately as individual files finish, fail, or leave the active queue.
- Added locale-aware thousands separators to package, link, and hoster counters.

### Interface fixes

- Kept nested application-menu entries visible in narrow windows without introducing a horizontal scrollbar.
- Opened nested right-side menus toward the available left side of the application frame.
- Changed enabled settings switches to the semantic success color.
- Changed online file indicators to the semantic success color.
- Removed overlapping light text fragments from the dark-on-green progress labels and strengthened their weight.
- Made service and status labels react to their actual column width, with compact labels and complete accessible names and tooltips.
- Shortened Mega-Debrid service labels in narrow columns while preserving the full account description as a tooltip.

### Reliability and testing

- Added regression coverage for background bandwidth sampling, 60-second history trimming, nested menu overflow, enabled switch colors, progress-label clipping, responsive service/status cells, immediate queue counts, and localized sidebar counters.

## [2.0.15] - 2026-08-10

### Highlights

- Unified live speed reporting across the header, package table, and sidebar with a single telemetry source and consistent two-decimal formatting.
- Reworked account creation into one clear service and access-type selector with the relevant credentials form directly below it.
- Improved dense download views with responsive status labels, clearer progress text, and safer package expansion behavior.

### Downloads and telemetry

- Removed the redundant Add links toolbar action so Start is now the first download control.
- Removed the additional renderer delay for large active queues, allowing manager telemetry to appear without a second buffering interval.
- Kept the header sparkline, package speeds, and sidebar speed synchronized from the same package telemetry snapshot.
- Preserved known file sizes when an unrestrict response does not provide a replacement size, preventing temporary queue-total drops when a download starts.
- Restricted package expansion and collapse to the visible disclosure button so ordinary row clicks no longer change the package state.
- Added compact window labels for link conversion, active downloads, and extraction while retaining complete status details in tooltips and accessibility labels.
- Removed duplicated access-mode wording from Mega-Debrid service labels while preserving the complete source label as a tooltip.

### Interface and accessibility

- Added clipped dual-color progress labels so text remains light over the unfilled track and dark over the green fill.
- Added a dedicated orange bandwidth-chart accent with a restrained matching area fill.
- Changed active premium account indicators to the success color.
- Kept the File, Settings, and Help menus inside the application frame at narrow window widths.
- Added semantic progressbar values and accessible labels to package and file size/progress meters.

### Settings and accounts

- Replaced the expandable account-type list with a single service/access selector.
- Displayed the selected account type description and exactly one matching credentials form.
- Retained the existing account validation, protected secret fields, and save flow.

### Reliability and testing

- Added regression coverage for stable file-size transitions, unified speed telemetry, responsive status presentation, service-label cleanup, progress contrast, package disclosure behavior, account selection, premium status colors, chart colors, toolbar ordering, and narrow application menus.

## [2.0.14] - 2026-08-10

### Highlights

- Added immediate English/German language switching across the complete interface. New installations now start in English, while existing installations retain their previous language behavior until changed.
- Added RapidGator file-size discovery before downloads start and accelerated large queue checks with bounded parallel requests.
- Added package and file availability states with aligned online counters, clear colors, and automatic migration of existing column layouts.
- Reworked the Downloads workspace for substantially denser queues, smoother interaction, clearer selection, and responsive column sizing.
- Rebuilt the project README with current documentation and a sanitized screenshot of the application.

### Downloads workspace

- Reduced package rows to 40 pixels and file rows to 38 pixels so more queue entries fit on screen.
- Removed the previous blue package-card treatment in favor of flat rows and restrained separators.
- Changed progress fills to green and unified package/file value contrast.
- Added stable minimum widths and proportional column distribution so labels and values remain readable at normal window sizes.
- Centered all data columns while preserving left alignment for package and file names.
- Increased the action column width and reserved scrollbar space to prevent clipping.
- Normalized expand buttons to a fixed 30 × 30 pixel footprint.
- Added a 300 ms measured expand/collapse animation for package files.
- Added smooth, pointer-based full-column reordering. The dragged header and every visible cell move together while neighboring columns glide aside.
- Added persistent column-order migration with the new Availability column.
- Added RapidGator and DDownload hoster icons with full-name tooltips and text fallback for unknown hosters.

### Availability and metadata

- Added package-level online counters with separate online, partial, offline, and checking states.
- Added file-level Online and Offline indicators.
- Aligned availability symbols, counts, separators, and labels on fixed axes.
- Read RapidGator file names and sizes from the public file page without creating a debrid download.
- Replaced sequential link checks with bounded concurrency and duplicate-request sharing.
- Improved retry behavior for transient RapidGator metadata failures.
- Updated known file and package sizes while the queue is checked.
- Corrected the sidebar Total value to represent the current queue instead of the historical all-time download counter.

### Selection and package controls

- Fixed global Select all and Deselect all synchronization for memoized package rows.
- Increased selection checkboxes to 18 × 18 pixels.
- Added a green selected-row background and a clear left selection edge.
- Added Shift range selection across visible package and file rows.
- Added Escape handling to clear the complete selection, including when a checkbox has focus.
- Removed the redundant package activation checkbox; activation remains available through context actions.
- Preserved additive Ctrl/Command selection and bulk actions.

### Navigation and animation

- Added a shared sliding selection indicator to the main navigation.
- Added matching sliding indicators to Downloads filters, Settings sections, History ranges, and Statistics periods.
- Fixed initial category selection so newly opened views appear selected immediately instead of fading in from an empty state.
- Preserved intentional interface animations when the operating system requests reduced motion.
- Added slide-in and slide-out transitions to the File, Settings, and Help menus.
- Kept menu panels within the application window at narrow widths.
- Added rolling number transitions for package, link, session, total-size, and hoster statistics.

### Interface and layout

- Added the application icon and a bordered product identity area to the main header.
- Standardized sidebar geometry across Link collector, Settings, History, and Statistics.
- Reworked Downloads sidebar actions as permanently recognizable bordered buttons.
- Moved Monitor clipboard directly above the statistics panel, added the same button surface, and reduced the lower gap.
- Made clipboard toggling optimistic so the checkbox responds immediately and safely rolls back on an IPC failure.
- Hid the redundant Files display mode and retained a focused package workflow.
- Improved header, menu, account-table, progress-value, and status text contrast.
- Unified the speed indicator with the rest of the application shell.
- Fixed duplicated Speed wording in the Downloads sidebar summary.

### Localization

- Added persistent `English` and `Deutsch` language settings.
- Localized navigation, menus, settings, dialogs, notifications, tooltips, empty states, status labels, history entries, pagination, and update flows.
- Fixed remaining German history statuses appearing while English was selected.
- Kept existing installations compatible while setting English as the default for new installations.
- Localized manual update checks and the GitHub release changelog display.

### History, settings, and accounts

- Matched History action buttons to the Downloads action-button design.
- Centered History column headings except Package / File.
- Changed removed history entries to red and completed entries to green.
- Unified account-table header text with the primary high-contrast text color.
- Kept Account Overview and Usage Rules within a stable viewport layout.
- Aligned the update-check action to the right and kept Save settings visibly disabled when no changes are pending.

### Development and reliability

- Assigned the downloader development server a fixed port to prevent another Electron project from being opened accidentally.
- Added strict development URL resolution for the correct Vite instance.
- Packaged the application icon as an unpacked resource and resolved it from the correct development or installed path for window and tray use.
- Improved settings migration for language and column-order versions.
- Added regression coverage for localization, availability, column dragging, navigation indicators, queue totals, metadata checks, selection, clipboard behavior, and responsive layout contracts.

## [2.0.13] - 2026-08-10

- Rebuilt the primary desktop workspace across Downloads, Link collector, Settings, History, and Statistics.
- Added compact navigation, contextual sidebars, dense data tables, account management improvements, and responsive layouts.
- Improved update visibility, dialogs, context menus, notifications, keyboard focus, error recovery, and theme behavior.

## [2.0.12] - 2026-08-10

- Prevented static Settings text from being selected while keeping editable fields selectable.

## [2.0.11] - 2026-08-10

- Stabilized the account-management layout when switching between Overview and Usage Rules.
