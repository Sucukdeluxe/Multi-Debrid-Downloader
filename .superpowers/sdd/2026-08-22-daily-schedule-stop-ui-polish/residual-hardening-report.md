# Residual Hardening Report

## Status

PASS. Alle fünf Residuals sind mit beobachteten REDs, fokussierten GREENs und frischen Abschlussgates umgesetzt.

Basis: `7a052e995c38cd8d98589d2485f7b49b8c2d4c70`

## Umsetzung

1. Persistierte Outputzahlen besitzen jetzt einen expliziten Provenienzvertrag in Version 1. Beim Laden wird `outputCount` ausschließlich aus gültiger Paketprovenienz abgeleitet; unversionierte globale Legacy-Zahlen ohne Provenienz werden auf 0 invalidiert.
2. Archivfortschritt transportiert den tatsächlichen Archivpfad. Die Zuordnung verwendet normalisierte verschachtelte Itempfade, gleiche Basenames in verschiedenen Unterordnern bleiben getrennt und Items ohne Pfadprovenienz erhöhen `partCount` nicht.
3. Explizites Paketlöschen entfernt sämtliche Generationen aus finalisierten, standalone, unterdrückten und Digest-Resultaten sowie Run-Referenzen und Outputprovenienz. Automatische `package_done`-Bereinigung behält bereits finalisierte Run- und Digest-Belege.
4. Post-Process-Waiter besitzen einen Run-Owner. Selektiver Stop verwirft nur Waiter des gestoppten Runs. Ein freier Slot wird atomar an genau einen Waiter übertragen, ohne den Aktivzähler zwischenzeitlich auf 0 zu setzen.
5. Outputprovenienz entsteht aus paket-eigenen Staging-Ausgaben im selben Zielroot. Entpacker verschiedener Pakete dürfen parallel arbeiten; nur der konfliktbehaftete Merge in denselben Root wird in Aufrufreihenfolge serialisiert. Der Merge verwendet Rename/Move, erhält `overwrite`, `skip` und `rename`, übernimmt Partial-Ausgaben bei Abort deterministisch und traversiert ausschließlich das jeweilige Staging-Verzeichnis.

## RED

- `npx vitest run tests/storage.test.ts -t "invalidates an unversioned legacy package output count on load"`: 1/1 fehlgeschlagen; geladen wurden `outputCount: 48000` und keine Provenienzversion.
- `npx vitest run tests/download-manager.test.ts -t "captures shared-root provenance|preserves .* conflicts|retains partial staged outputs|uses normalized nested item paths|keeps foreign post-process waiters"`: 6 Fehler. Die Traversalinjektion wurde nicht verwendet, `skip` und `rename` überschrieben die Fremddatei, Abort verwendete keinen bounded Traversal, zwei Nested-Archive kollidierten zu zwei statt drei Operationen und der gestoppte Waiter wurde mit `undefined` statt `false` freigegeben. Der isolierte `overwrite`-Fall war bereits grün.
- `npx vitest run tests/notify-hooks.test.ts -t "prunes only the removed package result generations"`: 1/1 fehlgeschlagen; beide Generationen des entfernten Pakets blieben erhalten.
- Der erste fokussierte Regressionlauf zeigte zusätzlich zwei Fehler in bestehenden `package_done`-Notification-Fällen. Ursache war zu breites Pruning bei automatischer Bereinigung. Nach Begrenzung auf explizites Löschen bestanden die beiden Regressionen zusammen mit dem neuen Removal-Test 3/3.

## GREEN

- Neue Residualfälle in `tests/download-manager.test.ts`: 7/7.
- Legacy-Invalidierung und versionierte Persistenz in `tests/storage.test.ts`: 2/2.
- Explizites Removal-Pruning in `tests/notify-hooks.test.ts`: 1/1.
- Shared-Root-Lasttest: 2.000 Fremddateien, zwei parallele Paketoperationen, kein Traversal des Shared Roots und eine literale Traversalobergrenze von höchstens 4 Aufrufen.
- Konflikt- und Abbruchabdeckung: `overwrite`, `skip`, `rename` sowie Partial-Abort und vollständiges Entfernen der Staging-Verzeichnisse.

## Abschlussgates

- `npx vitest run tests/notify-hooks.test.ts tests/package-telemetry.test.ts tests/notification-outbox.test.ts tests/history-reveal.test.ts tests/history-view.test.tsx tests/storage.test.ts tests/extractor.test.ts tests/extractor-jvm.test.ts tests/main-shutdown-lifecycle.test.ts`: 324/324.
- `npx vitest run tests/download-manager.test.ts -t "deterministic stop and restart lifecycle|package lifecycle telemetry boundaries|recovers pending extraction on startup"`: 23/23.
- Fokussierte Gesamtsumme: 347/347.
- `npx tsc --noEmit`: Exit 0.
- `npm run build:main`: Exit 0.
- `npm run build:renderer`: Exit 0.
- `git diff --check`: Exit 0 nach Produktions-, Test- und Berichtsänderungen.

## Restbedenken

- Der Renderer-Build meldet weiterhin den bestehenden JavaScript-Chunk über 500 kB.
- Native WinRAR-/7-Zip-Prozesse wurden nicht als reales Windows-End-to-End-Szenario gestartet; die fokussierten Extractor- und JVM-Suites bestanden 86/86.
- Auf Vorgabe wurden keine Vollsuite und keine GUI-, RDP-, Maus-, Fenster- oder Zwischenablageprüfungen ausgeführt.
