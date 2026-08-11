# Changelog

All notable changes to Multi-Debrid Downloader are documented in this file.

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
