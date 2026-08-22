# Notification Outbox In-Flight Fix

## Status

Abgeschlossen auf `feature/notification-center-v2`.

Commit-Betreff: `fix(notifications): preserve in-flight outbox events`

## Ursache

`NotificationOutbox.performDrain()` wählte das nächste Event unter der Exclusivkette aus, führte `sendEvent(current)` danach aber außerhalb dieser Kette aus. Während der Send wartete, konnte ein paralleles `enqueue()` über `persist()` und `enforceLimits()` genau dieses Event wegen Ablauf oder Kapazitätsgrenze aus der Queue entfernen. Die anschließende Ergebnisverarbeitung fand die Objekt-ID nicht mehr. Dadurch gingen bei einem Fehler Retry-Zustand und Fehlerzeit verloren; bei einem Erfolg entfielen Erfolgszeit, `onDelivered` und der daran gekoppelte Cooldown.

## TDD RED

Command:

```text
node_modules\.bin\vitest.cmd run tests\notification-outbox.test.ts
```

Result: Exit 1. Zwei neue Regressionstests schlugen erwartungsgemäß fehl, 22 bestehende Tests bestanden.

- Ein langsamer erfolgreicher Send wurde während eines parallelen Enqueue ablaufbedingt entfernt; der Delivery-Ack blieb aus.
- Ein langsamer fehlgeschlagener Send wurde während eines parallelen Enqueue durch das 250er-Limit entfernt; der Retry wurde nicht gespeichert.

## Umsetzung

- Das exakt ausgewählte Event wird während des externen Sends als In-Flight-Objekt reserviert.
- Ablaufbereinigung und Kapazitäts-Eviction überspringen ausschließlich dieses Objekt.
- Die Ergebnisverarbeitung findet das reservierte Objekt über Identität, verarbeitet Erfolg oder Fehler genau einmal und löst den Schutz innerhalb derselben Exclusivoperation vor dem abschließenden Persistieren.
- Nach einem Erfolg wird das Event entfernt und `onDelivered` mit der tatsächlichen Ergebniszeit ausgeführt.
- Nach einem Fehler bleiben Versuchszähler, Retry-Termin und Fehlerzeit erhalten, sofern das Event nach der Ergebniszeit noch gültig ist.

## GREEN und Verifikation

Command:

```text
node_modules\.bin\vitest.cmd run tests\notification-outbox.test.ts tests\download-health-monitor.test.ts
```

Result: Exit 0. Zwei Testdateien mit 58 von 58 Tests bestanden.

Command:

```text
node_modules\.bin\tsc.cmd --noEmit
```

Result: Exit 0, keine Ausgabe.

Command:

```text
git diff --check -- src/main/notification-outbox.ts tests/notification-outbox.test.ts
```

Result: Exit 0, keine Ausgabe.

## Geänderte Dateien

- `src/main/notification-outbox.ts`
- `tests/notification-outbox.test.ts`
- `.superpowers/sdd/2026-08-22-notification-center-v2/inflight-fix-report.md`

## Bedenken

Keine offenen funktionalen Bedenken. Vitest zeigt ausschließlich die bereits vorhandene Deprecation-Warnung für die CJS-Ausgabe der Vite Node API; die Tests selbst sind vollständig grün.
