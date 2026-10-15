# MCP-Fernzugriff

Der Downloader und der Uploader verwenden einen getrennten HTTPS-Vermittlungsdienst. Es wird kein eingehender Port auf dem Rechner geöffnet. Die App muss laufen; minimierte Fenster sind ausreichend. Der Vermittlungsdienst führt keine App-Aktionen aus und speichert keine Protokollinhalte oder Zugangsdaten im Klartext.

## Aktivierung im Downloader

Unter **Hilfe → MCP-Fernzugriff** den Installationsnamen und die Berechtigungen prüfen, dann **Aktivieren** wählen. Standardmäßig sind Status, normale Steuerung und die konfigurierten Arbeitsordner freigegeben. Geheimniszugriff ist ausgeschaltet. Zusätzliche Ordner werden ausschließlich lokal freigegeben.

**Verbindungscode anzeigen** und **Verbindungscode kopieren** geben einen geheimen Zugangscode für genau diese Installation aus. Nicht in öffentliche Issues, Logs oder Screenshots einfügen. **Schlüssel erneuern** ersetzt die Identität; **Deaktivieren** sperrt die lokale Ausführung sofort und widerruft den bisherigen Zugang beim Vermittlungsdienst. Bei einem Netzwerkausfall wird der Widerruf nachgeholt. Ein dauerhafter lokaler Sperrmarker verhindert die Reaktivierung nach einem Absturz. Die Aktivierung bleibt ansonsten über normale App-Neustarts erhalten.

Die alte Ferndiagnose wird beim Start dieser App-Version stillgelegt. Alte Verbindungscodes und die Wiederherstellung der alten Fernfreigabe aus Backups aktivieren sie nicht wieder. Der lokale Support-Bundle-Export bleibt verfügbar. MCP-Schlüssel gehören nicht zu normalen Einstellungen, Support-Bundles oder Online-Sicherungen.

## Verbindung mit Codex

Die MCP-Verbindung muss einmalig in Codex eingerichtet werden. Ein Verbindungscode allein fügt einer bereits laufenden Unterhaltung keine Werkzeuge hinzu. `scripts/connect-mcp.mjs` verarbeitet einen Code aus einer privaten Datei und ergänzt die Codex-Konfiguration, ohne den Code als Kommandozeilenargument oder Terminalausgabe zu verwenden:

```powershell
node "C:\Pfad\Multi-Debrid-Downloader\scripts\connect-mcp.mjs" "C:\Privater Ordner\mcp-code.txt"
```

Der Zugriffsschlüssel wird unter Windows mit DPAPI für den aktuellen Benutzer verschlüsselt. `scripts/mcp-headers.mjs` liefert die Autorisierung bei Bedarf an Codex. Dieses Hilfsskript darf nicht manuell in ein protokolliertes Terminal ausgeführt werden, da seine Standardausgabe bestimmungsgemäß den Authorization-Header enthält. Die ursprüngliche Code-Datei bleibt unverändert und sollte nach erfolgreicher Einrichtung sicher verwahrt oder entfernt werden. Die Hilfsskripte und der geschützte Schlüssel müssen an ihrem Pfad erreichbar bleiben.

Danach die MCP-Verbindung in Codex neu starten. Bei einer Schlüsselrotation den neuen Code als neue Verbindung einrichten und die alte Verbindung entfernen. Manuelle Alternative: die HTTPS-Adresse aus dem Code als Streamable-HTTP-Server einrichten und den Client-Schlüssel über einen geschützten Header-Helper oder eine geeignete Umgebungsvariable bereitstellen. Keine Schlüssel in versionierte Konfigurationsdateien schreiben.

## Funktionen und Grenzen

Der Katalog stellt explizite Werkzeuge für Status, Pakete, Dateien, Verlauf, Statistiken, Accounts, Provider-Laufzeit, Einstellungen, Linksammler, Warteschlange, Konflikte, Entpackaktionen, Logs, zeitbegrenzte Trace-Diagnose, Benachrichtigungsstatus, lokale Dateiprüfungen, Backups und Updates bereit. Listen verwenden Pagination. Lange Dateiprüfungen können als Hintergrundauftrag mit Fortschritt und Abbruch laufen. Exportdateien werden im Speicher begrenzt aufbewahrt und in Blöcken gelesen.

Normale Änderungen verwenden die vorhandenen App-Funktionen. Löschen, Zurücksetzen, Überschreiben, Backup-Wiederherstellung, Updateinstallation und App-Neustart benötigen eine echte lokale Bestätigung, standardmäßig abgebrochen und zeitlich begrenzt. Eine vom Modell übermittelte Zustimmung ist keine Bestätigung. Normale Ausgaben und Logs bleiben auch bei aktivierter Geheimnisberechtigung bereinigt. Geheimnisse können nur über ausdrücklich dafür vorgesehene Werkzeuge ausgegeben werden.

Keine beliebige Shell, kein frei wählbarer IPC-Aufruf, kein Screenshot-/Tastatur-Fernzugriff und kein unbeschränkter Laufwerkszugriff. Browser-Login, CAPTCHA, MFA sowie das Gewähren zusätzlicher Ordner- und Geheimnisrechte bleiben lokale Benutzeraktionen. Dateisystemwurzeln, Updatequelle und das Abschalten von Proxy-only können nicht über normale entfernte Einstellungsänderungen geändert werden. Änderungen an erlaubten Einstellungen lösen dieselben Aktualisierungsschritte für Tray, Zeitplanung und Zwischenablage aus wie lokale Änderungen.

Proxy-only gilt auch für Registrierung, Polling und Schlüsselwiderruf. Bei fehlendem oder ausgefallenem Proxy wird keine direkte Verbindung versucht. Ein Ausfall beendet keine laufenden Downloads. Unklare Übertragungsergebnisse werden nicht automatisch als erfolgreiche Aktionen gemeldet und Mutationen nicht nach Verbindungsabbrüchen wiederholt.

## Fehlerhafte Archive direkt übernehmen

Unter **Hilfe → MCP-Fernzugriff** zusätzlich **Vollständige Dateien aus freigegebenen Arbeitsordnern übertragen** aktivieren. Diese Berechtigung ist standardmäßig aus; alte Konfigurationen erhalten sie nicht automatisch. Sie gilt nur zusammen mit der Dateiberechtigung und den lokal freigegebenen Ordnern. Die Nutzdatei wird unverändert übertragen und kann vertrauliche Inhalte enthalten. Anwendungsspeicher, Schlüssel, Proxy-Zugangsdaten und rohe Diagnose-Logs bleiben gesperrt.

Der Assistent kann einen fehlerhaften Eintrag und seine Logs prüfen, das betreffende Archiv mit `mdd_files_transfer_open` gezielt freigeben und auf dem Arbeits-PC abrufen. Mehrteilige Archive werden als einzelne, ausdrücklich gewählte Dateien übertragen. Ein Abruf funktioniert auch zwischen zwei Servern, wenn der Empfänger dort ausgeführt wird. Es werden keine eingehenden Ports geöffnet und keine beliebigen Upload-Zieladressen angenommen.

Beispiel für den Empfänger mit vorhandenem Node.js und den Projektabhängigkeiten:

```powershell
node "C:\Pfad\Multi-Debrid-Downloader\scripts\pull-mcp-file.mjs" "C:\Privater Ordner\mcp-code.txt" "output" "Paket\datei.part1.rar" "C:\Diagnose\datei.part1.rar"
```

Der Zielordner muss bestehen. Statt Root und relativem Dateipfad können `--transfer` und die tokenlose `media-mcp-file:v1:…`-Referenz des vorbereiteten Transfers angegeben werden. Die Referenz allein reicht nicht für einen Zugriff; sie ist kein öffentlicher Browser-Downloadlink. Derselbe private Verbindungscode wird zur Authentifizierung verwendet und nicht ausgegeben.

Der Empfänger prüft die vollständige SHA-256 der Quelle, jeden übertragenen Block und die fertige Zieldatei erneut von der Festplatte. Erst danach entsteht die endgültige Zieldatei. Die Quelle bleibt unverändert und bestehende Ziele werden nicht überschrieben. Bis zu vier Transfers sind gleichzeitig offen; ein Transfer läuft nach einer Stunde oder zehn Minuten ohne Zugriff ab. Die App muss währenddessen laufen.

Nach einem Verbindungsabbruch denselben Aufruf mit `--resume` wiederholen. `.mcp-part` und `.mcp-transfer.json` bleiben dafür neben dem Ziel erhalten; sie enthalten keinen Zugangsschlüssel. Fortsetzen akzeptiert nur dieselbe Quelle und einen passenden, erneut geprüften lokalen Dateianfang. Bei geändertem Quellinhalt bricht es ab. Nach einem harten Prozessabbruch kann zusätzlich eine `.mcp-lock` zurückbleiben; diese nur entfernen, wenn kein Empfängerprozess mehr für genau dieses Ziel läuft. Nach erfolgreicher Prüfung werden die eigenen Hilfsdateien entfernt. Ein SHA-256-Gleichstand beweist eine identische Übertragung, nicht die inhaltliche Fehlerfreiheit des ursprünglichen RAR-Archivs.

## Vermittlungsdienst

Start: `node services/mcp-relay/src/server.mjs`. Konfiguration über `HOST` (Standard `127.0.0.1`), `PORT` (Standard `9872`), `MCP_DATA_DIR`, `MCP_PREFIX` und optional `MCP_TRUST_LOOPBACK_PROXY=1` hinter einem ausschließlich lokalen Reverse-Proxy. Der Dienst muss hinter HTTPS laufen. Er darf nicht mit Root-Rechten oder unter dem Benutzer eines Backup-Dienstes laufen.

`GET /health` ist eine minimale, öffentliche Zustandsprüfung. Der versionierte Vertrag steht in [PROTOCOL.md](PROTOCOL.md). Agent- und Client-Token sind getrennt; es gibt keine öffentliche Installationsliste. Registrierung, aktive Sitzungen, Anfragen, Nutzlasten und Laufzeiten sind begrenzt. Registry-Dateien enthalten nur Hashes und Installationsmetadaten. Widerrufene Identitäten bleiben als Sperreinträge erhalten; sie zählen nicht als aktive Installationen. Bei 4.096 Gesamteinträgen ist eine kontrollierte administrative Bereinigung erforderlich.

Vor der Inbetriebnahme: Nginx-Konfiguration sichern, Sicherung verifizieren, neue isolierte Route und Dienst mit Testdaten prüfen, Konfiguration validieren, erst dann Nginx neu laden. Bestehende Backup-Dienste nicht neu starten oder verändern. Rücknahme: neue Route entfernen, validieren und Nginx neu laden, anschließend ausschließlich den neuen MCP-Dienst stoppen.
