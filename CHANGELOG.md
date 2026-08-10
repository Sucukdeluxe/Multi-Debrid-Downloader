# Changelog

All notable changes to Multi-Debrid Downloader are documented in this file.

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
