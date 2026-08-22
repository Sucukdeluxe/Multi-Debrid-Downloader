# Notification Center v2 Final Fix Report

## Status

PASS.

Alle Findings der finalen Whole-Branch-Prüfung wurden in einer testgetriebenen Fixwelle behoben. Es wurden keine Subagents eingesetzt, keine fremden Änderungen zurückgesetzt und keine alten ungetrackten Release-, Audit-, Stage- oder Build-Verzeichnisse verändert.

## Behobene Findings

### Globales Shutdown-Deadlinebudget

- `AppController.shutdown()` verwendet ein gemeinsames Deadlinebudget von 3000 ms.
- Health-Timer, Runtime-Timer und weitere Produzenten werden zuerst gestoppt.
- Eine bereits laufende Health-Auswertung, die finale Health-Auswertung, der Digest-Flush und der Outbox-Drain teilen sich dasselbe Restbudget.
- `DownloadManager.prepareForShutdown()` läuft vor Digest-Flush und Drain.
- Ein blockierter Discord-Versand blockiert neue Outbox-Persistenz nicht mehr.
- Ein Paket-Digest, der erst während des Shutdown-Fensters final wird, wird sofort in die persistente Outbox geschrieben.

### Delivery-Ack und Stall-Cooldown

- `NotificationOutbox` meldet ausschließlich erfolgreiche tatsächliche Zustellungen mit Event und realem Zustellzeitpunkt zurück.
- `DownloadHealthMonitor` startet den Stall-Cooldown erst mit diesem Zustellzeitpunkt.
- Ein während eines Discord-Ausfalls gepufferter Stall bleibt über seine stabile Event-ID dedupliziert.
- Health-Samples und Delivery-Acks werden serialisiert, sodass keine veraltete Sample-Persistenz einen gerade gesetzten Cooldown überschreibt.
- Wiederholte Acks derselben stabilen Stall-ID sind idempotent.
- Ein fehlgeschlagener Health-Ack führt weder zur erneuten Discord-Zustellung noch zur Blockade nachfolgender Outbox-Ereignisse.
- Persistierte Ack-IDs werden strikt auf das interne Stall-ID-Format begrenzt.

### Atomare Legacy-Outbox-Bereinigung

- Eine vorhandene Outbox-Datei wird beim Laden sofort in den bereinigten kanonischen Zustand zurückgeschrieben.
- Abgelaufene und ungültige Ereignisse verschwinden auch dann atomar auf Disk, wenn danach keine Queue-Einträge verbleiben.
- Private Legacy-Felder und private Fehler-Sentinels verbleiben nicht bis zum nächsten Enqueue oder Drain in der Datei.

### Ereignis-TTL

- `run_completed` besitzt unabhängig von seiner Erfolgs- oder Fehlerpriorität immer eine TTL von 24 Stunden.
- Paket-Erfolgsmeldungen behalten ihre sechs Stunden TTL.

### History-Dedup

- Das autoritative finale `PackageResult` markiert das Paket unmittelbar als fachlich im Verlauf erfasst.
- Eine anschließende manuelle Paketlöschung erzeugt keinen zweiten `deleted`-Verlaufseintrag.
- Ein echter Reset entfernt die Markierung weiterhin für eine neue Ergebnisgeneration.

### Postprocess-Startzeit

- `postProcessStartedAt` wird nicht mehr aus `postProcessQueuedAt` erfunden.
- Wenn ein Paket nie einen Postprocess-Slot erhalten hat, bleiben Startzeit und Postprocess-Dauer bei 0.

## TDD-Nachweis

Erster RED-Lauf:

```text
Test Files  4 failed (4)
Tests       9 failed | 76 passed (85)
```

Die neun erwarteten Fehler belegten das bisherige Verhalten für Deadline, späte Digest-Persistenz, blockierenden Send/Enqueue-Lock, fehlenden Delivery-Ack, zu frühen Cooldown, Legacy-Datei, Erfolg-Run-TTL, History-Doppelentry und erfundenen Postprocess-Start.

Zusätzliche gezielte RED-Läufe belegten:

- ein nach begonnenem Shutdown-Flush finalisierter Digest blieb zunächst nur im Speicher;
- ein Ack-Fehler blockierte nachfolgende Outbox-Ereignisse;
- eine frei gesetzte Ack-ID gelangte in die Health-Datei;
- ein paralleler Recovery-Sample konnte einen Delivery-Cooldown überschreiben.

Alle jeweiligen GREEN-Läufe bestanden nach der minimalen Produktionskorrektur.

## Finaler fokussierter Gate

```text
.\node_modules\.bin\vitest.cmd run tests\notification-outbox.test.ts tests\download-health-monitor.test.ts tests\notify-hooks.test.ts tests\download-manager.test.ts tests\session-restart-loss.test.ts tests\main-shutdown-lifecycle.test.ts
Test Files  6 passed (6)
Tests       344 passed (344)
Duration    163.36s
Exit        0
```

Enthalten:

- Notification Outbox: 22 Tests
- Download Health Monitor: 34 Tests
- Notification Hooks: 27 Tests
- Download Manager: 240 Tests
- Session Restart/Loss: 16 Tests
- Main Shutdown Lifecycle: 5 Tests

TypeScript:

```text
.\node_modules\.bin\tsc.cmd --noEmit
Exit 0
```

Diffprüfung:

```text
git diff --check
Exit 0
```

Vitest meldete ausschließlich die bereits vorhandene Vite-CJS-Node-API-Deprecation-Warnung. Es gab keine Testfehler, unbehandelten Ablehnungen oder Timer-Leak-Meldungen.

## Geänderter Scope

Produktionsdateien:

- `src/main/app-controller.ts`
- `src/main/notification-outbox.ts`
- `src/main/download-health-monitor.ts`
- `src/main/notification-events.ts`
- `src/main/download-manager.ts`

Tests:

- `tests/notification-outbox.test.ts`
- `tests/download-health-monitor.test.ts`
- `tests/notify-hooks.test.ts`
- `tests/main-shutdown-lifecycle.test.ts`

Bericht:

- `.superpowers/sdd/2026-08-22-notification-center-v2/final-fix-report.md`

## Restbedenken

Keine offenen bekannten Korrektheitsfehler innerhalb des beauftragten Scopes. Der Discord-Transport kann eine Zustellung bei einem Prozessabbruch exakt zwischen externer HTTP-Annahme und lokaler atomarer Entfernung grundsätzlich nicht transaktional mit Discord koordinieren; stabile IDs und die persistente FIFO-Outbox begrenzen dieses unvermeidbare externe Exactly-once-Fenster.
