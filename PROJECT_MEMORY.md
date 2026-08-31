# Projekt-Memory: Multi Debrid Downloader

## Zweck

Multi Debrid Downloader ist eine Windows-Desktopanwendung zum paketbasierten Sammeln, Auflösen, Herunterladen und Nachbearbeiten von Links über mehrere Debrid- und Hoster-Anbieter. Die Anwendung unterstützt Warteschlangen, Provider-Routing und -Fallbacks, fortsetzbare Downloads, Entpacken, MKV-Nachbearbeitung, Verlauf, Statistiken, Sicherungen, Updates und optionale Ferndiagnose.

Diese Datei hält den verifizierten technischen Arbeitsstand fest. Sie enthält keine Zugangsdaten und ersetzt keinen vollständigen Chatverlauf.

## Zuletzt verifizierter Stand

- Verifiziert am: 31. August 2026, Europe/Berlin
- Lokaler Pfad: `C:\Users\Sascha\Desktop\Claude & ChatGPT Projekte\Multi-Debrid-Downloader`
- Arbeitsbranch: `codex/v2.0.74-project-memory`
- Quellbasis: `release/v2.0.74`
- Release-Tag: `v2.0.74`
- Baseline-Commit: `c1e1095231ab72d71dfa9af5a3e5d2dce691d0cb`
- Paketversion: `2.0.74`
- Letztes GitHub-Release: `Multi-Debrid-Downloader v2.0.74`, veröffentlicht am 26. August 2026
- Runtime-Voraussetzung: Node.js `>=20`; lokal verifiziert mit Node.js `24.19.0` und npm `11.17.0`

`main` ist derzeit keine verlässliche Arbeitsbasis:

- GitHub `main` steht auf `4d5161b` (`v2.0.35`) und ist gegenüber `release/v2.0.74` mit 7 zu 136 Commits auseinanderentwickelt.
- Forgejo `main` steht auf `a8c4dcc` (`v1.7.232`) und ist noch deutlich älter.
- GitHub und Forgejo zeigen für `release/v2.0.74` beide exakt auf `c1e1095`.
- Neue Arbeit muss bis zu einer ausdrücklich geplanten Branch-Bereinigung von `release/v2.0.74` beziehungsweise diesem Arbeitsbranch ausgehen.

## Remotes

- `origin`: `https://github.com/Sucukdeluxe/Multi-Debrid-Downloader.git`
- `forgejo`: `https://git.24-music.de/Administrator/Multi-Debrid-Downloader.git`
- Beide bestehenden Repositories sind laut Anbieter-API derzeit öffentlich. Die Sichtbarkeit wurde bei der Einarbeitung nicht verändert.
- Der Arbeitsstand wird nach zusammengehörigen Änderungen zu beiden Remotes gepusht und anschließend über die Commit-IDs beider Remote-Branches verifiziert.
- Pushen ist kein Release. Release, Deployment, Veröffentlichung und produktive Neustarts benötigen immer eine aktuelle ausdrückliche Freigabe.

## Architektur

### Prozessgrenzen

- Electron-Main-Prozess in `src/main`: besitzt Dateisystem, Netzwerk, Zugangsdaten, Downloads, Persistenz, Updates, Backups und Diagnosefunktionen.
- Preload-Brücke in `src/preload/preload.ts`: stellt eine typisierte, eng begrenzte `window.rd`-API bereit.
- React-Renderer in `src/renderer`: enthält Oberfläche und lokale View-Modelle, aber keinen direkten Node-Zugriff.
- Gemeinsame Verträge in `src/shared`: Typen, IPC-Kanäle, Collector-Grenzen und Preload-API.
- Separater Online-Backup-Dienst in `services/backup-api`: kleine Node-HTTP-API mit dateibasierter, gesperrter und atomarer Speicherung.

### Sicherheitsgrenzen

- Renderer: `contextIsolation: true`, `nodeIntegration: false`, `sandbox: true`, `webSecurity: true`.
- Navigation, neue Fenster, Berechtigungen und externe HTTPS-Ziele werden über Allowlisten kontrolliert.
- IPC akzeptiert nur den erwarteten Renderer-Ursprung; Eingaben werden pro Kanal validiert.
- Zugangsdaten bleiben im Main-Prozess und werden für Renderer-Snapshots projiziert beziehungsweise redigiert.
- Der Updater lädt ausschließlich GitHub-Release-Assets, prüft EXE-Form und SHA-256/SHA-512 und verweigert standardmäßig Assets ohne gültigen Digest.
- Lokale Voll-Backups verwenden scrypt und AES-256-GCM mit authentifiziertem Header; Legacy-MDD1 kann weiterhin gelesen werden.
- Online-Sicherungen sind `settings-only`, clientseitig mit AES-256-GCM verschlüsselt und durch einen zufälligen `MDD2-`-Schlüssel geschützt. Der Server erhält weder Master-Key noch Löschgeheimnis im Klartext.

### Zustands- und Persistenzmodell

- `AppController` verdrahtet Einstellungen, Storage, DownloadManager, Provider, Collector, Verlauf, Statistiken, Benachrichtigungen, Backups und Diagnose.
- `DownloadManager` ist der zentrale Besitzer der Session und des Scheduler-Lebenszyklus.
- Renderer-Snapshots tragen monotone `snapshotRevision`-Werte und sind Voll- oder Delta-Payloads. Veraltete oder doppelte Snapshots werden verworfen; Deltas vor dem ersten Vollsnapshot werden gepuffert.
- Einstellungen, Session, Verlauf, Statistik, Collector und Notification-Outbox nutzen atomare Schreibpfade, Backups, Generationsprüfungen und Windows-Retrylogik.
- Backup-Importe laufen hinter einer Persistenzbarriere. Settings-only-Importe erhalten die laufende Queue und Live-Zähler; Full-Importe tauschen Session/Verlauf/Statistik transaktional aus und verlangen danach einen Relaunch. Fehler rollen Dateien und Laufzeitzustand zurück.

### Download- und Provider-Pipeline

- Provider: Real-Debrid API/Web, AllDebrid API/Web, BestDebrid API/Web, Deepbrid, Debrid-Link, Mega-Debrid API/Web, LinkSnappy, DDownload und 1Fichier.
- Provider-Reihenfolge, Hoster-Overrides, Kontostatus, Tageslimits, Cooldowns und optionale Fallbacks bestimmen das Routing.
- Real-Debrid und Debrid-Link unterstützen Kontopools; Auswahl und Rotation berücksichtigen Aktivität, Fairness, Limits und Fehlerklassen.
- Item-Pipeline: Vorprüfung und Recovery, Provider-Auswahl, Unrestrict mit Timeout, sichere Zielpfadreservierung, Speicherplatzreservierung, HTTP-Download mit Range-Resume, optionale Integritätsprüfung, Abschluss und Paket-Postprocessing.
- Der optionale Proxy-only-Modus leitet sämtliche Main-Prozess-API-, Link-Auflösungs- und normalen Download-Requests über einen fest ausgewählten authentifizierten HTTP-CONNECT-Proxy. Electron-Web-Logins und deren Session-Fetches erhalten denselben festen Proxy. Neue Dateien ab 8 MiB können zusätzlich in 2 bis 32 exakten HTTP-Range-Bereichen parallel über die gesamte Proxy-Liste geladen werden.
- Download-Retries unterscheiden Netzwerk-, Range-, Hoster-, Provider-, Konto-, Quota-, Disk- und permanente Linkfehler. Stop, Pause, Shutdown und Neustart besitzen getrennte Park- und Abbruchpfade.
- Die Queue priorisiert hoch vor normal vor niedrig, beachtet globale und providerbezogene Parallelitätsgrenzen und schützt sich mit Scheduler-Generation, Heartbeat und Stall-Watchdogs gegen veraltete Tasks.

### Entpacken und Nachbearbeitung

- Hybrid-Entpacken kann vollständige Archive schon während eines laufenden Pakets verarbeiten; Voll-Entpacken startet erst nach abgeschlossenem Paket.
- Unterstützt werden der JVM-Extractor sowie 7-Zip/WinRAR-Fallbacks, ZIP-intern, Split-Archive, verschachtelte Archive, Passwortlisten, Passwort-Cache und Resume-Zustand.
- Passwörter werden nicht im Log ausgegeben. Pfad-Traversal, unsichere Zielpfade, leere Ausgaben, unvollständige Archive und Preallocation-False-Positives werden abgefangen.
- Archiv-, Link- und Sample-Bereinigung erfolgt erst nach nachgewiesener erfolgreicher Ausgabe; bei Teilfehlern bleiben Resume-Informationen erhalten.
- Optionale Hintergrundschritte übernehmen automatische Umbenennung, deutsche Tonspur/MKV-Remux und das Einsammeln in die Bibliothek. Versions- und Abort-Guards verhindern, dass alte Postprocessing-Tasks neue Paketstände überschreiben.

### Renderer und große Datenmengen

- Hauptansichten: Downloads, Linksammler, Verlauf, Statistik und Einstellungen/Konten.
- Downloads verwenden View-Modelle, Filter, Sortierung, Paket-/Dateiansicht, Auswahl, Disclosure-Zustand und Renderlimits.
- Der Linksammler ist paketbasiert, reichert Metadaten progressiv an, virtualisiert große Listen und persistiert Delta-Änderungen. Grenzen: 2.000 Pakete, 20.000 Links, 1.024 Zeichen pro Paketname und 64 MiB serialisierter Zustand.
- Collector-Hydration führt verspätet geladenen und bereits lokal geänderten Zustand deterministisch zusammen; Persistenzfehler rollen die UI auf den letzten bestätigten Zustand zurück.
- Verlauf ist auf bis zu 100.000 Einträge ausgelegt und verwendet Paging, verzögerte Projektion, Suchtext- und Seiten-Caches sowie seitenübergreifende Auswahl.
- Statistiken führen Session-, Tages-, Gesamt- und exakte rollierende 24-Stunden-Werte. Kontoverkehr liegt in Minuten-Buckets mit 48 Stunden Aufbewahrung; der Renderer erhält nur sichere Aggregate.

## Letzte Änderungen in v2.0.74

- Paketbasierter Linksammler wiederhergestellt und für große Datenmengen stabilisiert: progressive Metadaten, Suche/Filter, Auswahl, Transfer, Offline-Entfernung, JSON-Export, Virtualisierung, Delta-Persistenz, Shutdown-Flush und Hydration-Recovery.
- Neu importierte Collector-Pakete sind standardmäßig eingeklappt; DLC-Dateien im Download-Kontext gehen weiterhin direkt in die Queue.
- Download-Seitenleiste, Aktionsfreigaben, Start/Pause-Folgen, Run-Restwerte/ETA, Statusnormalisierung, Snapshot-Reihenfolge und Speed-Graph wurden stabilisiert.
- Verlauf und Statistik wurden für 100.000 Einträge, Paging, Live-Einträge, korrekte Zeitfenster, Recovery und konsistente Resets überarbeitet.
- Settings-Speichern, Theme-Autorität, vollständige DE/EN-Texte, Backup-Transaktionen, Notification-Outbox und Windows-Dateirennen wurden gehärtet.
- Die letzten drei Commits des Release-Branches sind `bdcf9e3` (Collector-Persistenz und Download-Steuerung), `2ea494c` (v2.0.74 Reliability Release) und `c1e1095` (stabiler 100k-History-Performancevertrag).

## Aktuelle unveröffentlichte Änderung

- Unter „Geschwindigkeit“ kann Proxy-only aktiviert, eine externe Proxy-Textdatei ausgewählt, ein fester API-Proxy über den 1-basierten gültigen Listeneintrag festgelegt und die Zahl der Segmentverbindungen pro Download zwischen 2 und 32 gewählt werden. Bei fünf parallelen Downloads und 16 Segmenten sind damit bis zu 80 Segmentverbindungen möglich; `maxParallel` bleibt die vorhandene globale Downloadgrenze.
- Der feste Proxy übernimmt API-Aufrufe, Account-Prüfungen, Updates, Benachrichtigungen, Link-Auflösung, Web-Logins und alle Einzel-Proxy-Downloads. Ist die Liste nicht lesbar, leer oder der ausgewählte Eintrag nicht vorhanden, blockiert ein Fail-closed-Dispatcher sämtliche globalen Requests. Ist der feste Proxy offline, schlägt die Anfrage fehl; er wird nicht automatisch ersetzt und es gibt bei aktivem Modus keinen direkten Rückfall über die echte Verbindung.
- Electron-Provider-Sitzungen werden vor Login, Navigation und Session-Fetch auf denselben festen Proxy gesetzt. Authentifizierungsdaten werden ausschließlich beim passenden Proxy-Authentifizierungsereignis geliefert. Bereits bekannte Sitzungen werden bei einer Einstellungsänderung neu konfiguriert und bestehende Verbindungen geschlossen.
- Unterstützt werden insbesondere `Benutzer:Passwort@Host:Port`, Proxy-URLs, `Host:Port` und `Host:Port:Benutzer:Passwort`. Die Liste wird nur im Main-Prozess gelesen und anhand von Dateigröße und Änderungszeit gecacht. Proxy-Zugangsdaten werden nicht protokolliert, nicht an den Renderer übertragen und nicht in Git übernommen; lediglich der lokale Listenpfad ist eine normale Einstellung.
- Jeder Proxy-Download prüft zuerst `Range: bytes=0-1`, übernimmt die autoritative HTTP-Gesamtgröße, reserviert eine zielnahe temporäre Datei und schreibt jedes Segment positionsgenau. Die Zwei-Byte-Probe umgeht ein reproduziertes Real-Debrid-Verhalten, bei dem nur `bytes=0-0` trotz 206-Header die gesamte Datei streamt. Segmente versuchen bei Verbindungs-, Authentifizierungs-, Timeout- oder Range-Fehlern andere Proxys. Erst nach vollständiger Größenprüfung und `datasync` wird die Datei atomar zum Ziel umbenannt.
- Abbruch und Segmentfehler beenden alle zugehörigen Tunnel, entfernen die temporäre Datei und rechnen nur eindeutigen Segmentfortschritt zurück. Tatsächlich empfangener Providerverkehr bleibt für Statistik und Geschwindigkeitsmessung erhalten. Ein fehlgeschlagener Segmentversuch wechselt anschließend auf den bestehenden Einzel-Downloadpfad, der bei Proxy-only weiterhin zwingend den festen Proxy verwendet.
- Der bestehende Range-Resume-Pfad für Teil-Dateien wurde nicht ersetzt. Ein aktives Geschwindigkeitslimit überspringt die Proxy-Segmentierung, damit das konfigurierte Limit nicht umgangen wird; auch dieser Einzel-Download läuft im Proxy-only-Modus über den festen Proxy.
- Für den globalen Node-Dispatcher wird `undici` exakt in Version `6.28.0` verwendet. Der Segment-Downloader behält `https-proxy-agent` für seine voneinander unabhängigen Tunnel. Der Produktions-Audit meldet für die neue direkte Undici-Abhängigkeit keine offenen Advisories.
- Ein Start-/Beenden-Fehler nach Real-Debrid-Web-Downloads wurde behoben. Der persistente unsichtbare Web-Generator blieb nach dem Schließen des Hauptfensters geöffnet, verhinderte dadurch `window-all-closed` und hielt den Single-Instance-Lock. Weitere Starts wurden als Zweitinstanz sofort beendet, während der alte `second-instance`-Handler ohne Hauptfenster nichts tat.
- Das Hauptfenster ist unter Windows nun ausdrücklich Besitzer des App-Lebenszyklus: Nach einem natürlichen, vom Renderer bestätigten Schließen wird der kontrollierte Shutdown auch bei verbleibenden Providerfenstern gestartet. Der normale `beforeunload`-Pfad bleibt erhalten, damit noch nicht übertragene Linksammler-Änderungen synchron gesichert werden können.
- `second-instance` und `activate` stellen ein vorhandenes Hauptfenster wieder her oder erzeugen ein fehlendes neu. Ein Start während eines bereits laufenden Shutdowns plant genau einen Relaunch nach dem Prozessende ein.
- Der Shutdown besitzt einen äußeren 10-Sekunden-Wächter. Nach erfolgreichem Controller-Shutdown wird weiterhin normal mit `app.quit()` beendet; blockieren Renderer- oder Providerfenster diesen letzten Schritt, erzwingt ein separater 2-Sekunden-Wächter den Exit. `shutdownDaemon()` läuft im Graceful-Pfad erst nach `controller.shutdown()`.
- Der Debug-Server serialisiert Start, Stop und Restart. Gleichzeitige Restarts können keinen unverwalteten Listener mehr hinterlassen, wartende Restarts können einen Stop nicht mehr überholen und ein Stop während des Socket-Starts löst die Lifecycle-Queue zuverlässig auf.
- Settings- und Session-Recovery unterscheiden jetzt gültige leere Zustände von JSON-gültigen, aber unbrauchbaren Strukturen. Eine absichtlich leere Session bleibt maßgeblich; beschädigte Settings-/Session-Primärdateien fallen auf ein intaktes Backup zurück. Sparse historische Settings bleiben kompatibel, und eine fehlende Settings-Primärdatei wird aus dem Backup repariert.
- Das sichere Crash-Journal für ausstehende Hoster-Metadaten-Umbenennungen bleibt über einen Neustart erhalten. Nur absolute echte Unterpfade des Paketausgabeordners werden übernommen; fremde, relative oder mit dem Ausgabeordner identische Pfade werden verworfen.
- Asynchrone Settings- und Session-Saves lösen ihre Promises erst nach dem zugehörigen dauerhaften Schreibvorgang auf und propagieren Fehler. Coalescing, Drain-Ende, Importbarriere und Replay warten auch bei Fehlern auf alle gestarteten Writes; verlorene Wakeups, hängende Barrieren, still verworfene Saves und falsch erfolgreiche Waiter wurden mit Race-Regressionen abgedeckt.
- Der Updater beendet Backpressure-, Shutdown- und Idle-Wartezustände auch bei Schreibfehlern zuverlässig. Er wartet vor dem Rename auf den tatsächlichen Dateistream-Close, propagiert späte Close-Fehler, hält die Fehlerabsicherung bis `close` aktiv und blockiert bei einem nie auflösenden Response-`cancel()` nicht mehr dauerhaft.
- Die übergroßen Updater-Test-Fixtures wurden durch gleichwertige 128-KiB-MZ-Payloads ersetzt, damit Integritäts- und Fallback-Tests unter paralleler Last nicht an Vitests 5-Sekunden-Grenze flaken.
- Die Entpacklogik und ihre Produktionspfade wurden nicht verändert.
- Die Änderungen sind nur auf dem Arbeitsbranch implementiert und getestet. Sie wurden weder veröffentlicht noch auf dem Server installiert; dafür ist eine neue ausdrückliche Release-/Deployment-Freigabe erforderlich.

## Start-, Build- und Testbefehle

```powershell
npm ci
npm ci --prefix services/backup-api
```

Im aktuellen Pfad mit `&` können von npm erzeugte Windows-`cmd`-Shims den Pfad falsch zerlegen. PowerShell 7 ist installiert; für zusammengesetzte npm-Skripte funktioniert:

```powershell
$env:npm_config_script_shell = "pwsh.exe"
npm run dev
npm run build
npm test
```

Robuste direkte beziehungsweise getrennte Varianten:

```powershell
node node_modules/vitest/vitest.mjs run
npm run build:main
npm run build:renderer
npm run test:backup-api
npm run self-check
npm exec -- tsc --noEmit
```

`npm run release:win` baut Release-Artefakte und darf nur nach ausdrücklicher Release-Freigabe ausgeführt werden.

## Verifizierungen vom 31. August 2026

- Proxy-Parser gegen die bereitgestellte externe Liste geprüft: 1.000 von 1.000 Einträgen gültig; dabei wurden weder Proxy-Verbindungen aufgebaut noch Listeneinträge ausgegeben.
- Proxy-Segmenttests: 6 von 6 erfolgreich. Abgedeckt sind die feste Auswahl nach gültigem 1-basiertem Listeneintrag, vier parallele authentifizierte CONNECT-Proxys mit exakten Byte-Bereichen und identischem Dateiergebnis, Ersatz eines abgelehnten Segment-Proxys, sauberer Einzel-Proxy-Fallback ohne Restdatei bei ignoriertem Range-Header sowie Abbruch mit Fortschritts-Rückrechnung und Temp-Bereinigung.
- Proxy-only-Routingtests: 3 von 3 erfolgreich. Ein normaler globaler API-`fetch` verwendete ausschließlich den ausgewählten zweiten authentifizierten CONNECT-Proxy; der erste Proxy blieb unbenutzt. Bei fehlender Liste wurde die Zieladresse nicht kontaktiert. Electron-Regeln enthielten keine Zugangsdaten, während die Authentifizierung nur für exakt passenden Proxy-Host und -Port bereitgestellt wurde.
- Reale Proxy-Prüfung mit einer 930.376.313 Byte großen Real-Debrid-RAR-Datei: 16 Verbindungen, vollständiger Segmenttransfer in rund 11,7 Sekunden mit 76,09 MiB/s mittlerem Nutzdurchsatz und zwischenzeitlich rund 94 MiB/s; Gesamtlauf einschließlich `datasync` und SHA-256 dauerte 13,19 Sekunden. Der zusätzliche Prüfverkehr betrug exakt 2 Byte.
- Die reale Testdatei besitzt SHA-256 `f60f70a03cc49f544aab97d66254cb39801d7bbad827d1db935ef8b25c8b544f`, eine gültige RAR-Signatur und ein fehlerfrei lesbares Inhaltsverzeichnis. 32 verteilte 64-Byte-Stichproben an Anfang und Ende aller 16 Segmente stimmten mit frischen Range-Antworten über 32 verschiedene Listeneinträge überein.
- Settings-/Storage-Regressionen decken Aktivierung, Pfad, Wertebereich 2 bis 32, Dateiauswahl und die Darstellung von 80 möglichen Tunneln bei 5 × 16 ab.
- Vollständiger Client-Lauf nach Proxy-only: 140 Testdateien erfolgreich, 1 JVM-Testdatei übersprungen; 2.672 Tests erfolgreich und 4 übersprungen. Nur die zwei bekannten Symlink-Fixtures in `public-release-metadata.test.ts` scheiterten vor ihrer Produktassertion mit Windows-`EPERM`.
- Finaler Wiederholungslauf ohne die nicht ausführbare Symlink-Testdatei: 140 Testdateien erfolgreich, 1 JVM-Testdatei übersprungen; 2.650 Tests erfolgreich und 4 übersprungen.
- Nach der Proxy-Änderung erfolgreich: TypeScript, Main-Build, Renderer-Build und Self-Check. Die bekannte Vite-Warnung zum nun rund 575 KiB großen Renderer-Chunk bleibt bestehen.
- Root-Installation mit `npm ci`: erfolgreich.
- Backup-API-Installation mit `npm ci --prefix services/backup-api`: erfolgreich.
- TypeScript mit `npm exec -- tsc --noEmit`: erfolgreich.
- Zusammengesetzter Build mit PowerShell-7-Skriptshell und `npm run build`: erfolgreich.
- Main-Build: erfolgreich.
- Renderer-Build: erfolgreich; Vite meldet einen großen JavaScript-Chunk von rund 574 KiB.
- Self-Check mit `npm run self-check`: erfolgreich.
- Backup-API-Tests: 16 von 16 erfolgreich.
- Online-Backup-Service-Integration im Client: erfolgreich, nachdem dessen eigene Abhängigkeiten installiert wurden.
- Client-Suite ohne `tests/public-release-metadata.test.ts`: 138 Testdateien erfolgreich, 1 JVM-Testdatei übersprungen; 2.600 Tests erfolgreich und 4 übersprungen.
- Vollständiger erster Client-Lauf: 2.621 Tests erfolgreich, 4 JVM-Extractor-Tests übersprungen; zwei Tests in `public-release-metadata.test.ts` scheiterten vor ihrer Assertion ausschließlich an fehlender Windows-Symlink-Berechtigung.
- GitHub: keine offenen Issues, keine Pull Requests und keine Actions-Läufe vorhanden.
- Lifecycle-Regressionen nach dem Start-/Beenden-Fix: 20 von 20 erfolgreich. Abgedeckt sind ein nie endender Shutdown, Fenster-Quit-Veto, Linksammler-`beforeunload`, Tray-Verhalten, fehlendes Hauptfenster, Zweitinstanz-Wiederherstellung und genau ein Relaunch während des Shutdowns.
- Reale Windows-Electron-Prüfung mit isoliertem temporärem Profil: App gestartet, echtes AllDebrid-Providerfenster geöffnet, nur das Hauptfenster per `WM_CLOSE` geschlossen. Der gesamte Electron-Prozessbaum war trotz verbleibendem Providerfenster nach 271 ms beendet. Ein unmittelbarer Neustart mit demselben Profil erzeugte wieder ein Hauptfenster und ließ sich erneut vollständig beenden. Das temporäre Profil wurde danach entfernt.
- Vollständiger Client-Lauf ohne den privilegierten Symlink-Metadatentest: 138 Testdateien erfolgreich, 1 JVM-Testdatei übersprungen; 2.609 Tests erfolgreich und 4 übersprungen. Ein unter paralleler Build-Last einmal auffälliger, fachfremder Ordner-Aufräumtest war anschließend dreimal isoliert und im vollständigen Wiederholungslauf erfolgreich.
- `public-release-metadata.test.ts` separat: 22 von 24 erfolgreich. Die zwei übrigen Fälle scheitern weiterhin ausschließlich beim Anlegen ihrer Symlink-Fixtures mit Windows-`EPERM`, bevor die Produktassertion ausgeführt wird.
- Nach dem Lifecycle-Fix erneut erfolgreich: TypeScript, vollständiger Main-/Renderer-Build, Self-Check und 16 von 16 Backup-API-Tests. Die bekannte Vite-Warnung zum rund 574 KiB großen Renderer-Chunk bleibt bestehen.
- Gezielte finale Regressionen: Storage und Session-Restart 141 von 141, Updater 40 von 40 und Debug-Server 18 von 18 erfolgreich.
- Finaler vollständiger Client-Lauf ohne den privilegierten Symlink-Metadatentest: 138 Testdateien erfolgreich, 1 JVM-Testdatei übersprungen; 2.640 Tests erfolgreich und 4 übersprungen.
- Der erste vollständige Lauf dieser Änderung hatte bei 2.639 erfolgreichen Tests genau einen 5-Sekunden-Timeout in einer Updater-Testfixture mit der 88,5-MiB-Node-EXE. Nach dem Ersatz aller reinen MZ-Fixtures durch 128-KiB-Payloads war der vollständige Wiederholungslauf grün.
- Nach allen finalen Korrekturen erneut erfolgreich: TypeScript, vollständiger Main-/Renderer-Build, Self-Check und 16 von 16 Backup-API-Tests. Die bekannte Vite-Warnung zum rund 574 KiB großen Renderer-Chunk bleibt bestehen.

## Bekannte Probleme und Risiken

- Die beiden `main`-Branches sind veraltet und untereinander nicht synchron. Sie dürfen nicht versehentlich als neueste Basis verwendet oder destruktiv zurückgesetzt werden.
- Beide vorhandenen Remotes sind öffentlich, obwohl neue Projekte gemäß Arbeitsregeln privat gespiegelt werden sollen. Eine Sichtbarkeitsänderung ist eine bewusste externe Entscheidung und wurde nicht eigenmächtig vorgenommen.
- `npm audit` meldet aktuell 36 Treffer: 2 niedrig, 5 mittel, 25 hoch und 4 kritisch. Direkte Treffer betreffen unter anderem Electron 31.7.7, Vite 6.4.1, Vitest 2.1.9, concurrently 9.2.1 und electron-builder 25.1.8. Ein Upgrade braucht einen eigenen getesteten Migrationsschritt; kein automatisches `npm audit fix` ausführen.
- Der separate Backup-API-Baum hat aktuell 0 Audit-Treffer.
- Windows ohne Developer Mode beziehungsweise passende Berechtigung kann die zwei Symlink-basierten Public-Release-Metadaten-Tests nicht ausführen.
- Proxy-Bündelung garantiert keine lineare Addition der Einzelgeschwindigkeiten. Ergebnis und Stabilität hängen unter anderem von Proxy-Latenz, Proxy-Bandbreite, Provider-/CDN-IP-Bindung, Range-Unterstützung, Zielserver-Limits, Dateigröße und lokaler Schreibgeschwindigkeit ab. Nach einem späten Segmentfehler kann vor dem festen Einzel-Proxy-Fallback zusätzlicher Providerverkehr angefallen sein.
- Der feste API-Proxy wird absichtlich nicht automatisch rotiert, damit API- und Login-Sitzungen eine stabile Ausgangs-IP behalten. Bei Ausfall muss ein anderer gültiger Listeneintrag ausgewählt werden; bis dahin schlägt Proxy-only geschlossen fehl.
- Die bereitgestellte Proxy-Liste wurde mit dem ausdrücklich bereitgestellten Real-Debrid-Testlink erfolgreich real geprüft. Die Messung gilt nur für diesen Link, diesen Zeitpunkt und einen parallelen Download; daraus folgt noch keine Garantie für fünf gleichzeitige Downloads, andere CDN-Knoten oder dauerhafte Proxy-Leistung.
- Der Arbeitsordner enthält `&`; ohne PowerShell-7-Skriptshell können npm-`cmd`-Shims fehlschlagen.
- Es gibt keine `.github`-Workflows und damit keine serverseitige CI-Absicherung im GitHub-Repository.
- Der Renderer-Bundle-Chunk liegt über Vites 500-KiB-Warnschwelle.
- Die Shutdown-Wächter können einen vollständig synchron blockierten Main-Thread nicht präemptieren. Im äußersten Fall beträgt die kombinierte Grenze knapp 12 Sekunden: bis zu 10 Sekunden Controller-Shutdown plus 2 Sekunden Quit-Bestätigung.
- Beim erzwungenen Exit können letzte asynchrone Logzeilen oder Benachrichtigungen fehlen; die wesentlichen Queue-, Settings-, Statistik- und Collector-Daten werden zuvor synchron gesichert. Laufende externe Extraktions-/Remux-Prozesse bleiben ein separater späterer Härtungspunkt.
- Die aktuellen Lifecycle-, Debug-Server-, Persistenz- und Updater-Fixes sind noch nicht veröffentlicht oder auf dem Server installiert. Bis zu einer ausdrücklich freigegebenen Auslieferung läuft dort weiterhin die bisherige Version.

## Nächste sinnvolle Schritte

1. Für eine Auslieferung der aktuellen Fehlerkorrekturen zuerst Stand, Ziel, Tests und Rollback-Weg nennen und Saschas ausdrückliches Release-/Deployment-Go abwarten.
2. Vor einer Auslieferung den Proxy-Modus mit einer unkritischen großen Testdatei zunächst bei 2 bis 4, danach bei 16 Verbindungen messen und dabei Erfolgsquote, Zusatzverkehr, Zielserver-Kompatibilität, Festplattenlast sowie Netto-MB/s vergleichen. Erst anschließend `maxParallel` auf 5 erhöhen.
3. Nach einer freigegebenen Serverinstallation den Ablauf Real-Debrid-Web-Download, Hauptfenster schließen und unmittelbar neu starten am echten Zielsystem verifizieren; vor jedem Eingriff Prozessbaum und Logtail sichern.
4. Sicherheitsabhängigkeiten in einem separaten Upgrade-Branch aktualisieren, Electron-/Vite-/Vitest-Major-Wechsel einzeln testen und danach den vollständigen Windows-Paketpfad prüfen.
5. Eine nichtdestruktive Strategie zur Bereinigung der divergierenden `main`-Branches abstimmen; kein Force-Push ohne ausdrückliche Freigabe.
6. Optional Developer Mode für lokale Symlink-Tests bereitstellen oder die Test-Fixtures plattformgerecht ohne privilegierte Symlinks gestalten.
