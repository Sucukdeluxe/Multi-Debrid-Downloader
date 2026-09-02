# Projekt-Memory: Multi Debrid Downloader

## Zweck

Multi Debrid Downloader ist eine Windows-Desktopanwendung zum paketbasierten Sammeln, Auflösen, Herunterladen und Nachbearbeiten von Links über mehrere Debrid- und Hoster-Anbieter. Die Anwendung unterstützt Warteschlangen, Provider-Routing und -Fallbacks, fortsetzbare Downloads, Entpacken, MKV-Nachbearbeitung, Verlauf, Statistiken, Sicherungen, Updates und optionale Ferndiagnose.

Diese Datei hält den verifizierten technischen Arbeitsstand fest. Sie enthält keine Zugangsdaten und ersetzt keinen vollständigen Chatverlauf.

## Zuletzt verifizierter Stand

- Verifiziert am: 2. September 2026, Europe/Berlin
- Lokaler Pfad: `C:\Users\Sascha\Desktop\Claude & ChatGPT Projekte\Multi-Debrid-Downloader`
- Arbeitsbranch: `release/v2.0.85`
- Quellbasis: `release/v2.0.84`
- Release-Tag: `v2.0.85` (Kandidat)
- Baseline-Commit: `ad75469854e5ae3b0cb8a75a2776308fdc4d22e5`
- Hotfix-Basis: `ad75469854e5ae3b0cb8a75a2776308fdc4d22e5`
- Paketversion: `2.0.85`
- Letztes Release: `Multi-Debrid-Downloader v2.0.84`, veröffentlicht am 1. September 2026 auf GitHub und Forgejo
- Runtime-Voraussetzung: Node.js `>=20`; lokal verifiziert mit Node.js `24.19.0` und npm `11.17.0`

`main` ist derzeit keine verlässliche Arbeitsbasis:

- GitHub `main` steht auf `4d5161b` (`v2.0.35`) und ist gegenüber `release/v2.0.74` mit 7 zu 136 Commits auseinanderentwickelt.
- Forgejo `main` steht auf `a8c4dcc` (`v1.7.232`) und ist noch deutlich älter.
- GitHub und Forgejo zeigen für `release/v2.0.74` beide exakt auf `c1e1095`.
- Neue Arbeit muss bis zu einer ausdrücklich geplanten Branch-Bereinigung von `release/v2.0.83` beziehungsweise einem davon abgeleiteten Arbeitsbranch ausgehen.

## Remotes

- `origin`: `https://github.com/Sucukdeluxe/Multi-Debrid-Downloader.git`
- `forgejo`: `https://git.24-music.de/Administrator/Multi-Debrid-Downloader.git`
- Beide bestehenden Repositories sind laut Anbieter-API derzeit öffentlich. Die Sichtbarkeit wurde bei der Einarbeitung nicht verändert.
- Der Arbeitsstand wird nach zusammengehörigen Änderungen zu beiden Remotes gepusht und anschließend über die Commit-IDs beider Remote-Branches verifiziert.
- Pushen ist kein Release. Release, Deployment, Veröffentlichung und produktive Neustarts benötigen immer eine aktuelle ausdrückliche Freigabe.
- Release-Changelogs werden plattformspezifisch gepflegt: auf GitHub immer auf Englisch, auf Forgejo unter `git.24-music.de` immer auf Deutsch. Tag, Titel, Assets und technische Inhalte bleiben für denselben Versionsstand gleichwertig.
- Forgejo-Releases werden bei verfügbarem Serverzugang über die offizielle Forgejo-API veröffentlicht, weil das Webformular in einer Uploadrunde nur fünf Anhänge annimmt. Forgejo läuft auf dem verwalteten Server im Container `forgejo-forgejo-1`; das dafür vorgesehene API-Token liegt ausschließlich serverseitig unter `/opt/forgejo/release-api-token`, gehört `root:root`, besitzt Modus `0600` und nur den Scope `write:repository`. Der Tokenwert darf nie ausgegeben, lokal gespeichert oder committed werden.
- Der verifizierte Forgejo-Ablauf lautet: sechs lokale Assets und den deutschen Release-Text in ein versionsbezogenes Verzeichnis unter `/tmp` übertragen, dort vor der Veröffentlichung die lokalen SHA-256-Werte erneut bestätigen, den stabilen Release per `POST /api/v1/repos/Administrator/Multi-Debrid-Downloader/releases` erzeugen und jedes Asset einzeln per `POST .../releases/{id}/assets?name=...` hochladen. Danach Tag, Titel, deutscher Text, Stable-Status, Assetliste und Update-Metadaten über die öffentliche API prüfen, alle sechs Assets erneut herunterladen und Größe sowie SHA-256 gegen die Originale vergleichen. Das temporäre Serververzeichnis wird erst nach erfolgreicher Verifizierung entfernt; direkte Datenbankänderungen und ein Forgejo-Neustart gehören nicht zu diesem Ablauf.

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
- Online-Sicherungen sind `settings-only`, clientseitig mit AES-256-GCM verschlüsselt und durch einen zufälligen `MDD2-`-Schlüssel geschützt. Eine konfigurierte Proxy-Liste wird innerhalb desselben verschlüsselten Nutzdatenblocks gesichert; der Server erhält weder Einstellungen, Proxy-Zugangsdaten, Master-Key noch Löschgeheimnis im Klartext.

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
- Der optionale Proxy-only-Modus leitet sämtliche Main-Prozess-API-, Link-Auflösungs- und normalen Download-Requests über einen fest ausgewählten authentifizierten HTTP-CONNECT-Proxy. Electron-Web-Logins und deren Session-Fetches erhalten denselben festen Proxy. Neue Dateien ab 8 MiB können zusätzlich über exakte HTTP-Range-Chunks parallel über die Proxy-Liste geladen werden. Seit `v2.0.76` ist der eingestellte Wert ein gemeinsames Prozesslimit für alle gleichzeitigen Segmentdownloads, und der feste API-Proxy bleibt aus dem Segmentpool heraus. Seit `v2.0.77` wird dieses Limit fair verteilt, werden kleine Chunks rollierend vergeben und Proxys nach gemessener Leistung und Fehlern bewertet.
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

## Änderungen in v2.0.75

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
- `v2.0.75` wurde nach ausdrücklicher Freigabe als GitHub-Update veröffentlicht und als Branch sowie annotierter Tag zu GitHub und Forgejo gespiegelt. Ein produktiver Serverdienst wurde dafür weder installiert noch neu gestartet.

## Änderungen in v2.0.76

- Der bisherige Wert „Verbindungen pro Download“ wurde bei jedem parallelen Download vollständig neu angewendet. Vier Dateien mit dem Wert 16 konnten deshalb bis zu 64 Segmenttunnel öffnen. Der Wert ist nun ein gemeinsames Gesamtlimit für alle gleichzeitig laufenden Segmentdownloads; bestehende Einstellungen mit 16 werden ohne Migration als höchstens 16 parallele Segmentverbindungen insgesamt verwendet.
- Segment-Proxys werden prozessweit koordiniert. Derselbe Listeneintrag wird nicht gleichzeitig an mehrere Segmente oder Dateien vergeben, und der fest ausgewählte API-Proxy bleibt exklusiv für API-, Login-, Link- und Einzel-Proxy-Verkehr reserviert.
- Range-Proben und Segmentanfragen teilen dasselbe Verbindungslimit. Wartende Dateien erhalten frei werdende Slots, statt das Limit durch zusätzliche Proben oder einen eigenen lokalen Proxy-Pool zu überschreiten.
- HTTP-Antworten des eigentlichen Downloadservers werden getrennt von Proxy-Verbindungsfehlern erfasst. Insbesondere erscheint ein über einen erreichbaren Proxy empfangener HTTP 503 mit `originHttpStatus=503` im Item-Log und nicht mehr irreführend als „Proxys nicht erreichbar“.
- Die Entpacklogik und ihre Produktionspfade wurden nicht verändert. Eine Serverinstallation oder ein produktiver Neustart ist nicht Bestandteil dieses Releases.

## Änderungen in v2.0.77

- Der globale Proxy-Scheduler registriert jeden laufenden Segmentdownload als eigene Gruppe und berechnet den fairen Anteil bei jeder Vergabe neu. Bei einem Gesamtlimit von 20 erhalten zwei aktive Dateien höchstens je 10 gleichzeitige Verbindungen, vier Dateien höchstens je 5. Sobald eine Datei endet, steht ihr Anteil den verbleibenden Dateien wieder zur Verfügung.
- Dateien werden nicht mehr in genau einen langen Bereich pro Verbindung geteilt. Eine gemeinsame rollierende Warteschlange erzeugt typischerweise 8 bis 16 MiB große Chunks; schnelle Proxys übernehmen dadurch fortlaufend weitere Bereiche, während ein langsamer Proxy nur seinen aktuellen Chunk verzögert. Die Chunk-Anzahl bleibt bei sehr großen Dateien begrenzt.
- Erfolgreiche Chunk-Übertragungen aktualisieren eine geglättete Durchsatzbewertung. Fehler senken die Bewertung und setzen einen Cooldown; ungetestete Listeneinträge werden kontrolliert weiter erkundet. Ein Proxy wird weiterhin nie gleichzeitig doppelt vergeben, und der feste API-Proxy bleibt ausgeschlossen.
- Origin-Antworten HTTP 429 und 503 senken das effektive Prozesslimit mit Entprellung um jeweils zwei Verbindungen. Nach ausreichend vielen stabilen Chunk-Erfolgen wird die Kapazität schrittweise bis zum konfigurierten Wert wiederhergestellt.
- Der Standardwert für neue oder noch nicht gesetzte Konfigurationen ist 20 Gesamtverbindungen. Bereits gespeicherte Werte bleiben unverändert; erlaubt sind weiterhin 2 bis 32.
- Der Paketfortschritt verwendet bei bekannten Größen dieselben heruntergeladenen und gesamten Bytes wie die Größenanzeige. Dadurch stimmen Prozentwert und `heruntergeladen / gesamt` auch bei unterschiedlich großen Dateien überein. Wenn Größen vollständig fehlen, bleibt die bisherige dateibasierte Berechnung als Rückfall erhalten.
- Die Entpacklogik und ihre Produktionspfade wurden nicht verändert. Eine Serverinstallation oder ein produktiver Neustart ist nicht Bestandteil dieses Releases.

## Änderungen in v2.0.78

- Der Standardwert für neue beziehungsweise noch nicht gesetzte Konfigurationen steigt von 20 auf 32 globale Proxy-Verbindungen. Bereits gespeicherte Benutzerwerte bleiben erhalten.
- Das einstellbare Maximum steigt von 32 auf 40 globale Proxy-Verbindungen. Faire Aufteilung, Proxy-Bewertung, Cooldowns und adaptives 429/503-Backoff gelten unverändert auch oberhalb von 32.
- „Sitzung“ erhält den kumulativen Bytezähler bei großen laufenden Queues nun in jedem 750-Millisekunden-Live-Snapshot und aktualisiert sich damit genauso häufig wie „Verbleibend“. Der 1,5-Sekunden-Cache bleibt für die übrigen aufwendigeren Statistikdaten erhalten.
- Die Entpacklogik und ihre Produktionspfade wurden nicht verändert. `v2.0.78` wurde nach ausdrücklicher Freigabe auf GitHub und Forgejo veröffentlicht; eine Installation oder ein produktiver Neustart ist nicht Bestandteil des Releases.

## Änderungen in v2.0.79

- Drei unabhängig bereitgestellte Kopien von `p2p-libr7-S02E05.rar` wurden binär verglichen. JDownloader und der manuelle Real-Debrid-Browserdownload waren bei exakt 910.536.950 Byte SHA-256-identisch (`be0bd334a63d92611acae349effb0e23a4cf4bdd00feb2fad9f3d0edb11e36e9`) und ließen sich mit UnRAR fehlerfrei testen. Die MDD-Kopie hatte dieselbe Größe, aber SHA-256 `7a763e774ba8068d4a756a69c72ae72bbc18d649c3cb7a5c7dc2b1d6a6436a1e` und einen CRC-Fehler.
- In der MDD-Kopie war ausschließlich der Bereich Byte 346.951.680 bis 346.955.311 durchgehend null. Die 3.632-Byte-Lücke lag innerhalb des 42. 8-MiB-Chunks; Segmentgrenzen und Endgröße waren korrekt. Damit ist ein still beschädigter Proxy-Segmentdownload nachgewiesen, nicht ein Fehler des Quellarchivs oder Extractors.
- Jeder fertig geschriebene Proxy-Chunk wird nun direkt vom Datenträger zurückgelesen und sein SHA-256-Digest mit den tatsächlich empfangenen Bytes verglichen. Bei einer Abweichung wird der Fortschritt des Versuchs zurückgerechnet, der Proxy abgewertet und der vollständige Chunk über einen anderen Proxy neu geladen.
- Nullfolgen ab 1.024 Byte werden zusätzlich stichprobenartig über einen anderen, gleichzeitig exklusiv reservierten Proxy erneut angefordert. Weicht die unabhängige Range-Antwort ab, wird ebenfalls der vollständige Chunk verworfen und neu geladen. Bestätigt die Gegenprobe echte Nullbytes, wird der Chunk normal akzeptiert.
- Item-Logs melden den Grund `readback_mismatch` beziehungsweise `zero_run_mismatch` mit Range- und Chunkgrenzen. Die bisher irreführende Meldung „Integritätsprüfung bestanden“ bei fehlender `.sfv`-, `.md5`- oder `.sha1`-Prüfsumme wurde in „Integritätsprüfung nicht ausgeführt“ mit Begründung geändert.
- Entpack-, Passwort- und Nachbearbeitungslogik wurden nicht verändert. `v2.0.79` wurde nach ausdrücklicher Freigabe auf GitHub und Forgejo veröffentlicht; Installation und produktiver Neustart sind nicht Bestandteil des Releases.

## Änderungen in v2.0.80

- Datei-, Paket-, Kopfzeilen- und Seitenleisten-Geschwindigkeit verwenden nun dieselbe rollierende Ein-Sekunden-Trafficbasis. Dafür werden die bereits für den globalen und paketbezogenen Durchsatz erfassten Bytes zusätzlich pro Item aggregiert; die bisherige kurzzeitige 0,5-Sekunden-Proxyspitze kann nicht mehr als widersprüchlicher Dateiwert stehen bleiben.
- Die Geschwindigkeitsprojektion verändert keine internen Session-Items. Nur tatsächlich abweichende Snapshot-Items werden kopiert, damit Restmengen-Benachrichtigungen und große Queues ihren bisherigen Laufzeitzustand beziehungsweise ihre Snapshot-Kosten behalten.
- Das Kontextmenü eines Oberpakets trennt jetzt „Nur fehlerhafte Dateien zurücksetzen“ von „Gesamtes Paket zurücksetzen“. Der selektive Weg erfasst fehlgeschlagene Downloads und als Entpackfehler markierte Items, verwendet den vorhandenen Item-Reset und lässt erfolgreiche beziehungsweise bereits entpackte Dateien unverändert.
- Der Statistikpunkt „Fehler zurücksetzen“ verwendet dieselbe Fehlerklassifizierung und erfasst dadurch neben Downloadfehlern auch sichtbare Entpackfehler.
- Entpack-, Passwort- und Nachbearbeitungslogik wurden nicht verändert. `v2.0.80` wurde nach ausdrücklicher Freigabe auf GitHub und Forgejo veröffentlicht; Installation und produktiver Neustart sind nicht Bestandteil des Releases.

## Änderungen in v2.0.81

- `Strg+A` markiert unter Einstellungen → Accounts → Übersicht alle aktuell sichtbaren Accountzeilen. Die bestehende Mehrfachauswahl wird dabei vollständig durch die sichtbare Liste ersetzt.
- Der Shortcut berücksichtigt den aktuellen Einstellungsbereich und den aktiven Account-Unterbereich über Live-Refs, damit der globale Tastaturhandler keinen veralteten Renderzustand verwendet.
- Fokussierte Account-Schalter erlauben den Shortcut; Textfelder und Textbereiche behalten ihr natives „Alles markieren“. Downloads, Linksammler und Verlauf behalten ihre bisherigen `Strg+A`-Bereiche.
- Account-Anlage, Einzel-/Sammelprüfung und Web-Login melden bei aktivem Proxy-only jetzt gezielt, ob keine Proxy-Liste hinterlegt ist, die Datei nicht lesbar beziehungsweise leer/ungültig ist, der feste 1-basierte Listeneintrag fehlt oder der aktive Proxy die Netzwerkverbindung nicht herstellen kann. Normale HTTP- und Zugangsdatenfehler bleiben davon getrennt.
- Online-Sicherungen nehmen den exakten Inhalt einer konfigurierten Proxy-Liste in den bereits clientseitig AES-256-GCM-verschlüsselten MDD2-Datensatz auf. Der Online-Dienst erhält weiterhin ausschließlich den authentifiziert verschlüsselten Blob und keine Proxy-Zugangsdaten im Klartext.
- Beim Import wird die Liste atomar in eine verwaltete Datei im Runtime-Verzeichnis geschrieben und der lokale Pfad darauf umgestellt. Ein Schreib- oder Settingsfehler stellt sowohl die vorherige Datei als auch die vorherigen Einstellungen wieder her.
- Ältere Online-Sicherungen ohne eingebettete Liste bleiben importierbar. Enthalten sie einen fremden Proxy-Pfad beziehungsweise aktiviertes Proxy-only, wird Proxy-only beim Import sicher deaktiviert, statt alle Netzwerkanfragen mit einem nicht portablen Pfad zu blockieren. Lokale Backup-Importe behalten ihre bisherige Pfadsemantik.
- Die Änderungen sind als `v2.0.81` auf GitHub und Forgejo veröffentlicht. Entpack-, Passwort- und Nachbearbeitungslogik wurden nicht verändert.

## Änderungen in v2.0.82

- Unter „Allgemein“ gibt es die standardmäßig ausgeschaltete Option „Fehlende Arbeitsordner beim Start anlegen“. Sie legt beim Programmstart einen fehlenden Download-Ordner an und berücksichtigt den Entpack- beziehungsweise Videosammelordner nur, wenn die jeweilige Funktion aktiviert ist.
- Vorhandene Ordner und Inhalte bleiben unberührt. Fehler eines einzelnen Ziels, etwa ein nicht erreichbares Netzlaufwerk, eine Datei am Zielpfad oder fehlende Berechtigung, werden protokolliert und blockieren weder weitere Ordner noch den Programmstart.
- Der Einstellungsbereich „Geschwindigkeit“ heißt nun „Geschwindigkeit & Proxy“; zugehörige Proxy-only-Hinweise und die englische Oberfläche verweisen ebenfalls auf den neuen Namen.
- „Sitzung“ und „Verbleibend“ stammen weiterhin aus demselben 750-Millisekunden-Snapshot. Bei Restmengen ab einem TiB wurde die sichtbare TB-Präzision von vier auf fünf Nachkommastellen erhöht: Ein Anzeigeschritt sinkt dadurch von rund 105 MiB auf rund 10,5 MiB und bleibt auch bei großen Queues sichtbar im gleichen Takt.
- Download-, Entpack-, Passwort- und Nachbearbeitungslogik wurden nicht verändert.

## Änderungen in v2.0.83

- Die bereitgestellte intakte RAR-Datei und die MDD-Datei besitzen beide exakt 808.969.900 Byte, aber unterschiedliche SHA-256-Werte. UnRAR bestätigt ausschließlich in der MDD-Datei einen Prüfsummenfehler; 8.197 Bytes unterscheiden sich in einem kompakten Bereich ab Byte 106.576.
- Eine direkte Range-Anfrage ohne MDD und ohne Proxy an den von Real-Debrid erzeugten Direktlink lieferte exakt die fehlerhaften Bytes der MDD-Datei. Damit sind Proxy-Segmentierung, lokaler Schreibpfad und Extractor als Erzeuger dieses konkreten Schadens ausgeschlossen; der aktive Real-Debrid-Direktlink selbst lieferte beschädigten Inhalt.
- Der bisherige Recovery-Guard setzte Dateien mit korrekter Größe und gültigem RAR-Kopf trotz eines durch beide Extractor-Pfade bestätigten CRC-Fehlers nicht neu in die Queue. Eine gültige Signatur schützt jedoch nur den Archivkopf und erkennt beschädigte Nutzdaten nicht.
- Ein entsprechend bestätigter CRC-Fehler verwirft nun alle betroffenen Archivteile, setzt Größe und Providerbindung zurück und fordert genau einen vollständigen Neudownload über einen frisch erzeugten Direktlink an.
- Der Einmal-Schutz wird pro Item in der Session gespeichert und überlebt einen Programmneustart. Liefert der Upstream erneut einen CRC-Fehler, bleibt der zweite Fehler sichtbar, statt eine Endlosschleife zu erzeugen. Ein manueller Item- oder Paket-Reset löscht den Schutz und erlaubt einen neuen bewussten Versuch.
- Echte Passwortfehler bei Dateien mit korrekter Größe und gültiger Archivsignatur lösen weiterhin keinen unnötigen Neudownload aus. Die Entpack-, Passwort- und Fallbacklogik selbst wurde nicht verändert.

## Änderungen in v2.0.84

- Ist „Fehlende Arbeitsordner beim Start anlegen“ aktiviert, werden fehlende konfigurierte Arbeitsordner nun bereits unmittelbar beim Speichern angelegt; ein Neustart ist dafür nicht mehr erforderlich.
- Derselbe bestehende Ordnerpfad bleibt für Programmstart und Speichern zuständig. Optionale Ziele, vorhandene Inhalte und die Fehlerisolation zwischen mehreren Zielpfaden behalten ihr bisheriges Verhalten.
- Das einstellbare globale Proxy-Segmentlimit steigt von 40 auf 80 Verbindungen. Der Standardwert für neue und bisher nicht gesetzte Konfigurationen bleibt 32; vorhandene Werte bleiben erhalten und werden erst oberhalb von 80 begrenzt.
- Faire Verteilung zwischen gleichzeitigen Downloads, Proxy-Bewertung, Cooldowns und adaptives 429/503-Backoff bleiben unverändert.
- Download-, Entpack-, Passwort- und Nachbearbeitungslogik wurden nicht verändert.

## Änderungen in v2.0.85

- Permanente Providerfehler wie Real-Debrids `file_unavailable` markieren den ursprünglichen Quelllink nun unmittelbar als offline. Bei mehrdeutigen Unrestrict- oder Kontopoolfehlern wird ein zuvor als online erkannter Rapidgator-, DDownload- oder 1Fichier-Link einmal direkt beim Hoster nachgeprüft; nur ein bestätigtes Offline-Ergebnis beendet ihn dauerhaft.
- Unter „Allgemein“ bestimmt „Wenn ein Quelllink offline geht“, ob nur der betroffene Mehrteil-Archivsatz oder das gesamte MDD-Paket übersprungen wird. Standard ist der Archivsatz. Die Zuordnung funktioniert auch dann, wenn Part 2 oder ein späterer RAR-, ZIP-, 7z- oder generischer Split-Part ausfällt.
- Im Archivsatz-Modus laufen andere Folgen beziehungsweise unabhängige Dateien desselben Pakets weiter. Im Paketmodus werden alle noch offenen Dateien übersprungen. Bereits abgeschlossene Downloads bleiben in beiden Modi unverändert.
- Verspätete Verfügbarkeitsantworten können einen bereits endgültig als offline markierten Eintrag nicht wieder auf online setzen. Die neue Nachprüfung wird pro Item gedrosselt, sodass mehrdeutige Providerfehler den Hoster nicht in einer schnellen Endlosschleife abfragen.
- Entpack-, Passwort- und Nachbearbeitungslogik wurden nicht verändert; die vorhandene Dateinamen-Zuordnung für Mehrteilarchive wird ausschließlich für die Auswahl noch offener Download-Items wiederverwendet.

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

## Verifizierungen bis 2. September 2026

- Kandidat für `v2.0.85`: zwei vollständige Download-Manager-Läufe mit jeweils 274 von 274 erfolgreichen Tests. Die neuen Regressionen bestätigen den Wechsel eines zuvor online gemeldeten Rapidgator-Links auf offline, die direkte Behandlung von Real-Debrid-`file_unavailable`, den Schutz vor verspäteten Online-Antworten, die Gruppierung von `partN.rar`, `.rar`/`.rNN`, `.zip.NNN`, `.7z.NNN` und `.NNN` von jedem Split-Part aus sowie beide Überspring-Bereiche einschließlich Abbruch aktiver Geschwister und Erhalt fertiger Downloads. Nach der strikten Trennung von Download- und Entpacker-Gruppierung liefen die 9 betroffenen Regressionen und alle 84 Extractor-Tests erneut erfolgreich. Ein zusätzlicher vollständiger Lauf hatte ausschließlich im fachfremden Fake-Timer-Test für den globalen Speed-Limiter einen 10.000-Timer-Abbruch; dieser Test war in den beiden vorherigen Komplettläufen und direkt danach isoliert erfolgreich.
- Vollständiger Clientlauf ohne die lokal nicht ausführbaren Symlink-Fixtures: 143 Testdateien erfolgreich, 1 optionale JVM-Testdatei übersprungen; 2.718 Tests erfolgreich und 4 übersprungen. Alle 84 unveränderten Extractor-Tests sind grün. Die Public-Release-Metadatendatei lief separat mit 22 von 24 erfolgreichen Tests; die zwei übrigen Fälle endeten unverändert bereits beim Anlegen ihrer Windows-Symlinks mit `EPERM`.
- Nach dem Offline-Link-Fix erfolgreich: TypeScript, Main-Build, Renderer-Produktionsbuild, Node-Self-Check und alle 16 Backup-API-Tests. Die bekannte Vite-Warnung betrifft den rund 582 KiB großen Renderer-Chunk.
- Release-Build `v2.0.85`: Installer und Portable-Datei wurden aus dem versionierten Release-Vorbereitungsstand erzeugt. Die Release-Prüfung bestätigte Paket- und Bundle-Version, Update-Metadaten, Artefaktnamen, Installergröße und SHA-512, Icon, Lizenzdateien sowie den entpackten Inhalt beider EXE-Archive. Das Quellarchiv enthält Paketversion `2.0.85`, verweist im ZIP-Kommentar auf den Release-Vorbereitungscommit und alle Einträge in `SHA256SUMS.txt` stimmen mit den lokalen Originalen überein.
- SHA-256 des `v2.0.85`-Setups: `c0cb2a23da9183d678027482002667e6f635e5a35f2c8e68875840c292c16946`; SHA-256 der Portable-Datei: `8593ffdd1f92bf5ee776c9734d79300638c94fef30052300e763a2366117118f`.

- Kandidat für `v2.0.84`: 256 von 256 fokussierten Proxy-Segment-, Storage-, AppController-, Arbeitsordner- und Einstellungsansichtstests erfolgreich. Die Grenzwerttests bestätigen Minimum 2, Standard 32, Maximum 80 und die Begrenzung höherer Werte auf 80.
- Vollständiger Clientlauf des `v2.0.84`-Kandidaten: 143 Testdateien erfolgreich, 1 optionale JVM-Testdatei übersprungen; 2.728 Tests erfolgreich und 4 übersprungen. Ausschließlich die zwei bekannten Windows-Symlink-Fixtures scheiterten mangels Berechtigung vor ihrer Produktassertion mit `EPERM`. Alle 265 Download-Manager- und 84 Extractor-Tests sind vollständig grün.
- Für den `v2.0.84`-Kandidaten sind TypeScript, Main-Build, Renderer-Produktionsbuild, Node-Self-Check und alle 16 Backup-API-Tests erfolgreich. Die bekannte Vite-Warnung betrifft den rund 581 KiB großen Renderer-Chunk.
- Release-Build `v2.0.84`: Installer und Portable-Datei wurden aus dem versionierten Release-Vorbereitungsstand erzeugt. Die Release-Prüfung bestätigte Paket- und Bundle-Version, Update-Metadaten, Artefaktnamen, Installergröße und SHA-512, Icon, Lizenzdateien sowie den entpackten Inhalt beider EXE-Archive. Das Source-Archiv enthält Paketversion `2.0.84`; alle Einträge in `SHA256SUMS.txt` stimmen mit den lokalen Originalen überein.
- SHA-256 des `v2.0.84`-Setups: `729c806c3c869c7f03762dcf25703ff1163b1a7e91dd8236248f7f2275edd856`; SHA-256 der Portable-Datei: `228ea64b0dc575854342ba96eabab81006d21e1fc3fc9b6cdd60b5664da408bc`.
- Veröffentlichung `v2.0.84`: Der annotierte Tag zeigt auf GitHub und Forgejo exakt auf `29c1697b46f354cffa96de95379b7e66bb818cce`. GitHub führt `v2.0.84` als neuesten stabilen Release mit exakt dem englischen Release-Text; Forgejo veröffentlicht denselben stabilen Versionsstand mit exakt dem deutschen Text. Beide Plattformen besitzen dieselben sechs benannten Assets. Alle zwölf veröffentlichten Dateien wurden erneut heruntergeladen; Dateigröße und SHA-256 stimmen auf beiden Plattformen exakt mit den lokalen Originalen überein.
- Unveröffentlichte Sofortanlage der Arbeitsordner: 344 von 344 fokussierten AppController-, Ordner-, Einstellungsansichts- und Übersetzungstests erfolgreich. Abgedeckt sind die unmittelbare Anlage aller aktivierten Ziele beim Speichern, ein erneuter unveränderter Speichervorgang bei bereits aktiver Option und das Ausbleiben der Ordneranlage, wenn die Einstellungen nicht persistiert werden können. TypeScript, Main-Build, Renderer-Produktionsbuild und Node-Self-Check sind erfolgreich; die bekannte Vite-Warnung betrifft den rund 581 KiB großen Renderer-Chunk.
- Vollständiger Clientlauf nach der Sofortanlage: 143 Testdateien erfolgreich, 1 optionale JVM-Testdatei übersprungen; 2.728 Tests erfolgreich und 4 übersprungen. Ausschließlich die zwei bekannten Windows-Symlink-Fixtures scheiterten mangels Berechtigung vor ihrer Produktassertion mit `EPERM`. Alle 265 Download-Manager- und 84 Extractor-Tests sind weiterhin vollständig grün.
- Kandidat für `v2.0.83`: 392 von 392 fokussierten Download-Manager- und Storage-Tests erfolgreich. Die neuen Regressionen beweisen den einmaligen Neudownload bei CRC trotz gültiger RAR-Signatur, den persistenten Schutz vor einem zweiten automatischen Neudownload, die unveränderte Passwortfehler-Abgrenzung sowie das Löschen des Schutzes beim manuellen Reset.
- Vollständiger Clientlauf des Kandidaten: 143 Testdateien erfolgreich, 1 optionale JVM-Testdatei übersprungen; 2.725 Tests erfolgreich und 4 übersprungen. Nur die zwei bekannten Windows-Symlink-Fixtures endeten mangels Berechtigung vor ihrer Produktassertion mit `EPERM`. Alle 265 Download-Manager- und 84 Extractor-Tests sind vollständig grün.
- TypeScript-Prüfung, Main-Build, Renderer-Produktionsbuild, Node-Self-Check und alle 16 Backup-API-Tests sind erfolgreich. Die bekannte Vite-Warnung betrifft weiterhin den rund 581 KiB großen Renderer-Chunk.
- Release-Build `v2.0.83`: Installer und Portable-Datei wurden aus dem versionierten Release-Vorbereitungsstand erzeugt. Die Release-Prüfung bestätigte Paket- und Bundle-Version, Update-Metadaten, Artefaktnamen, Dateigröße und SHA-512 des Installers, Icon, Lizenzdateien sowie den entpackten Inhalt beider EXE-Archive.
- SHA-256 des `v2.0.83`-Setups: `ab3bf10ce9a42244a30bc48f40a15646aacebe6e63b69c520da7e4f2fd59fedd`; SHA-256 der Portable-Datei: `93883c8a047f3352f642ac76fd9e68f2da1096692e2c5937d99788ff8ae8ba7e`.
- Veröffentlichung `v2.0.83`: Der annotierte Tag und beide Release-Branches zeigen auf GitHub und Forgejo exakt auf `6460dab50e188139ffd806cd94f5b0ae102d2ac0`. GitHub führt `v2.0.83` als neuesten stabilen Release mit englischem Text; Forgejo veröffentlicht denselben stabilen Versionsstand mit deutschem Text. Beide Plattformen besitzen dieselben sechs benannten Assets. Alle sechs Forgejo-Assets wurden über die öffentliche Downloadadresse erneut geladen; Dateigröße und SHA-256 stimmen exakt mit den lokalen Originalen und den auf GitHub veröffentlichten Digests überein. `latest.yml` nennt Version `2.0.83`, Installergröße `90.665.593` Bytes und den erneut bestätigten SHA-512-Wert des Setups.
- Kandidat für `v2.0.82`: TypeScript-Prüfung und 616 fokussierte Ordner-, Storage-, Renderer-, Einstellungs-, Übersetzungs-, Account- und Downloadansichtstests erfolgreich. Die Ordnerregressionen bestätigen den ausgeschalteten Standard, selektive Zielerstellung, den Erhalt vorhandener Dateien und die Fehlerisolation zwischen Zielen.
- Vollständiger Clientlauf: 143 Testdateien erfolgreich, 1 optionale JVM-Testdatei übersprungen; 2.725 Tests erfolgreich und 4 übersprungen. Nur die zwei bekannten Windows-Symlink-Fixtures endeten mangels Berechtigung vor ihrer Produktassertion mit `EPERM`. Die unveränderten 265 Download-Manager- und 84 Entpacktests sind vollständig grün.
- Backup-API: 16 von 16 Tests erfolgreich.
- TypeScript, Main-Build, Renderer-Build und Node-Self-Check sind erfolgreich. Die bekannte Vite-Warnung betrifft den rund 581 KiB großen Renderer-Chunk.
- Release-Build `v2.0.82`: Installer und Portable-Datei wurden aus dem versionierten Release-Vorbereitungsstand erzeugt. Die Release-Prüfung bestätigte Paket- und Bundle-Version, Update-Metadaten, Artefaktnamen, Dateigröße und SHA-512 des Installers, Icon, Lizenzdateien sowie den entpackten Inhalt beider EXE-Archive.
- SHA-256 des `v2.0.82`-Setups: `90b869745344e1a3bd8407ea698fb4693b5f7fc8546ce98c258c27bff39d54ed`; SHA-256 der Portable-Datei: `798982e323dd4152e6ebebe2f7ad34454004e489d7e1f716172f7246add2f77b`.
- Veröffentlichung `v2.0.82`: Der annotierte Tag zeigt auf GitHub und Forgejo exakt auf `8613afbb0998d84b26d57318bba4ab97cd974c96`. Beide stabilen Releases besitzen dieselben sechs benannten Assets; GitHub verwendet den englischen und Forgejo den deutschen Release-Text. Größen und SHA-256 der sechs GitHub-Assets stimmen mit den lokalen Originalen überein. Alle sechs Forgejo-Assets wurden erneut heruntergeladen und stimmen ebenfalls exakt mit den erwarteten SHA-256-Werten überein.
- Forgejo-Veröffentlichung `v2.0.81`: Das nachgeholte stabile Release besitzt den deutschen Text und dieselben sechs Assets wie GitHub. Alle sechs Forgejo-Dateien wurden erneut heruntergeladen; Größe und SHA-256 stimmen mit den bereits für GitHub verifizierten Originalen überein.
- Die öffentlichen Forgejo-Beschreibungen von `v2.0.75`, `v2.0.76` und `v2.0.77` wurden auf Deutsch aktualisiert und anschließend auf ihren Tag-Seiten geprüft. GitHub bleibt für die entsprechenden Release-Changelogs englisch.

## Verifizierungen vom 31. August 2026

- Release-Build `v2.0.81`: Installer und Portable-Datei wurden aus dem versionierten Release-Vorbereitungsstand neu erzeugt. Die Release-Prüfung bestätigte Paket- und Bundle-Version, Update-Metadaten, Artefaktnamen, Dateigröße und SHA-512 des Installers, Icon, Lizenzdateien sowie den entpackten Inhalt beider EXE-Archive. Von den 24 Public-Release-Metadatentests waren 22 erfolgreich; nur die zwei unter Windows ohne Symlink-Berechtigung nicht ausführbaren Fixtures endeten vor ihrer Produktassertion mit `EPERM`.
- SHA-256 des `v2.0.81`-Setups: `5278ef9629de484861db99a6879e127f993f1a79d1dd786982205d29c73165bb`; SHA-256 der Portable-Datei: `758f7de6eaed1540931a1e1bea7117f8cc74eff42c47390f671a6d6d83f710f5`.
- Kandidat für `v2.0.81`: 382 von 382 fokussierte Account-, Proxy-, Online-Backup-, Import-Transaktions-, Auswahl-, Übersetzungs- und Einstellungsansichtstests erfolgreich. Die Tests beweisen insbesondere, dass Proxy-Zugangsdaten nicht im Server-Record stehen, der verschlüsselte Roundtrip den exakten Listeninhalt erhält, ein fehlgeschlagener Import die vorherige verwaltete Liste wiederherstellt und alte Online-Sicherungen Proxy-only ohne eingebettete Liste deaktivieren.
- Vollständiger Clientlauf des Kandidaten: 142 Testdateien erfolgreich, 1 optionale JVM-Testdatei übersprungen; 2.718 Tests erfolgreich und 4 übersprungen. Nur die zwei bekannten Windows-Symlink-Fixtures endeten mangels Berechtigung vor ihrer Produktassertion mit `EPERM`. Zusätzlich erfolgreich: TypeScript, Main-Build, Renderer-Build, Node-Self-Check und 16 von 16 Backup-API-Tests. Die bekannte Vite-Warnung betrifft nun den rund 580 KiB großen Renderer-Chunk.
- Account-`Strg+A` nach `v2.0.80`: 358 von 358 Auswahl-, Account-, Einstellungs-, Download-, Linksammler- und Verlaufstests erfolgreich. TypeScript und der Produktions-Renderer-Build sind ebenfalls erfolgreich; die bekannte Vite-Warnung zum rund 577 KiB großen Renderer-Chunk bleibt bestehen.
- Veröffentlichung `v2.0.80`: Der annotierte Tag zeigt auf beiden Git-Remotes exakt auf `1628f23023c93efcb222c63913f9d2508a9a5e6c`. GitHub und Forgejo veröffentlichen denselben stabilen Release mit denselben sechs Assets. Alle zwölf erneut heruntergeladenen Dateien stimmen jeweils in Größe und SHA-256 exakt mit den lokalen Originalen überein; GitHub führt `v2.0.80` als Latest Release.
- Release-Build `v2.0.80`: Installer und Portable-Datei wurden aus dem versionierten Release-Vorbereitungsstand neu erzeugt. Die Release-Prüfung bestätigte Paket- und Bundle-Version, Update-Metadaten, Artefaktnamen, Dateigröße und SHA-512 des Installers, Icon, Lizenzdateien sowie den entpackten Inhalt beider EXE-Archive. Von den 24 Public-Release-Metadatentests waren 22 erfolgreich; nur die zwei unter Windows ohne Symlink-Berechtigung nicht ausführbaren Fixtures endeten vor ihrer Produktassertion mit `EPERM`.
- SHA-256 des `v2.0.80`-Setups: `a841d4b52962d52e335fd7f8c2f1fcda0b4f642a66a0101db15665326f6d332a`; SHA-256 der Portable-Datei: `1a5bd12c13e33b620c83958ef7d7e376d028cee32a6f8eb5ff123216bbd01012`.
- Anzeige-/Reset-Fix für `v2.0.80`: 265 von 265 Download-Manager-Tests sowie 372 von 372 Downloadansichts-/Übersetzungstests erfolgreich. Der vollständige Clientlauf erreichte 2.690 erfolgreiche und 4 übersprungene Tests; zusätzlich zu den zwei bekannten Windows-Symlink-Fixtures deckte er eine Snapshot-Seitenwirkung auf. Nach deren Korrektur bestanden die 10 betroffenen Geschwindigkeits-, Restmengen-, Reset-, Shell- und Übersetzungsregressionen vollständig. Der neue Dateisystemtest bestätigt zusätzlich, dass der selektive Paket-Reset erfolgreiche Dateien erhält und nur die beiden ausgewählten Fehlerdateien entfernt und neu einreiht.
- Nach dem Anzeige-/Reset-Fix erfolgreich: TypeScript, Main-Build, Renderer-Build, Node-Self-Check und 16 von 16 Backup-API-Tests. Die bekannte Vite-Warnung zum rund 577 KiB großen Renderer-Chunk bleibt bestehen.
- Veröffentlichung `v2.0.79`: Der annotierte Tag zeigt auf beiden Git-Remotes exakt auf `04e5ab71d2e77e68256c77b6d0fff48fa86188e8`. GitHub und Forgejo veröffentlichen denselben stabilen Release mit denselben sechs Assets. Alle zwölf erneut heruntergeladenen Dateien stimmen jeweils in Größe und SHA-256 exakt mit den lokalen Originalen überein; GitHub führt `v2.0.79` als Latest Release.
- Release-Build `v2.0.79`: Installer und Portable-Datei wurden aus dem versionierten Release-Vorbereitungsstand neu erzeugt. Die Release-Prüfung bestätigte Paket- und Bundle-Version, Update-Metadaten, Artefaktnamen, Dateigröße und SHA-512 des Installers, Icon, Lizenzdateien sowie den entpackten Inhalt beider EXE-Archive. Von den 24 Public-Release-Metadatentests waren 22 erfolgreich; nur die zwei unter Windows ohne Symlink-Berechtigung nicht ausführbaren Fixtures endeten vor ihrer Produktassertion mit `EPERM`.
- SHA-256 des `v2.0.79`-Setups: `eccfe029f32aaf198c0597fdbb7874540ead39737616879baf1a17bebdf13450`; SHA-256 der Portable-Datei: `2f32b825e03a36ae842f2aa2b9a73c420657d812046c23bf4cbacf6a63ae2333`.
- Proxy-Integritäts-Hotfix für `v2.0.79`: 15 von 15 Proxy-Segmenttests und 9 von 9 Manifest-Integritätstests erfolgreich. Die neuen End-to-End-Regressionen beweisen vollständiges Neuladen nach einer abweichenden 2-KiB-Nullantwort, Akzeptanz einer unabhängig bestätigten legitimen Nullfolge und Erkennung einer nach dem Netzwerkempfang in die Temp-Datei injizierten 1-KiB-Abweichung durch den Readback-Digest.
- Vollständiger Client-Lauf des Hotfixes: 140 Testdateien erfolgreich, 1 optionale JVM-Testdatei übersprungen; 2.685 Tests erfolgreich und 4 übersprungen. Nur die zwei bekannten Symlink-Fixtures scheiterten vor ihrer Produktassertion mit Windows-`EPERM`.
- Nach dem Hotfix erfolgreich: TypeScript, Main-Build, Renderer-Build, Node-Self-Check und 16 von 16 Backup-API-Tests. Die bekannte Vite-Warnung zum rund 576 KiB großen Renderer-Chunk bleibt bestehen.
- Veröffentlichung `v2.0.78`: Der annotierte Tag und beide Release-Branches zeigen bei GitHub und Forgejo exakt auf `48c3677296f54d389f0982fc79edf2788a6d1191`. Beide öffentlichen Releases enthalten dieselben sechs Assets; alle zwölf erneut heruntergeladenen Dateien stimmen in Größe und SHA-256 exakt mit den lokalen Originalen überein. GitHub führt `v2.0.78` als Latest Release.
- Release-Build `v2.0.78`: Installer und Portable-Datei wurden aus dem versionierten Quellstand neu erzeugt. Die Release-Prüfung bestätigte Paket- und Bundle-Version, Update-Metadaten, Artefaktnamen, SHA-512, Icon, Lizenzdateien sowie den entpackten Inhalt beider EXE-Archive. Von den 24 Public-Release-Metadatentests waren 22 erfolgreich; nur die zwei unter Windows ohne Symlink-Berechtigung nicht ausführbaren Fixtures endeten vor ihrer Produktassertion mit `EPERM`.
- SHA-256 des `v2.0.78`-Setups: `caaef1ce83d533cf3095353f729b8ecedecb0adc6d9a372d4cfd5249551767a3`; SHA-256 der Portable-Datei: `92e12f210ac3160a4967fa5de491092dff932025293e20984a3ec9744e9d6f32`.
- Sidebar-Live-Takt-Fix für `v2.0.78`: Bei laufenden Queues ab 500 Einträgen bleibt der Sitzungs-Bytezähler trotz des 1,5-Sekunden-Statistik-Caches in jedem 750-Millisekunden-Live-Snapshot aktuell. Die Bedeutung des kumulativen Sitzungszählers bleibt unverändert. Der vollständige Download-Manager-Lauf war mit 263 von 263 Tests erfolgreich.
- Vollständiger Client-Lauf nach dem Live-Takt-Fix: 2.658 Tests erfolgreich und 4 optionale JVM-Tests übersprungen; genau ein unveränderter Entpacktest überschritt unter paralleler Gesamtlast einmal sein 5-Sekunden-Limit. Der unmittelbar folgende isolierte Lauf aller 84 Entpacktests war vollständig grün. TypeScript, Main-/Renderer-Build, Self-Check und 16 von 16 Backup-API-Tests waren ebenfalls erfolgreich; die bekannte Vite-Warnung zum rund 576 KiB großen Renderer-Chunk bleibt bestehen.
- 32/40-Limitanpassung für `v2.0.78`: Proxy-Scheduler, Storage, Einstellungen, Renderer-Projektion und visuelle Fixtures 229 von 229 Tests erfolgreich. Die Main-Normalisierung deckt Standard 32, Minimum 2, Maximum 40 und Werte oberhalb des Maximums direkt ab.
- Vollständiger Client-Lauf nach der 32/40-Anpassung ohne die zwei lokal nicht ausführbaren Symlink-Fixtures: 140 Testdateien erfolgreich, 1 JVM-Testdatei übersprungen; 2.658 Tests erfolgreich und 4 übersprungen. Die übrigen 22 Public-Release-Metadatentests liefen separat erfolgreich. Alle 84 Entpacktests sind unverändert grün.
- Nach der 32/40-Anpassung erfolgreich: TypeScript, vollständiger Main-/Renderer-Build, Self-Check und 16 von 16 Backup-API-Tests. Die bekannte Vite-Warnung zum rund 576 KiB großen Renderer-Chunk bleibt bestehen.
- Proxy-Scheduler-Regressionen für `v2.0.77`: 11 von 11 erfolgreich. Abgedeckt sind 32 rollierend vergebene Chunks, deutlich häufigere Chunk-Übernahme durch den schnellen von zwei unterschiedlich verzögerten Proxys, zwei überlappende Downloads mit je höchstens der Hälfte eines gemeinsamen Viererlimits, Ausschluss des festen API-Proxys, Ersatz ausgefallener Proxys, exakte Dateiinhalte und Fortschrittsrückrechnung sowie eine erfolgreiche Fortsetzung nach transientem Origin-HTTP-503 mit Reduktion neuer paralleler Requests von 6 auf höchstens 4.
- Paketfortschritt, Einstellungen und Proxy-Scheduler gezielt: 232 von 232 Tests erfolgreich. Ein Paket mit 2,25 von 18,60 Größeneinheiten zeigt nun 12 Prozent statt einer dateibasierten Abweichung.
- Storage einschließlich neuem Standardwert 20: 126 von 126 Tests erfolgreich.
- Finaler vollständiger Client-Lauf ohne die zwei lokal nicht ausführbaren Symlink-Fixtures: 140 Testdateien erfolgreich, 1 JVM-Testdatei übersprungen; 2.656 Tests erfolgreich und 4 übersprungen. Die übrigen 22 Public-Release-Metadatentests liefen separat erfolgreich; nur die zwei Windows-Symlink-Fixtures wurden übersprungen. Alle 84 Entpacktests sind unverändert grün.
- Für `v2.0.77` erfolgreich: TypeScript, vollständiger Main-/Renderer-Build, Self-Check und 16 von 16 Backup-API-Tests. Die bekannte Vite-Warnung zum rund 576 KiB großen Renderer-Chunk bleibt bestehen.
- Release-Build `v2.0.77`: Installer und Portable-Datei wurden aus dem versionierten Quellstand neu erzeugt. Die Release-Prüfung bestätigte Paket- und Bundle-Version, Update-Metadaten, Artefaktnamen, SHA-512, Icon, Lizenzdateien sowie den entpackten Inhalt beider EXE-Archive.
- SHA-256 des `v2.0.77`-Setups: `3519234aa07a43f24873175ca50fcd23480fd2f2c10a32813727f54f8e7363c0`; SHA-256 der Portable-Datei: `b1129d2441fec1a5c23eea4a967ff319f33e5e9e25b304da81163a21a154ab9b`.
- Proxy-Parser gegen die bereitgestellte externe Liste geprüft: 1.000 von 1.000 Einträgen gültig; dabei wurden weder Proxy-Verbindungen aufgebaut noch Listeneinträge ausgegeben.
- Proxy-Segmenttests für `v2.0.76`: 9 von 9 erfolgreich. Abgedeckt sind die feste Auswahl nach gültigem 1-basiertem Listeneintrag, vier parallele authentifizierte CONNECT-Proxys mit exakten Byte-Bereichen und identischem Dateiergebnis, Ersatz eines abgelehnten Segment-Proxys, zwei gleichzeitige Dateien unter einem gemeinsamen Verbindungslimit ohne gleichzeitige Doppelvergabe und ohne Nutzung des reservierten API-Proxys, getrennte HTTP-503-Diagnose aus Probe und Segment, sauberer Einzel-Proxy-Fallback ohne Restdatei bei ignoriertem Range-Header sowie Abbruch mit Fortschritts-Rückrechnung und Temp-Bereinigung.
- Vollständiger Client-Lauf nach dem Proxy-Hotfix ohne den unter Windows nicht ausführbaren Symlink-Metadatentest: 140 Testdateien erfolgreich, 1 JVM-Testdatei übersprungen; 2.653 Tests erfolgreich und 4 übersprungen. Darin sind alle 84 bestehenden Entpacktests unverändert grün.
- Nach dem Proxy-Hotfix erfolgreich: TypeScript, vollständiger Main-/Renderer-Build, Self-Check und 16 von 16 Backup-API-Tests. Die bekannte Vite-Warnung zum rund 576 KiB großen Renderer-Chunk bleibt bestehen.
- Release-Build `v2.0.76`: Installer und Portable-Datei wurden aus dem versionierten Quellstand neu erzeugt. Die Release-Prüfung bestätigte Paket- und Bundle-Version, Update-Metadaten, Artefaktnamen, SHA-512, Icon, Lizenzdateien und den entpackten Inhalt.
- SHA-256 des `v2.0.76`-Setups: `e682bff9f81827503b27ff16f19f2a288db872050a8ed21884ffdecdfdf84840`; SHA-256 der Portable-Datei: `92b0e0ed627ff5c588862edf410bfa8231f79cc9ee72ce117e68b654a675471e`.
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
- Release-Build `v2.0.75`: Installer und Portable-Datei wurden aus dem versionierten Quellstand neu erzeugt. Die Release-Prüfung bestätigte Paket- und Bundle-Version, Update-Metadaten, Artefaktnamen, SHA-512, Icon, Lizenzdateien sowie den entpackten Inhalt beider EXE-Archive.
- SHA-256 des Setups: `586082f296d1c73cc1d1e022ae5a30c3ee821c701844532bccc7895e08040510`; SHA-256 der Portable-Datei: `44f09546b99e68048da444a207be5da470397fff420f3f231696fe3733e074a9`.

## Bekannte Probleme und Risiken

- Die beiden `main`-Branches sind veraltet und untereinander nicht synchron. Sie dürfen nicht versehentlich als neueste Basis verwendet oder destruktiv zurückgesetzt werden.
- Beide vorhandenen Remotes sind öffentlich, obwohl neue Projekte gemäß Arbeitsregeln privat gespiegelt werden sollen. Eine Sichtbarkeitsänderung ist eine bewusste externe Entscheidung und wurde nicht eigenmächtig vorgenommen.
- `npm audit` meldet aktuell 36 Treffer: 2 niedrig, 5 mittel, 25 hoch und 4 kritisch. Direkte Treffer betreffen unter anderem Electron 31.7.7, Vite 6.4.1, Vitest 2.1.9, concurrently 9.2.1 und electron-builder 25.1.8. Ein Upgrade braucht einen eigenen getesteten Migrationsschritt; kein automatisches `npm audit fix` ausführen.
- Der separate Backup-API-Baum hat aktuell 0 Audit-Treffer.
- Windows ohne Developer Mode beziehungsweise passende Berechtigung kann die zwei Symlink-basierten Public-Release-Metadaten-Tests nicht ausführen.
- Proxy-Bündelung garantiert keine lineare Addition der Einzelgeschwindigkeiten. Ergebnis und Stabilität hängen unter anderem von Proxy-Latenz, Proxy-Bandbreite, Provider-/CDN-IP-Bindung, Range-Unterstützung, Zielserver-Limits, Dateigröße und lokaler Schreibgeschwindigkeit ab. Nach einem späten Segmentfehler kann vor dem festen Einzel-Proxy-Fallback zusätzlicher Providerverkehr angefallen sein.
- Der feste API-Proxy wird absichtlich nicht automatisch rotiert, damit API- und Login-Sitzungen eine stabile Ausgangs-IP behalten. Bei Ausfall muss ein anderer gültiger Listeneintrag ausgewählt werden; bis dahin schlägt Proxy-only geschlossen fehl.
- Die bereitgestellte Proxy-Liste wurde mit dem ausdrücklich bereitgestellten Real-Debrid-Testlink erfolgreich real geprüft. Die Messung gilt nur für diesen Link, diesen Zeitpunkt und einen parallelen Download. Der neue rollierende Scheduler ist mit lokalen End-to-End-Servern verifiziert; ein echter Mehrdatei-Test gegen Real-Debrid benötigt eine separat freigegebene Installation von `v2.0.77`.
- Der Arbeitsordner enthält `&`; ohne PowerShell-7-Skriptshell können npm-`cmd`-Shims fehlschlagen.
- Es gibt keine `.github`-Workflows und damit keine serverseitige CI-Absicherung im GitHub-Repository.
- Der Renderer-Bundle-Chunk liegt über Vites 500-KiB-Warnschwelle.
- Die Shutdown-Wächter können einen vollständig synchron blockierten Main-Thread nicht präemptieren. Im äußersten Fall beträgt die kombinierte Grenze knapp 12 Sekunden: bis zu 10 Sekunden Controller-Shutdown plus 2 Sekunden Quit-Bestätigung.
- Beim erzwungenen Exit können letzte asynchrone Logzeilen oder Benachrichtigungen fehlen; die wesentlichen Queue-, Settings-, Statistik- und Collector-Daten werden zuvor synchron gesichert. Laufende externe Extraktions-/Remux-Prozesse bleiben ein separater späterer Härtungspunkt.
- Lifecycle-, Debug-Server-, Persistenz-, Updater- und Proxy-only-Änderungen sind als `v2.0.75` veröffentlicht. Eine davon getrennte Installation oder ein produktiver Neustart auf einem Server wurde nicht vorgenommen.
- Der Proxy-Gesamtlimit-Hotfix ist als `v2.0.76` veröffentlicht. Eine Serverinstallation oder ein produktiver Neustart wurde nicht vorgenommen.
- Der faire rollierende Proxy-Scheduler und der bytebasierte Paketfortschritt sind als `v2.0.77` veröffentlicht. Eine Serverinstallation oder ein produktiver Neustart wurde nicht vorgenommen.
- Der 32/40-Proxybereich und der synchrone Live-Takt von „Sitzung“ und „Verbleibend“ sind als `v2.0.78` veröffentlicht. Eine Serverinstallation oder ein produktiver Neustart wurde nicht vorgenommen.
- Der Proxy-Readback- und Nullbereich-Hotfix ist als `v2.0.79` auf GitHub und Forgejo veröffentlicht, aber noch nicht auf einem produktiven System installiert oder gestartet.
- Die einheitliche Geschwindigkeitsanzeige und die getrennten Paket-Reset-Optionen sind als `v2.0.80` auf GitHub und Forgejo veröffentlicht, aber noch nicht auf einem produktiven System installiert oder gestartet.
- Die Account-Übersicht unterstützt `Strg+A`; Proxy-only-Accountfehler werden verständlich aufgelöst und Online-Sicherungen können die Proxy-Liste verschlüsselt portieren. `v2.0.81` ist auf GitHub und Forgejo veröffentlicht. Eine produktive Installation oder ein Neustart wurde nicht vorgenommen.
- Die optionale Arbeitsordner-Erstellung, der neue Kategoriename und die feinere TiB-Restanzeige sind als `v2.0.82` auf GitHub und Forgejo veröffentlicht. Eine produktive Installation oder ein Neustart ist nicht Bestandteil des Releases.
- Die einmalige CRC-Neudownload-Wiederherstellung ist als `v2.0.83` auf GitHub und Forgejo veröffentlicht. Entpack-, Passwort- und Extractor-Fallbacklogik blieben unverändert; eine produktive Installation oder ein Neustart ist nicht Bestandteil des Releases.
- Die unmittelbare Arbeitsordner-Anlage beim Speichern und der Proxybereich mit Standard 32 sowie Maximum 80 sind als `v2.0.84` auf GitHub und Forgejo veröffentlicht. Eine produktive Installation oder ein Neustart ist nicht Bestandteil des Releases.
- Die Live-Erkennung offline gewordener Quelllinks und der wählbare Überspring-Bereich sind als `v2.0.85` vorbereitet und verifiziert, aber noch nicht veröffentlicht. Entpack-, Passwort- und Nachbearbeitungslogik bleiben unverändert.

## Nächste sinnvolle Schritte

1. Nach einer getrennt freigegebenen Installation von `v2.0.83` einen echten CRC-Fall über „Entpack-Fehler zurücksetzen“ prüfen und bestätigen, dass genau ein frischer Download erfolgt und ein zweiter identischer Upstream-Fehler sichtbar bleibt.
2. Nach einer getrennt freigegebenen Serverinstallation die neue Arbeitsordner-Option und die feinere Restanzeige mit der großen echten Queue prüfen.
3. Nach einer getrennt freigegebenen Serverinstallation die Account-Fehlerführung, den verschlüsselten Proxy-Listen-Import und `Strg+A` am echten Zielsystem prüfen.
4. Nach einer getrennt freigegebenen Serverinstallation die einheitliche Geschwindigkeitsanzeige und den selektiven Paket-Reset am echten Queue-Fall prüfen.
5. Nach einer getrennt freigegebenen Serverinstallation den Ablauf Real-Debrid-Web-Download, Hauptfenster schließen und unmittelbar neu starten am echten Zielsystem verifizieren; vor jedem Eingriff Prozessbaum und Logtail sichern.
6. Sicherheitsabhängigkeiten in einem separaten Upgrade-Branch aktualisieren, Electron-/Vite-/Vitest-Major-Wechsel einzeln testen und danach den vollständigen Windows-Paketpfad prüfen.
7. Eine nichtdestruktive Strategie zur Bereinigung der divergierenden `main`-Branches abstimmen; kein Force-Push ohne ausdrückliche Freigabe.
8. Optional Developer Mode für lokale Symlink-Tests bereitstellen oder die Test-Fixtures plattformgerecht ohne privilegierte Symlinks gestalten.
