# Task 3: Deterministischer Stop→Start-Lifecycle

## Status

Umgesetzt und fokussiert verifiziert.

## Umsetzung

- Expliziter `DownloadLifecycleSnapshot` mit Phase, Grund, optionalem Retry-Zeitpunkt, aktiven Downloads, aktiven Nachbearbeitungen und angenommenem Startwunsch.
- Generation-Guard für `start()` nach beiden asynchronen Recovery-Grenzen.
- `stopping` bleibt bis zum tatsächlichen Drain von Start-Recovery, Downloads und Nachbearbeitung aktiv.
- Ein Start während `stopping` wird einmal angenommen und nach dem Drain genau einmal ausgeführt.
- ActiveTask-Cleanup ist an den konkreten Map-Eigentümer gebunden; verspätetes Cleanup kann keinen neueren Task löschen oder dessen Ressourcen freigeben.
- Stop abortiert laufende Nachbearbeitung auch bei aktivierter Nachbearbeitung ohne laufende Sitzung und zeigt die verbleibende Arbeit bis zum Promise-Ende.
- Real-Debrid-, AllDebrid- und BestDebrid-Webqueues geben abortierte Aufrufer über eine äußere Abort-Race sofort frei und beobachten die spätere terminale Promise-Auflösung weiterhin.
- Der früheste endliche Provider-Cooldown plant im Idle-Zustand ein State-Event zum Ablaufzeitpunkt.
- Startbutton und Download-Footer zeigen Pending-Start, Lifecycle-Phase, Grund, Retry-Restzeit und verbleibende Download-/Nachbearbeitungsarbeit.

## RED-Nachweise

- Recovery-Rennen: Nach Stop wurde `session.running` wieder `true`.
- Pending-Start: Während `stopping` fehlten Lifecycle und angenommener Startwunsch.
- ActiveTask-Eigentümer: Ein verspätetes altes `finally` löschte den neueren Map-Eintrag.
- Webqueues: Alle drei nie endenden Requests liefen nach Abort in den 200-ms-Testtimeout.
- Cooldown: Der Snapshot blieb bei `idle` mit `retryAt=null`.
- Renderer: Pending-Start-Button und Lifecycle-/Restarbeitsanzeige fehlten.
- Nachbearbeitung: Stop ließ das aktive Postprocessing-Signal bei `autoExtractWhenStopped=true` unabgebrochen.

## Verifikation

- 7 fokussierte Manager-Regressionen bestanden.
- 152/152 Real-Debrid-, AllDebrid-, BestDebrid- und Download-Renderer-Tests bestanden.
- `npx tsc --noEmit` bestand.
- `npm run build` bestand für Main und Renderer.
- `git diff --check` bestand vor dem Bericht.

## Commits

- `1f97ce8 Harden download stop and restart lifecycle`
- `Complete provider waits and lifecycle visibility`

## Bedenken

- Der vollständige Fünf-Dateien-Lauf erreichte vor der letzten Korrektur 395/397. Die beiden isolierten Fehler wurden anschließend einzeln und im finalen 7-Test-Manager-Gate grün verifiziert; die übrigen 393 Manager-/Web-/Renderer-Tests wurden nach dieser letzten kleinen Kompatibilitätskorrektur nicht nochmals gemeinsam ausgeführt.
- Der Renderer-Build bleibt grün, meldet aber die bereits bestehende Warnung für einen JavaScript-Chunk über 500 kB.
