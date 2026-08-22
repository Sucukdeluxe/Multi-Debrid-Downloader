import type { AppLanguage } from "../shared/types";

const pairs = [
  ["Downloads", "Downloads"], ["Linksammler", "Link collector"], ["Einstellungen", "Settings"], ["Verlauf", "History"], ["Statistiken", "Statistics"],
  ["Datei", "File"], ["Hilfe", "Help"], ["Kontomenü", "Account menu"], ["Allgemein", "General"], ["Accounts", "Accounts"],
  ["Hauptnavigation", "Main navigation"], ["Globale Aktionen", "Global actions"], ["Anwendungsmenü", "Application menu"], ["Seitenleiste einklappen", "Collapse sidebar"], ["Seitenleiste ausklappen", "Expand sidebar"],
  ["Aktuelle Download-Geschwindigkeit (geglättet)", "Current download speed (smoothed)"], ["Einstellungsbereich", "Settings area"],
  ["Entpacken", "Extraction"], ["Geschwindigkeit", "Speed"], ["Bereinigung", "Cleanup"], ["Updates", "Updates"],
  ["Einstellungen speichern", "Save settings"], ["Gespeichert", "Saved"], ["Ungespeicherte Änderungen", "Unsaved changes"], ["Wird gespeichert…", "Saving…"], ["Speichern fehlgeschlagen", "Save failed"],
  ["Sprache", "Language"], ["Speicherort", "Storage location"], ["Download-Verhalten", "Download behavior"], ["Oberfläche und Bedienung", "Interface and controls"], ["Discord-Benachrichtigungen", "Discord notifications"],
  ["Speicherort, Download-Verhalten, Verlauf, Oberfläche und Benachrichtigungen.", "Storage location, download behavior, history, interface and notifications."],
  ["Download-Ordner", "Download folder"], ["Paketname (optional)", "Package name (optional)"], ["Max. gleichzeitige Downloads", "Max. concurrent downloads"], ["Automatische Wiederholungen", "Automatic retries"],
  ["Zielordner für heruntergeladene Dateien.", "Destination folder for downloaded files."],
  ["Beim Start automatisch fortsetzen", "Resume automatically on startup"], ["Zwischenablage überwachen", "Monitor clipboard"], ["Verlauf speichern", "Save history"], ["Nur aktuelle Session", "Current session only"], ["Nur letzte 100 Einträge", "Last 100 entries only"], ["Nur letzte 250 Einträge", "Last 250 entries only"], ["Dauerhaft", "Permanent"],
  ["Maximale Verlauf-Einträge", "Maximum history entries"], ["Einträge löschen älter als (Tage)", "Delete entries older than (days)"], ["Neue Pakete eingeklappt zeigen", "Show new packages collapsed"], ["Animationen", "Animations"],
  ["In den Infobereich minimieren", "Minimize to tray"], ["Vor dem Löschen nachfragen", "Confirm before deleting"], ["Download-Liste mitsichern", "Include download list in backup"],
  ["Ferndiagnose-Einstellungen mitsichern", "Include remote diagnostics settings in backup"], ["Webhook-Adresse", "Webhook address"], ["Discord-Erwähnung (optional)", "Discord mention (optional)"],
  ["Melden, wenn ein Paket fertig ist", "Notify when a package completes"], ["Melden, wenn ein Paket fehlschlägt", "Notify when a package fails"], ["Melden, wenn alles fertig ist", "Notify when everything completes"],
  ["Erfolgsmeldungen senden", "Send success notifications"], ["Gesammelt (alle 2 Minuten)", "Grouped (every 2 minutes)"], ["Jedes Paket einzeln", "Each package individually"],
  ["Melden, wenn der gesamte Lauf fertig ist", "Notify when the entire run completes"], ["Melden, wenn die Restmenge unterschritten wird", "Notify when the remaining amount falls below the threshold"], ["Restmengenschwelle (GB)", "Remaining amount threshold (GB)"],
  ["Melden, wenn Downloads stillstehen", "Notify when downloads stall"], ["Stillstand bestätigen nach (Sek.)", "Confirm stall after (sec.)"], ["Frühestens erneut melden nach (Min.)", "Notify again after at least (min.)"], ["Melden, wenn Downloads wieder laufen", "Notify when downloads resume"],
  ["Quelle und Zeitpunkt der Update-Prüfung.", "Update source and check timing."], ["Aktualisierung", "Update"], ["Beim Start nach Updates suchen", "Check for updates on startup"], ["Update-Quelle", "Update source"],
  ["Jetzt nach einer neuen Version suchen", "Check for a new version now"], ["Nach Updates suchen", "Check for updates"], ["Quelle im Format Benutzer/Repository.", "Source in owner/repository format."],
  ["Update verfügbar", "Update available"], ["Eine neue Version ist bereit. Klicke hier, um sie zu installieren.", "A new version is ready. Click here to install it."], ["Update installieren", "Install update"],
  ["Später", "Later"], ["Jetzt aktualisieren", "Update now"], ["Changelog anzeigen", "Show changelog"], ["Update wird vorbereitet...", "Preparing update..."], ["Update-Fortschritt", "Update progress"],
  ["Pakete", "Packages"], ["Dateien", "Files"], ["Alle", "All"], ["Aktiv", "Active"], ["Wartend", "Queued"], ["Pausiert", "Paused"], ["Fertig", "Completed"], ["Fehler", "Errors"],
  ["Downloadansicht", "Download view"], ["Downloadfilter", "Download filters"], ["Service filtern", "Filter service"], ["Downloads durchsuchen", "Search downloads"], ["Downloadstatus", "Download status"],
  ["Seitenleiste einklappen", "Collapse sidebar"], ["Seitenleiste ausklappen", "Expand sidebar"], ["Informationen", "Information"], ["Alle sichtbaren Downloads auswählen", "Select all visible downloads"],
  ["Links hinzufügen", "Add links"], ["Start", "Start"], ["Pause", "Pause"], ["Stop", "Stop"], ["Zeitplan", "Schedule"], ["Nach oben", "Move up"], ["Nach unten", "Move down"],
  ["Umbenennen", "Rename"], ["Entfernen", "Remove"], ["Name", "Name"], ["Geladen / Größe", "Downloaded / size"], ["Fortschritt", "Progress"], ["Hoster", "Hoster"], ["Service", "Service"],
  ["Priorität", "Priority"], ["Status", "Status"], ["Aktion", "Action"], ["Alle Services", "All services"], ["Paket, Datei oder Service", "Package, file or service"], ["Alle ein-/ausklappen", "Expand/collapse all"],
  ["Hoch", "High"], ["Normal", "Normal"], ["Niedrig", "Low"], ["In Warteschlange", "Queued"], ["Abgeschlossen", "Completed"], ["Entpackt", "Extracted"], ["Automatisch entpacken", "Extract automatically"],
  ["Liste leeren", "Clear list"], ["Sitzung", "Session"], ["Gesamt", "Total"], ["Verbleibend", "Remaining"], ["Bereit", "Ready"], ["Download läuft", "Download running"], ["Wartet", "Waiting"], ["Offline", "Offline"],
  ["Übersicht", "Overview"], ["Verwendungsregeln", "Usage rules"], ["Laufzeit", "Runtime"], ["Accountverwaltung", "Account management"], ["Accounts hinzufügen, prüfen und verwalten.", "Add, check and manage accounts."],
  ["Provider-Laufzeit", "Provider runtime"], ["Account-Laufzeit", "Account runtime"], ["Aktive Downloads", "Active downloads"], ["Erfolgsquote · Diese Sitzung", "Success rate · This session"], ["Zuletzt verwendet", "Last used"], ["Cooldown / Grund", "Cooldown / reason"],
  ["Noch keine Accounts konfiguriert.", "No accounts configured yet."], ["Noch keine Laufzeitdaten verfügbar.", "No runtime data available yet."], ["Noch nicht in dieser Sitzung", "Not yet in this session"], ["Gerade eben", "Just now"], ["gerade eben", "just now"], ["Prüfung", "Checking"], ["Tageslimit", "Daily limit"], ["Cooldown", "Cooldown"],
  ["aktiver Download", "active download"], ["aktive Downloads", "active downloads"], ["heute", "today"], ["Account deaktiviert", "Account disabled"], ["Tageslimit erreicht", "Daily limit reached"], ["Anmeldung ungültig", "Invalid login"], ["Rate-Limit aktiv", "Rate limit active"], ["Traffic- oder Kontolimit erreicht", "Traffic or account limit reached"], ["Vorübergehender Cooldown", "Temporary cooldown"], ["Provider oder Link vorübergehend nicht verfügbar", "Provider or link temporarily unavailable"],
  ["Accounts zum Herunterladen verwenden", "Use accounts for downloads"], ["Download-Traffic übrig", "Download traffic remaining"], ["Benutzername", "Username"], ["E-Mail", "Email"], ["Verfallsdatum", "Expiration date"], ["Passwort/Zugang", "Password/access"],
  ["Account hinzufügen", "Add account"], ["Ausgewählte prüfen", "Check selected"], ["Ausgewählte entfernen", "Remove selected"], ["Aktivieren", "Enable"], ["Deaktivieren", "Disable"], ["Noch nicht geprüft", "Not checked yet"], ["Geprüft", "Checked"],
  ["Aktiviert", "Enabled"], ["Aktionen", "Actions"], ["Deaktiviert", "Disabled"], ["Premium aktiv", "Premium active"], ["API-Key aktiv", "API key active"], ["API-Account", "API account"], ["API-Key", "API key"],
  ["Ungültiger API-Key (nicht autorisiert)", "Invalid API key (not authorized)"], ["Free Account", "Free account"], ["Unbeschränkt", "Unlimited"], ["Keine Accounts eingerichtet", "No accounts configured"],
  ["Ablauf, Ziel, Tonspur, Ablageform und Leistung.", "Workflow, destination, audio track, layout and performance."], ["Ziel und Ablauf", "Destination and workflow"], ["Entpacken nach", "Extract to"],
  ["Zielordner für entpackte Dateien.", "Destination folder for extracted files."], ["Benötigt ffmpeg.", "Requires ffmpeg."],
  ["Wählen", "Choose"], ["Automatisch entpacken", "Extract automatically"], ["Bereits Entpacktes überspringen", "Skip already extracted files"], ["Entpackte Einträge ausblenden", "Hide extracted entries"],
  ["Entpacken auch ohne laufende Sitzung", "Extract without an active session"], ["Deutsche Tonspur", "German audio track"], ["Nur deutsche Tonspur behalten", "Keep German audio track only"], ["Welche Tonspur behalten", "Audio track to keep"],
  ["Ablageform", "Output layout"], ["Automatisch umbenennen", "Rename automatically"], ["In Paket-Unterordner ablegen", "Store in package subfolder"], ["Videos in Sammelordner verschieben", "Move videos to library folder"],
  ["Video-Sammelordner", "Video library folder"], ["Leistung", "Performance"], ["Hybrid-Entpacken", "Hybrid extraction"], ["Gleichzeitige Entpackungen", "Concurrent extractions"], ["CPU-Priorität beim Entpacken", "CPU priority during extraction"],
  ["Passwörter", "Passwords"], ["Passwortliste für Archive", "Archive password list"], ["Ein Passwort pro Zeile", "One password per line"], ["Hoch (80% CPU)", "High (80% CPU)"], ["Mittel (50% CPU)", "Medium (50% CPU)"], ["Niedrig (25% CPU)", "Low (25% CPU)"],
  ["Tempo, Wiederverbindung und zeitgesteuerte Bandbreitenregeln.", "Speed, reconnection and scheduled bandwidth rules."], ["Tempo-Begrenzung", "Speed limit"], ["Geschwindigkeit begrenzen", "Limit speed"],
  ["Höchstgeschwindigkeit (MB/s)", "Maximum speed (MB/s)"], ["Limit gilt für", "Limit applies to"], ["Verbindung", "Connection"], ["Automatisch neu verbinden", "Reconnect automatically"], ["Wartezeit vor neuem Versuch (Sek.)", "Wait before retry (sec.)"],
  ["Von (Stunde)", "From (hour)"], ["Bis (Stunde)", "To (hour)"], ["Limit (MB/s)", "Limit (MB/s)"], ["Zeitregel aktiviert", "Schedule rule enabled"], ["Zeitregel entfernen", "Remove schedule rule"],
  ["Bandbreitenplanung", "Bandwidth schedule"], ["Jede Regel legt für ein Zeitfenster ein eigenes Limit fest.", "Each rule sets a separate limit for a time window."], ["Weitere Zeitregel", "Additional schedule rule"], ["Zeitregel hinzufügen", "Add schedule rule"],
  ["Integritätsprüfung und Aufräumen nach Downloads und Entpacken.", "Integrity checks and cleanup after downloading and extraction."], ["Prüfung", "Verification"], ["Dateien auf Fehler prüfen", "Check files for errors"],
  ["Nach dem Entpacken", "After extraction"], ["Link-Dateien danach entfernen", "Remove link files afterward"], ["Vorschau-Dateien danach entfernen", "Remove sample files afterward"], ["Archive nach dem Entpacken", "Archives after extraction"],
  ["Fertige Downloads und Konflikte", "Completed downloads and conflicts"], ["Fertige Downloads aus der Liste", "Completed downloads in the list"], ["Bei gleichnamigen Dateien", "When files have the same name"],
  ["Hinzufügen", "Add"], ["Aktualisieren", "Refresh"], ["＋ Hinzufügen", "＋ Add"], ["− Entfernen", "− Remove"], ["↻ Aktualisieren", "↻ Refresh"], ["↻ Aktive aktualisieren", "↻ Refresh active"], ["↻ Alle aktualisieren", "↻ Refresh all"], ["Prüft nur aktivierte Accounts.", "Checks enabled accounts only."], ["Prüft alle angelegten Accounts, auch deaktivierte.", "Checks all configured accounts, including disabled accounts."], ["Provider-Reihenfolge", "Provider order"], ["Lege fest, in welcher Reihenfolge verfügbare Provider verwendet werden.", "Choose the order in which available providers are used."],
  ["Automatischer Fallback", "Automatic fallback"], ["Zugangsdaten lokal speichern", "Store credentials locally"], ["Hoster-Routing", "Hoster routing"], ["Eigene Zuordnungen überschreiben für den jeweiligen Hoster die Standardreihenfolge.", "Custom assignments override the default order for each hoster."],
  ["Rotations-Verlauf", "Rotation history"], ["Sammlung", "Collection"], ["URL oder Rohzeile", "URL or raw line"], ["Zeile", "Line"], ["Paket / Datei", "Package / file"], ["Größe", "Size"], ["Gestartet", "Started"], ["Beendet", "Finished"],
  ["Alle Einträge", "All entries"], ["Heute", "Today"], ["Letzte 7 Tage", "Last 7 days"], ["Älter", "Older"], ["Gelöscht", "Deleted"], ["Fehlgeschlagen", "Failed"],
  ["Dauer", "Duration"], ["Durchschnitt", "Average"], ["Zielordner", "Destination folder"], ["Verlaufsfilter", "History filters"], ["Verlauf leeren", "Clear history"], ["Verlaufsaktionen", "History actions"],
  ["Einträge", "Entries"], ["Erneut hinzufügen", "Add again"], ["Im Ordner zeigen", "Show in folder"], ["Auswahl löschen", "Clear selection"], ["Gesamtverlauf löschen", "Delete all history"], ["Verlauf durchsuchen", "Search history"], ["Name, Pfad, Hoster oder Provider", "Name, path, hoster or provider"],
  ["Verlaufstabelle", "History table"], ["Verlaufsseiten", "History pages"], ["Vorherige Verlaufsseite", "Previous history page"], ["Nächste Verlaufsseite", "Next history page"], ["Zurück", "Back"], ["Vor", "Next"], ["Verlauf wird geladen", "Loading history"], ["Die gespeicherten Einträge werden geladen.", "Saved entries are being loaded."], ["Verlauf wird geladen. Die gespeicherten Einträge werden geladen.", "History is loading. Saved entries are being loaded."], ["Noch kein Verlauf", "No history yet"], ["Keine passenden Einträge", "No matching entries"],
  ["Abgeschlossene und gelöschte Pakete erscheinen hier.", "Completed and deleted packages appear here."], ["Passe Filter oder Suche an.", "Adjust the filter or search."], ["Öffne die Ansicht erneut, um es noch einmal zu versuchen.", "Open the view again to retry."],
  ["Alle sichtbaren Einträge auswählen", "Select all visible entries"], ["Details anzeigen", "Show details"], ["Details ausblenden", "Hide details"],
  ["Sichtbar:", "Visible:"], ["pro Seite", "per page"],
  ["Verfügbarkeit", "Availability"], ["Hinzugefügt am", "Added on"], ["Ungeprüft", "Unchecked"], ["Paket gestoppt", "Package stopped"], ["Alle anzeigen", "Show all"], ["Planen", "Schedule"], ["Startzeit", "Start time"], ["Starttag", "Start day"], ["Ab heute", "Starting today"], ["Ab morgen", "Starting tomorrow"],
  ["Keine Downloads", "No downloads"], ["Keine passenden Downloads", "No matching downloads"], ["Füge Links hinzu, um Downloads vorzubereiten.", "Add links to prepare downloads."], ["Passe Filter oder Suche an.", "Adjust the filter or search."],
  ["Keine Links gesammelt", "No links collected"], ["Keine passenden Links", "No matching links"], ["Füge Links oder Text ein, um sie zu sammeln.", "Paste links or text to collect them."], ["Links durchsuchen", "Search links"],
  ["Datenmenge", "Data volume"], ["Sitzungszähler", "Session counter"], ["Sieben Tage", "Seven days"], ["30 Tage", "30 days"], ["Zeitraum", "Period"], ["Erfolgreich", "Successful"],
  ["Sitzungszähler und Ergebnisse der aktuellen Queue werden angezeigt.", "Session counters and results for the current queue are shown."], ["Sitzung zurücksetzen", "Reset session"], ["Gesamt zurücksetzen", "Reset total"], ["Fehler zurücksetzen", "Reset errors"],
  ["Bandbreitenverlauf", "Bandwidth history"], ["Bandbreitenverlauf der letzten 60 Sekunden", "Bandwidth history for the last 60 seconds"], ["Provider", "Provider"], ["Daten", "Data"], ["Ergebnisse", "Results"],
  ["Nie", "Never"], ["Sofort", "Immediately"], ["Beim App-Start", "On app startup"], ["Sobald Paket fertig ist", "When package completes"], ["Überschreiben", "Overwrite"], ["Überspringen", "Skip"], ["Nachfragen", "Ask"],
  ["Abbrechen", "Cancel"], ["Speichern", "Save"], ["Schließen", "Close"], ["Löschen", "Delete"], ["Suchen", "Search"], ["Zurücksetzen", "Reset"], ["Testen", "Test"], ["Öffnen", "Open"],
  ["Noch keine Downloads", "No downloads yet"], ["Füge Links hinzu, um den ersten Download zu starten.", "Add links to start the first download."], ["Keine passenden Downloads", "No matching downloads"], ["Alle anzeigen", "Show all"],
  ["Neue Sammlung", "New collection"], ["Linksammler-Aktionen", "Link collector actions"], ["Links erfassen", "Capture links"], ["DLC importieren", "Import DLC"], ["Datei importieren", "Import file"],
  ["Linksammler-Filter", "Link collector filters"], ["Alle Links", "All links"], ["Downloads übergeben", "Send to downloads"], ["Gesammelte Downloadpakete", "Collected download packages"], ["Hinzugefügt", "Added"],
  ["Name, URL oder Hoster", "Name, URL or hoster"], ["Links werden analysiert", "Analyzing links"], ["Dateinamen, Größen und Verfügbarkeit werden geprüft.", "Checking filenames, sizes, and availability."],
  ["Bereits gesammelte Pakete bleiben unverändert.", "Already collected packages remain unchanged."], ["Füge Links hinzu, um Pakete vor dem Download zu prüfen.", "Add links to inspect packages before downloading."],
  ["Links werden geprüft und automatisch zu Downloadpaketen gruppiert.", "Links are inspected and automatically grouped into download packages."], ["Analysieren", "Analyze"], ["Eine URL pro Zeile", "One URL per line"],
  ["Sammlung verarbeiten", "Process collection"], ["Queue exportieren", "Export queue"], ["An Downloads übergeben", "Send to downloads"], ["Auswahl entfernen", "Remove selection"], ["Ausgewählte Links löschen", "Delete selected links"], ["Links löschen", "Delete links"], ["Die ausgewählten Links werden aus der Sammlung entfernt. Dieser Schritt kann nicht rückgängig gemacht werden.", "The selected links will be removed from the collection. This action cannot be undone."], ["Gesammelte Links", "Collected links"],
  ["Auswahl", "Selection"], ["Links werden verarbeitet", "Processing links"], ["Die laufende Aktion wird abgeschlossen.", "The current action is being completed."], ["Die lokale Sammlung bleibt unverändert.", "The local collection remains unchanged."],
  ["Passe die Suche an oder lösche den Filter.", "Adjust the search or clear the filter."], ["Füge Links hinzu oder importiere eine vorhandene Liste.", "Add links or import an existing list."], ["Keine passenden Links", "No matching links"], ["Noch keine Links", "No links yet"],
  ["Link auswählen", "Select link"], ["Lokal", "Local"], ["Übernehmen", "Apply"], ["Eine URL oder Rohzeile pro Zeile", "One URL or raw line per line"],
  ["Die Accountdaten werden aktualisiert.", "Account data is being updated."], ["Accountdaten werden aktualisiert.", "Account data is being updated."], ["Accounts werden geladen", "Loading accounts"], ["Die gespeicherten Accounts bleiben unverändert.", "Saved accounts remain unchanged."], ["Keine passenden Dienste oder Zugangstypen gefunden.", "No matching services or access types found."],
  ["Füge einen Account hinzu, um Downloads über einen Anbieter zu starten.", "Add an account to start downloads through a provider."], ["Noch keine Accounts", "No accounts yet"], ["Keine Provider konfiguriert.", "No providers configured."],
  ["Keine eigenen Zuordnungen.", "No custom assignments."], ["Hoster-Routing hinzufügen", "Add hoster routing"], ["Hoster hinzufügen…", "Add hoster…"], ["Eigener Hoster…", "Custom hoster…"], ["Noch keine Rotations-Ereignisse.", "No rotation events yet."],
  ["Prüfen und speichern", "Check and save"], ["Wähle einen Dienst und trage die passenden Zugangsdaten ein.", "Choose a service and enter the matching credentials."], ["Accounts durchsuchen", "Search accounts"],
  ["Dienst / Zugangstyp", "Service / access type"], ["Dienst", "Service"], ["Typ/Funktion", "Type/function"], ["Dienst oder Zugangstyp suchen", "Search service or access type"], ["Zugangstyp suchen, z. B. API oder Web", "Search access type, e.g. API or web"], ["Dienst filtern", "Filter service"], ["Alle Dienste", "All services"], ["Account-Typ filtern", "Filter account type"], ["Verfügbare Account-Typen", "Available account types"], ["Keine passenden Account-Typen.", "No matching account types."],
  ["Prüfen", "Check"], ["Bearbeite ausschließlich den ausgewählten Account.", "Edit only the selected account."], ["Account bearbeiten", "Edit account"], ["Account aktiviert", "Account enabled"], ["Der ausgewählte Real-Debrid-Account wurde nicht gefunden.", "The selected Real-Debrid account was not found."],
  ["Immer erste Tonspur", "Always first audio track"], ["Pro Download", "Per download"], ["Keine Archive löschen", "Do not delete archives"], ["Archive in Papierkorb", "Move archives to recycle bin"], ["Archive löschen", "Delete archives"],
  ["Accounts und Verwendungsregeln.", "Accounts and usage rules."], ["Premium Account", "Premium account"], ["Zugang ungültig", "Invalid access"], ["Prüft…", "Checking…"], ["Geschützter Zugang", "Protected access"],
  ["Der ausgewählte Mega-Debrid-Account wurde nicht gefunden.", "The selected Mega-Debrid account was not found."], ["Der ausgewählte Debrid-Link-Key wurde nicht gefunden.", "The selected Debrid-Link key was not found."],
  ["Das Tageslimit muss eine positive Zahl oder 0 sein.", "The daily limit must be a positive number or 0."], ["Login und Passwort werden benötigt.", "Login and password are required."],
  ["Der Login darf keinen Doppelpunkt oder Zeilenumbruch enthalten.", "The login must not contain a colon or line break."], ["Das Passwort darf keinen Zeilenumbruch enthalten.", "The password must not contain a line break."],
  ["Dieser Mega-Debrid-Login ist bereits vorhanden.", "This Mega-Debrid login already exists."], ["Der API-Key wird benötigt.", "The API key is required."], ["Beim Bearbeiten ist genau ein API-Key erlaubt.", "Exactly one API key is allowed when editing."],
  ["Dieser Debrid-Link-Key ist bereits vorhanden.", "This Debrid-Link key already exists."], ["Der Zugangstoken wird benötigt.", "The access token is required."], ["Die Prüfung hat keinen Account zurückgegeben.", "The check returned no account."],
  ["Die Prüfung hat mehr als den ausgewählten Account zurückgegeben.", "The check returned more than the selected account."], ["Die Prüfung hat den falschen Account zurückgegeben.", "The check returned the wrong account."], ["Zugangsdaten ungültig", "Invalid credentials"],
  ["Für diesen Zeitraum werden noch keine historischen Daten gespeichert.", "Historical data is not stored for this time range yet."], ["Keine abgeschlossenen oder fehlgeschlagenen Ergebnisse", "No completed or failed results"],
  ["Heutige Daten stammen aus den lokalen Provider-Nutzungszählern des aktuellen Kalendertags.", "Today's data comes from the local provider usage counters for the current calendar day."],
  ["Provider-Nutzung heute", "Provider usage today"], ["Dateianzahlen werden nicht tagesweise gespeichert", "File counts are not stored by day"], ["Ergebnisse werden nicht tagesweise gespeichert", "Results are not stored by day"],
  ["Durchschnittsgeschwindigkeit wird nicht tagesweise gespeichert", "Average speed is not stored by day"], ["Fehler werden nicht tagesweise gespeichert", "Errors are not stored by day"],
  ["Gesamtwerte stammen aus dauerhaft gespeicherten Zählern. Ergebnisse und Geschwindigkeiten werden nicht historisch gespeichert.", "Totals come from permanently stored counters. Results and speeds are not stored historically."],
  ["Gesamtzähler", "Total counter"], ["Ergebnisse werden nicht dauerhaft gespeichert", "Results are not stored permanently"], ["Durchschnittsgeschwindigkeit wird nicht dauerhaft gespeichert", "Average speed is not stored permanently"],
  ["Fehler werden nicht dauerhaft gespeichert", "Errors are not stored permanently"], ["Aktuelle Queue", "Current queue"], ["Letzter beendeter Lauf", "Last completed run"],
  ["Während des laufenden Durchgangs nicht als Gesamtwert verfügbar", "Unavailable as a total while the run is active"], ["Kein beendeter Lauf mit Ergebnissen verfügbar", "No completed run with results available"],
  ["Sitzungszähler und Ergebnisse des zuletzt beendeten Laufs werden angezeigt.", "Session counters and results from the last completed run are shown."], ["Nicht verfügbar", "Unavailable"],
  ["Heute wurden noch keine Providerbytes erfasst.", "No provider bytes have been recorded today."], ["Noch keine gespeicherten Providerbytes vorhanden.", "No stored provider bytes available yet."],
  ["In der aktuellen Queue sind noch keine Providerwerte vorhanden.", "No provider values are available in the current queue yet."], ["Statistik-Zeitraum", "Statistics time range"], ["Statistik-Dashboard", "Statistics dashboard"],
  ["Statistiken zurücksetzen", "Reset statistics"], ["Sitzungsstatistik zurücksetzen", "Reset session statistics"], ["Die Zähler, Downloadmenge und Geschwindigkeitsdaten der aktuellen Sitzung werden gelöscht. Dieser Schritt kann nicht rückgängig gemacht werden.", "The counters, download volume, and speed data for the current session will be deleted. This action cannot be undone."], ["Gesamtstatistik zurücksetzen", "Reset total statistics"], ["Alle dauerhaft gespeicherten Download- und Providerstatistiken werden gelöscht. Dieser Schritt kann nicht rückgängig gemacht werden.", "All permanently stored download and provider statistics will be deleted. This action cannot be undone."], ["Erfolgsquote", "Success rate"], ["Live aus der aktuellen Renderer-Sitzung", "Live from the current renderer session"],
  ["Sammlung entfernen", "Remove collection"],
  ["Kontextmenü", "Context menu"], ["Die Oberfläche hat einen Fehler ausgelöst", "The interface encountered an error"],
  ["Die Anzeige wurde gestoppt, um Datenverlust zu vermeiden. Die laufenden Downloads im Hintergrund sind nicht betroffen. Der Fehler wurde ins Log geschrieben.", "The interface was stopped to prevent data loss. Downloads running in the background are not affected. The error was written to the log."],
  ["Oberfläche neu laden", "Reload interface"], ["Unbekannter Fehler", "Unknown error"],
  ["Direkter Zugriff über API-Token.", "Direct access via API token."], ["Login über Browserfenster statt Token.", "Login through a browser window instead of a token."],
  ["Login:Passwort-Paare für Mega-Debrid (API). Mehrere Accounts zeilenweise für Multi-Account.", "Login:password pairs for Mega-Debrid (API). Enter multiple accounts on separate lines for multi-account."],
  ["Login:Passwort-Paare für Mega-Debrid (Web). Mehrere Accounts zeilenweise für Multi-Account.", "Login:password pairs for Mega-Debrid (Web). Enter multiple accounts on separate lines for multi-account."],
  ["Cookie-Import aus dem Browser statt API-Token.", "Import cookies from the browser instead of using an API token."], ["Direkter Zugriff über API-Key.", "Direct access via API key."],
  ["Login über Browserfenster für reCAPTCHA.", "Login through a browser window for reCAPTCHA."], ["Direkter Login für ddownload.com und ddl.to.", "Direct login for ddownload.com and ddl.to."],
  ["API-Key für 1fichier.com.", "API key for 1fichier.com."], ["API-Key(s) für debrid-link.com. Mehrere Keys zeilenweise für Multi-Account.", "API key(s) for debrid-link.com. Enter multiple keys on separate lines for multi-account."],
  ["Login für linksnappy.com mit Benutzername und Passwort.", "Login for linksnappy.com with username and password."], ["Login:Passwort (API)", "Login:password (API)"], ["Login:Passwort (Web)", "Login:password (Web)"],
  ["Login + Passwort", "Login + password"], ["Login gespeichert", "Login saved"], ["API-Key gespeichert", "API key saved"], ["Zugang gespeichert", "Access saved"], ["Nicht hinterlegt", "Not stored"],
  ["Bitte zuerst einen Account-Typ auswählen.", "Select an account type first."], ["Nicht angegeben", "Not specified"], ["Nur per API-Key sichtbar", "Visible only via API key"],
  ["abgebrochen (fataler Fehler)", "cancelled (fatal error)"], ["übersprungen (bis zum Tagesreset gesperrt)", "skipped (blocked until daily reset)"], ["übersprungen (Cooldown aktiv)", "skipped (cooldown active)"],
  ["übersprungen (deaktiviert)", "skipped (disabled)"], ["übersprungen (Tageslimit erreicht)", "skipped (daily limit reached)"], ["übersprungen (Host-Cooldown)", "skipped (host cooldown)"],
  ["Provider-weiter Fehler, restliche Keys übersprungen", "Provider-wide error, remaining keys skipped"], ["Netzwerk-Kaskade, restliche Keys übersprungen", "Network cascade, remaining keys skipped"],
  ["Key ist manuell deaktiviert.", "Key is manually disabled."], ["Lokales Tageslimit erreicht.", "Local daily limit reached."], ["Live-Status wird geladen.", "Loading live status."],
  ["Der Hoster ist laut Debrid-Link aktuell offline.", "The hoster is currently offline according to Debrid-Link."], ["Key ist nutzbar.", "Key is usable."], ["Download starten für Statistiken", "Start a download for statistics"],
  ["Download fertig | Prüfe Integrität...", "Download complete | Checking integrity..."], ["Starte Installer...", "Starting installer..."], ["Installer gestartet", "Installer started"],
  ["Verlauf konnte nicht geladen werden", "History could not be loaded"], ["Debrid-Link ist nicht konfiguriert", "Debrid-Link is not configured"], ["Entpacken -", "Extraction -"],
  ["Nur API aktiv. Kein Web-Fallback.", "API only. No web fallback."], ["Nur Web aktiv. Kein API-Fallback.", "Web only. No API fallback."], ["Login kann bei Bedarf direkt aus der Liste geöffnet werden.", "The login can be opened directly from the list when needed."],
  ["Cookie-Import lässt sich direkt aus der Liste erneut starten.", "Cookie import can be started again directly from the list."], ["Lade Status", "Load status"], ["Rapidgator-Status wird aktualisiert.", "RapidGator status is being updated."],
  ["Rapidgator-Status kann direkt aus der Liste geladen werden.", "RapidGator status can be loaded directly from the list."], ["Status basiert auf den zuletzt gespeicherten AllDebrid-Daten.", "Status is based on the last saved AllDebrid data."],
  ["Update wird vorbereitet", "Preparing update"], ["Stilles Update gestartet - App wird neu gestartet", "Silent update started - the app will restart"], ["Einstellungen gespeichert", "Settings saved"],
  ["Real-Debrid Login-Fenster geöffnet", "Real-Debrid login window opened"], ["AllDebrid Login-Fenster geöffnet", "AllDebrid login window opened"], ["Keine Cookie-Datei ausgewählt", "No cookie file selected"],
  ["Keine Mega-Debrid-/Debrid-Link-Accounts zum Prüfen konfiguriert.", "No Mega-Debrid or Debrid-Link accounts configured for checking."], ["Keine prüfbaren Accounts konfiguriert.", "No checkable accounts configured."], ["Keine aktiven prüfbaren Accounts konfiguriert.", "No active checkable accounts configured."], ["Account aktiviert", "Account enabled"], ["Account deaktiviert", "Account disabled"],
  ["Account entfernen", "Remove account"], ["Account entfernt", "Account removed"], ["Key entfernen", "Remove key"], ["Key entfernt", "Key removed"], ["Accounts aktiviert", "Accounts enabled"], ["Accounts deaktiviert", "Accounts disabled"],
  ["Für diesen Account ist keine direkte Statusprüfung verfügbar.", "Direct status checking is not available for this account."], ["Keine gespeicherten Links vorhanden", "No saved links available"], ["Keine Links hinzugefügt", "No links added"],
  ["Fehler beim Hinzufügen", "Error while adding"], ["Verlaufseintrag entfernen", "Remove history entry"], ["Verlaufseinträge entfernen", "Remove history entries"], ["Diesen Eintrag aus dem Verlauf entfernen?", "Remove this entry from history?"],
  ["Einige Verlaufseinträge konnten nicht entfernt werden", "Some history entries could not be removed"], ["Wirklich alle Einträge aus dem Verlauf entfernen?", "Remove all entries from history?"], ["Verlauf geleert", "History cleared"],
  ["Verlauf konnte nicht geleert werden", "History could not be cleared"], ["Zielordner geöffnet", "Destination folder opened"], ["Verlaufseintrag wurde nicht gefunden", "History entry was not found"],
  ["Der gespeicherte Zielordner ist ungültig", "The saved destination folder is invalid"], ["Der gespeicherte Zielordner existiert nicht mehr", "The saved destination folder no longer exists"],
  ["Das gespeicherte Ziel ist kein Ordner", "The saved destination is not a folder"], ["Zielordner konnte nicht geöffnet werden", "Destination folder could not be opened"], ["Bitte zuerst mindestens einen Hoster-Account eintragen", "Add at least one hoster account first"],
  ["Start abgebrochen", "Start cancelled"], ["Keine gültigen Links gefunden", "No valid links found"], ["Keine gültigen Links in den DLC-Dateien gefunden", "No valid links found in the DLC files"],
  ["Keine gültigen Links in den Import-Dateien gefunden", "No valid links found in the import files"], ["Links per Drag-and-Drop eingefügt", "Links added by drag and drop"], ["Queue exportiert", "Queue exported"],
  ["Keine gültigen Links in der Datei gefunden", "No valid links found in the file"], ["Sicherung exportiert", "Backup exported"], ["Online-Schlüssel erstellt", "Online key created"],
  ["Sicherung schützen", "Protect backup"], ["Sicherung entsperren", "Unlock backup"], ["Lege eine Passphrase für diese Sicherung fest. Sie wird nicht gespeichert und wird beim Import erneut benötigt.", "Set a passphrase for this backup. It is not stored and will be required again during import."],
  ["Diese Sicherung ist mit einer Passphrase geschützt.", "This backup is protected with a passphrase."], ["Passphrase", "Passphrase"], ["Passphrase bestätigen", "Confirm passphrase"],
  ["Bitte eine Passphrase eingeben", "Enter a passphrase"], ["Die Passphrasen stimmen nicht überein", "The passphrases do not match"], ["Sicherung exportieren", "Export backup"], ["Sicherung importieren", "Import backup"],
  ["Online-Sicherung konnte nicht erstellt werden.", "Online backup could not be created."], ["Online-Sicherung konnte nicht geladen werden. Schlüssel prüfen und erneut versuchen.", "Online backup could not be loaded. Check the key and try again."],
  ["Online-Schlüssel kopiert", "Online key copied"], ["Schlüssel konnte nicht kopiert werden", "Key could not be copied"], ["Support-Bundle exportiert", "Support bundle exported"],
  ["Support-Trace für 2 Stunden aktiviert", "Support trace enabled for 2 hours"], ["Support-Trace deaktiviert", "Support trace disabled"], ["Keine akuten Warnungen", "No current warnings"],
  ["Remote-fähig konfiguriert", "Configured for remote access"], ["Debug-Setup prüfen", "Check debug setup"], ["Letzte Fehler", "Recent errors"], ["Keine Fehler oder Warnungen seit dem App-Start aufgezeichnet.", "No errors or warnings recorded since the app started."],
  ["In Zwischenablage kopieren", "Copy to clipboard"], ["Einträge anzeigen", "Show entries"], ["Fehlerliste kopiert", "Error list copied"], ["Debug-Token rotieren", "Rotate debug token"],
  ["Das aktuelle Debug-Token wird ersetzt. Externe Debug-Links mit altem Token funktionieren danach nicht mehr.", "The current debug token will be replaced. External debug links using the old token will stop working."],
  ["Token rotieren", "Rotate token"], ["Netzwerkmodus braucht mindestens eine IP oder CIDR in der Allowlist", "Network mode requires at least one IP address or CIDR in the allowlist"],
  ["Ferndiagnose aktiv", "Remote diagnostics active"], ["Ferndiagnose konfiguriert", "Remote diagnostics configured"], ["Ferndiagnose deaktiviert", "Remote diagnostics disabled"],
  ["Neues Token - alter Verbindungscode ist ungueltig", "New token - old connection code is invalid"], ["Verbindungscode kopiert", "Connection code copied"], ["Kopieren fehlgeschlagen", "Copy failed"],
  ["Queue löschen", "Delete queue"], ["Wirklich alle Einträge aus der Queue löschen?", "Delete all entries from the queue?"], ["Alles löschen", "Delete all"], ["Session-Statistik zurückgesetzt", "Session statistics reset"],
  ["Gesamt-Downloadstatistik zurückgesetzt", "Total download statistics reset"], ["Hoster-Domain eingeben:", "Enter hoster domain:"], ["Test-Nachricht gesendet", "Test message sent"], ["Test fehlgeschlagen", "Test failed"],
  ["Login / E-Mail", "Login / email"], ["Token / API-Key", "Token / API key"], ["Tageslimit (GB, optional)", "Daily limit (GB, optional)"], ["Kein Limit", "No limit"],
  ["Der Zähler wird täglich um 00:00 Uhr zurückgesetzt.", "The counter resets every day at 00:00."], ["Account erfolgreich geprüft", "Account checked successfully"], ["Für diesen Dienst ist keine direkte Statusprüfung verfügbar.", "Direct status checking is not available for this service."],
  ["Paket- und Linkstatus werden laufend aktualisiert. Auswahl, Reihenfolge und aktive Filter bleiben beim Ansichtswechsel erhalten.", "Package and link status are updated continuously. Selection, order and active filters remain in place when switching views."],
  ["Rohzeilen bleiben lokal in der gewählten Sammlung, bis sie über „An Downloads übergeben“ an die Queue gesendet werden. Strg+L öffnet den Linksammler, Strg+O lädt DLC-Dateien.", "Raw lines remain local in the selected collection until they are sent to the queue using “Send to downloads”. Ctrl+L opens the link collector, Ctrl+O loads DLC files."],
  ["Abgeschlossene und gelöschte Pakete bleiben hier durchsuchbar. Details zeigen Zielordner, Provider und gespeicherte Linkadressen.", "Completed and deleted packages remain searchable here. Details show the destination folder, provider and saved link addresses."],
  ["Für sieben und 30 Tage bleiben Kennzahlen leer, solange keine historischen Buckets gespeichert werden.", "Metrics remain empty for seven and 30 days while no historical buckets are stored."],
  ["Text mit Links analysieren", "Analyze text containing links"], ["Online-Schlüssel exportieren", "Export online key"], ["Online-Schlüssel importieren", "Import online key"], ["Logs öffnen", "Open logs"],
  ["Support-Bundle exportieren", "Export support bundle"], ["Support-Trace deaktivieren", "Disable support trace"], ["Support-Trace aktivieren", "Enable support trace"], ["Letzte Fehler anzeigen", "Show recent errors"],
  ["Einträge:", "Entries:"], ["Ausgewählt:", "Selected:"], ["Online-Schlüssel", "Online key"],
  ["Dieser Schlüssel stellt deine Einstellungen inklusive gespeicherter Zugangsdaten wieder her. Bewahre ihn wie ein Passwort auf.", "This key restores your settings, including saved credentials. Keep it as secure as a password."],
  ["Füge den vollständigen MDD2-Schlüssel ein. Die aktuellen Einstellungen werden durch die gespeicherte Version ersetzt.", "Paste the complete MDD2 key. The current settings will be replaced by the saved version."],
  ["Online-Sicherung wird verschlüsselt und gespeichert …", "Online backup is being encrypted and saved …"], ["Online-Sicherungsschlüssel", "Online backup key"], ["Online-Sicherungsschlüssel eingeben", "Enter online backup key"], ["Wird geladen …", "Loading …"],
  ["Ermöglicht einer vertrauenswürdigen Support-Stelle den geschützten Lesezugriff auf Status, Logs und Fehler. Der Verbindungscode enthält das Zugriffstoken und ist wie ein Passwort zu behandeln.", "Allows a trusted support contact protected read access to status, logs and errors. The connection code contains the access token and must be treated like a password."],
  ["Oeffentliche Adresse (fuer den Verbindungscode)", "Public address (for the connection code)"], ["Allowlist - erlaubte IPs/CIDR (eine pro Zeile)", "Allowlist - permitted IPs/CIDRs (one per line)"],
  ["Pflicht im Netzwerkmodus. Nur diese Quell-IPs duerfen verbinden (zusaetzlich zum Token). Loopback ist immer erlaubt.", "Required in network mode. Only these source IPs may connect (in addition to the token). Loopback is always allowed."],
  ["Token neu (Code ungueltig machen)", "New token (invalidate code)"], ["Enthaelt das Zugriffstoken - wie ein Passwort behandeln. Token neu = alter Code wird sofort ungueltig.", "Contains the access token - treat it like a password. New token = old code becomes invalid immediately."],
  ["Möchtest Du wirklich diese Aufräumaktion(en) durchführen?", "Do you really want to perform these cleanup action(s)?"], ["Ausgewählte Links löschen", "Delete selected links"], ["Nicht mehr anzeigen", "Do not show again"],
  ["Paket bereits entpackt", "Package already extracted"], ["ist im Ziel bereits vorhanden.", "already exists at the destination."], ["Für alle weiteren Pakete dieselbe Auswahl verwenden", "Use the same selection for all remaining packages"],
  ["Entpacktes überspringen", "Skip extracted content"], ["Links, .dlc oder Export-Dateien hier ablegen", "Drop links, .dlc or export files here"], ["Account prüfen", "Check account"],
  ["Account aktivieren", "Enable account"], ["Account deaktivieren", "Disable account"], ["Ausgewählte Downloads starten", "Start selected downloads"], ["Alle Downloads starten", "Start all downloads"],
  ["Linkadressen anzeigen", "Show link addresses"], ["Paket exportieren", "Export package"], ["Log öffnen", "Open log"], ["Item-Log öffnen", "Open item log"], ["Jetzt entpacken", "Extract now"],
  ["API-Key Statistik", "API key statistics"], ["Status unbekannt", "Status unknown"], ["RG Links", "RG links"], ["Alle Namen kopiert", "All names copied"], ["Alle Namen kopieren", "Copy all names"],
  ["Alle Links kopiert", "All links copied"], ["Alle Links kopieren", "Copy all links"],
  ["nicht gesetzt", "not set"], ["Schätzwert", "Estimate"], ["ist verfügbar. Installierte Version:", "is available. Installed version:"],
  ["Real-Debrid Web-Login", "Real-Debrid web login"], ["Mega-Debrid Web-Login", "Mega-Debrid web login"], ["BestDebrid Web-Login", "BestDebrid web login"], ["AllDebrid Web-Login", "AllDebrid web login"],
  ["DDownload Login", "DDownload login"], ["Debrid-Link API", "Debrid-Link API"], ["LinkSnappy Web-Login", "LinkSnappy web login"],
  ["Tageslimit erreicht. Neue Links wechseln auf den nächsten Hoster.", "Daily limit reached. New links will switch to the next hoster."], ["Mega-Debrid: Bitte Login und Passwort eintragen.", "Mega-Debrid: Enter a login and password."],
  ["Dieser Mega-Debrid-Account ist bereits vorhanden.", "This Mega-Debrid account already exists."], ["Debrid-Link: Bitte genau einen API-Key eintragen.", "Debrid-Link: Enter exactly one API key."],
  ["Die Prüfung hat nicht genau den neuen Account bestätigt.", "The check did not confirm exactly the new account."], ["Nur lokal gebunden", "Bound locally only"], ["(nur lokal)", "(local only)"], ["Nur lokal", "Local only"],
  ["Bindet nur an 127.0.0.1. Fernzugriff nur ueber einen Tunnel (z.B. Tailscale/SSH) - die sicherste Variante.", "Binds only to 127.0.0.1. Remote access only through a tunnel (such as Tailscale/SSH) - the safest option."],
  ["Bindet an 0.0.0.0. Erreichbar im Netzwerk, erfordert eine Allowlist. Nur in vertrauenswuerdigen Netzen/VPN nutzen.", "Binds to 0.0.0.0. Reachable on the network and requires an allowlist. Use only on trusted networks or VPNs."],
  ["127.0.0.1 oder Tunnel-Adresse", "127.0.0.1 or tunnel address"], ["Server-IP oder DNS-Name", "Server IP or DNS name"], ["löschen ?", "delete?"], ["Link(s) verbleiben!", "link(s) remaining!"],
  ["Bei \"überspringen\" wird nur das erneute Entpacken übersprungen - offene Downloads bleiben in der Queue.", "With \"skip\", only repeated extraction is skipped - open downloads remain in the queue."],
  ["überschreiben", "overwrite"], ["überspringen", "skip"], ["Priorität >", "Priority >"], ["Keys · Heute:", "Keys · Today:"], ["· Rapidgator-Quota wird geladen (", "· Loading RapidGator quota ("],
  ["· API-Quota konnte nicht geladen werden", "· API quota could not be loaded"], ["Name kopiert", "Name copied"], ["Link kopiert", "Link copied"],
  ["Download-Ziel", "Download destination"], ["Support-Logs:", "Support logs:"], ["Session-Logs", "Session logs"], ["Paket-Logs", "Package logs"], ["Support-Bundle:", "Support bundle:"], ["Warnungen:", "Warnings:"],
  ["Web-Login", "Web login"], ["API-Token", "API token"], ["erfolgreich", "successful"], ["Unbekannt", "Unknown"], ["Abgebrochen", "Cancelled"], ["Passwort", "Password"],
  ["Sicherung", "Backup"], ["Session-Log", "Session log"], ["Remote-Support", "Remote support"], ["Kopieren", "Copy"], ["Klicken zum Kopieren", "Click to copy"], ["Verbindungscode", "Connection code"], ["deaktiviert", "disabled"]
] as const;

const deToEn = new Map<string, string>(pairs);
const enToDe = new Map<string, string>(pairs.map(([de, en]) => [en, de]));
const attributes = ["aria-label", "placeholder", "title"] as const;
const prefixedPairs = [
  ["Status: ", "Status: "], ["Debug-Server aktiv: ", "Debug server active: "], ["Runtime-Ordner: ", "Runtime folder: "], ["Token-Datei: ", "Token file: "], ["Support-Manifest: ", "Support manifest: "], ["Trace aktiv: ", "Trace active: "],
  ["Unbekannter Account-Typ: ", "Unknown account type: "], ["Update-Download: ", "Update download: "], ["Update: ", "Update: "], ["Warnungen: ", "Warnings: "], ["Debug-Token rotiert: ", "Debug token rotated: "],
  ["AllDebrid Status fehlgeschlagen: ", "AllDebrid status failed: "], ["Debrid-Link Quota fehlgeschlagen: ", "Debrid-Link quota failed: "], ["Snapshot konnte nicht geladen werden: ", "Snapshot could not be loaded: "],
  ["Update-Check fehlgeschlagen: ", "Update check failed: "], ["Update-Fehler: ", "Update error: "], ["Auto-Update fehlgeschlagen: ", "Automatic update failed: "],
  ["Einstellungen konnten nicht gespeichert werden: ", "Settings could not be saved: "], ["Real-Debrid Login fehlgeschlagen: ", "Real-Debrid login failed: "], ["AllDebrid Login fehlgeschlagen: ", "AllDebrid login failed: "],
  ["BestDebrid Cookie-Import fehlgeschlagen: ", "BestDebrid cookie import failed: "], ["Account-Check fehlgeschlagen: ", "Account check failed: "], ["Prüfung fehlgeschlagen: ", "Check failed: "],
  ["Account konnte nicht gespeichert werden: ", "Account could not be saved: "], ["Reset fehlgeschlagen: ", "Reset failed: "], ["Umschalten fehlgeschlagen: ", "Toggle failed: "],
  ["Entfernen fehlgeschlagen: ", "Removal failed: "], ["Account konnte nicht entfernt werden: ", "Account could not be removed: "], ["Accounts konnten nicht umgeschaltet werden: ", "Accounts could not be toggled: "],
  ["Fehler beim Hinzufügen: ", "Error while adding: "], ["Fehler beim DLC-Import: ", "DLC import error: "], ["Export fehlgeschlagen: ", "Export failed: "], ["Fehler bei Drag-and-Drop: ", "Drag-and-drop error: "],
  ["Import fehlgeschlagen: ", "Import failed: "], ["Fehler: ", "Error: "], ["Sortierung fehlgeschlagen: ", "Sorting failed: "], ["Umbenennen fehlgeschlagen: ", "Rename failed: "],
  ["Paket-Löschung fehlgeschlagen: ", "Package deletion failed: "], ["Paket-Umschalten fehlgeschlagen: ", "Package toggle failed: "], ["Sicherung fehlgeschlagen: ", "Backup failed: "],
  ["Sicherung laden fehlgeschlagen: ", "Loading backup failed: "], ["Support-Bundle fehlgeschlagen: ", "Support bundle failed: "], ["Support-Trace fehlgeschlagen: ", "Support trace failed: "],
  ["Debug-Setup-Check fehlgeschlagen: ", "Debug setup check failed: "], ["Fehler-Ansicht fehlgeschlagen: ", "Error view failed: "], ["Token-Rotation fehlgeschlagen: ", "Token rotation failed: "],
  ["Ferndiagnose-Status fehlgeschlagen: ", "Remote diagnostics status failed: "], ["Aktivieren fehlgeschlagen: ", "Enabling failed: "], ["Deaktivieren fehlgeschlagen: ", "Disabling failed: "],
  ["Session-Reset fehlgeschlagen: ", "Session reset failed: "], ["Download-Reset fehlgeschlagen: ", "Download reset failed: "], ["Zeitplan konnte nicht aktiviert werden: ", "Schedule could not be activated: "], ["Zeitplan konnte nicht abgebrochen werden: ", "Schedule could not be cancelled: "], ["Zeitplan konnte nicht abgeglichen werden: ", "Schedule could not be reconciled: "]
] as const;

export function normalizeLanguage(value: unknown): AppLanguage {
  return value === "de" ? "de" : "en";
}

function translateDynamic(value: string, language: AppLanguage): string {
  for (const [german, english] of prefixedPairs) {
    const source = language === "en" ? german : english;
    if (value.startsWith(source)) return `${language === "en" ? english : german}${value.slice(source.length)}`;
  }
  if (language === "en") {
    const update = value.match(/^(.+) ist verfügbar\. Installierte Version: (.+)\.$/);
    if (update) return `${update[1]} is available. Installed version: ${update[2]}.`;
    const pagination = value.match(/^([\d.,]+\s*[–-]\s*[\d.,]+) von ([\d.,]+)$/);
    if (pagination) return `${pagination[1]} of ${pagination[2]}`;
    const schedule = value.match(/^Zeitregel (\d+)$/);
    if (schedule) return `Schedule rule ${schedule[1]}`;
    const scheduled = value.match(/^Geplant: (.+)$/);
    if (scheduled) return `Scheduled: ${scheduled[1].replace(/^Heute\b/, "Today")}`;
    const cancelled = value.match(/^(\d+) abgebrochen$/);
    if (cancelled) return `${cancelled[1]} cancelled`;
    const labelledCount = value.match(/^(Einträge|Sichtbar|Ausgewählt): (\d+)$/);
    if (labelledCount) return `${({ Einträge: "Entries", Sichtbar: "Visible", Ausgewählt: "Selected" } as const)[labelledCount[1] as "Einträge" | "Sichtbar" | "Ausgewählt"]}: ${labelledCount[2]}`;
    const perPage = value.match(/^(\d+) pro Seite$/);
    if (perPage) return `${perPage[1]} per page`;
    const pageStatus = value.match(/^Seite ([\d.,\s]+) von ([\d.,\s]+)$/);
    if (pageStatus) return `Page ${pageStatus[1]} of ${pageStatus[2]}`;
    const filter = value.match(/^(Alle|Aktiv|Wartend|Pausiert|Fertig|Fehler) (\d+)$/);
    if (filter) return `${deToEn.get(filter[1]) ?? filter[1]} ${filter[2]}`;
    const runtimeAvailability = value.match(/^(\d+) von (\d+) verfügbar$/);
    if (runtimeAvailability) return `${runtimeAvailability[1]} of ${runtimeAvailability[2]} available`;
    const runtimeAgo = value.match(/^vor (\d+) (Min|Std)\.$/);
    if (runtimeAgo) return `${runtimeAgo[1]} ${runtimeAgo[2] === "Min" ? "min" : "hr"} ago`;
    const runtimeCooldown = value.match(/^(.+) · (\d+) (Sek|Min|Std)\.$/);
    if (runtimeCooldown) {
      const reason = deToEn.get(runtimeCooldown[1]) ?? runtimeCooldown[1];
      const unit = runtimeCooldown[3] === "Sek" ? "sec" : runtimeCooldown[3] === "Min" ? "min" : "hr";
      return `${reason} · ${runtimeCooldown[2]} ${unit}`;
    }
    const remaining = value.match(/^(.+) von (.+) übrig$/);
    if (remaining) return `${remaining[1]} of ${remaining[2]} remaining`;
    const unknownRemaining = value.match(/^Noch unbekannte Dateigrößen: (\d+)\. Die tatsächliche Restmenge kann höher sein\.$/);
    if (unknownRemaining) return `Unknown file sizes: ${unknownRemaining[1]}. The actual remaining amount may be higher.`;
    const actionsFor = value.match(/^Aktionen für (.+)$/);
    if (actionsFor) return `Actions for ${actionsFor[1]}`;
    const assignment = value.match(/^(.+) Zuordnung entfernen$/);
    if (assignment) return `Remove ${assignment[1]} assignment`;
    const providerFor = value.match(/^Provider für (.+)$/);
    if (providerFor) return `Provider for ${providerFor[1]}`;
    const credentialsFor = value.match(/^Zugangsdaten für (.+)$/);
    if (credentialsFor) return `Credentials for ${credentialsFor[1]}`;
    const move = value.match(/^(.+) nach (oben|unten)$/);
    if (move) return `Move ${move[1]} ${move[2] === "oben" ? "up" : "down"}`;
    const audio = value.match(/^Tonspur: (.+)$/);
    if (audio) return `Audio track: ${audio[1].replace(/ohne DE-Tag/g, "without DE tag").replace(/ffmpeg fehlt/g, "ffmpeg missing").replace(/(\d+) Fehler/g, "$1 errors")}`;
    const result = value.match(/^(\d+\/\d+) fertig(.*)$/);
    if (result) return `${result[1]} completed${result[2].replace(/(\d+) Fehler/g, "$1 errors").replace(/(\d+) abgebrochen/g, "$1 cancelled")}`;
    const extracting = value.match(/^Entpacken (\d+%)$/);
    if (extracting) return `Extracting ${extracting[1]}`;
    const finalizing = value.match(/^Finalisieren - (\d+%)$/);
    if (finalizing) return `Finalizing - ${finalizing[1]}`;
    const checkedUntil = value.match(/^Account geprüft — (.+) bis (.+)$/);
    if (checkedUntil) return `Account checked — ${checkedUntil[1]} until ${checkedUntil[2]}`;
    const checked = value.match(/^Account geprüft — (.+)$/);
    if (checked) return `Account checked — ${checked[1]}`;
    const invalid = value.match(/^Account ungültig — (.+)$/);
    if (invalid) return `Invalid account — ${invalid[1]}`;
    const queueLinks = value.match(/^(\d+) Link\(s\) zur Queue hinzugefügt$/);
    if (queueLinks) return `${queueLinks[1]} link(s) added to the queue`;
    const packagesAndLinks = value.match(/^(\d+) Paket\(e\), (\d+) Link\(s\) (hinzugefügt|importiert|exportiert)$/);
    if (packagesAndLinks) return `${packagesAndLinks[1]} package(s), ${packagesAndLinks[2]} link(s) ${{ hinzugefügt: "added", importiert: "imported", exportiert: "exported" }[packagesAndLinks[3] as "hinzugefügt" | "importiert" | "exportiert"]}`;
    const selected = value.match(/^(\d+) ausgewählt$/);
    if (selected) return `${selected[1]} selected`;
    const ago = value.match(/^vor (\d+) (Min|Std|Tag(?:en)?)$/);
    if (ago) return `${ago[1]} ${ago[2] === "Min" ? "min" : ago[2] === "Std" ? "hr" : ago[2].startsWith("Tag") ? "day" : ago[2]} ago`;
    const validation = value.match(/^(.+): (Mindestens einen Account hinzufügen|Bitte Zugangstoken eintragen|Bitte Login oder E-Mail eintragen|Bitte Passwort eintragen|Tageslimit muss eine Zahl >= 0 sein|Bitte mindestens einen gültigen API-Key eintragen)\.$/);
    if (validation) {
      const messages: Record<string, string> = {
        "Mindestens einen Account hinzufügen": "Add at least one account",
        "Bitte Zugangstoken eintragen": "Enter an access token",
        "Bitte Login oder E-Mail eintragen": "Enter a login or email address",
        "Bitte Passwort eintragen": "Enter a password",
        "Tageslimit muss eine Zahl >= 0 sein": "The daily limit must be a number >= 0",
        "Bitte mindestens einen gültigen API-Key eintragen": "Enter at least one valid API key"
      };
      return `${validation[1]}: ${messages[validation[2]]}.`;
    }
    const clipboard = value.match(/^Zwischenablage: (\d+) Link\(s\) erkannt$/);
    if (clipboard) return `Clipboard: ${clipboard[1]} link(s) detected`;
    const disabledKeys = value.match(/^(\d+\/\d+) API-Keys deaktiviert\.$/);
    if (disabledKeys) return `${disabledKeys[1]} API keys disabled.`;
    const accountCheck = value.match(/^Account-Check: (\d+\/\d+) Login gültig, (\d+) mit Premium\.$/);
    if (accountCheck) return `Account check: ${accountCheck[1]} logins valid, ${accountCheck[2]} with premium.`;
    const scopedAccountCheck = value.match(/^(Aktive|Alle) Accounts: (\d+\/\d+) Login gültig, (\d+) mit Premium\.$/);
    if (scopedAccountCheck) return `${scopedAccountCheck[1] === "Aktive" ? "Active" : "All"} accounts: ${scopedAccountCheck[2]} logins valid, ${scopedAccountCheck[3]} with premium.`;
    const removeAccount = value.match(/^Soll (.+) wirklich aus der Accountliste entfernt werden\?$/);
    if (removeAccount) return `Remove ${removeAccount[1]} from the account list?`;
    const resolved = value.match(/^Konflikte gelöst: (\d+) überschrieben, (\d+) übersprungen$/);
    if (resolved) return `Conflicts resolved: ${resolved[1]} overwritten, ${resolved[2]} skipped`;
    const importedDlc = value.match(/^DLC importiert: (\d+) Paket\(e\), (\d+) Link\(s\)$/);
    if (importedDlc) return `DLC imported: ${importedDlc[1]} package(s), ${importedDlc[2]} link(s)`;
    const imported = value.match(/^(Importiert|Drag-and-Drop): (\d+) Paket\(e\), (\d+) Link\(s\)$/);
    if (imported) return `${imported[1] === "Importiert" ? "Imported" : "Drag and drop"}: ${imported[2]} package(s), ${imported[3]} link(s)`;
    const warnings = value.match(/^(\d+) Fehler, (\d+) Warnungen \(letzte (\d+)\)$/);
    if (warnings) return `${warnings[1]} errors, ${warnings[2]} warnings (latest ${warnings[3]})`;
    const capture = value.match(/^Links für (.+) lokal erfassen\.$/);
    if (capture) return `Capture links locally for ${capture[1]}.`;
    const collectorSelection = value.match(/^(.+) aus (.+), Zeile (\d+) auswählen$/);
    if (collectorSelection) return `Select ${collectorSelection[1]} from ${collectorSelection[2]}, line ${collectorSelection[3]}`;
    const collectorTransfer = value.match(/^(Auswahl|Alle) übergeben \((\d+)\)$/);
    if (collectorTransfer) return `${collectorTransfer[1] === "Auswahl" ? "Send selection" : "Send all"} (${collectorTransfer[2]})`;
    const collectorPackageSelect = value.match(/^Paket (.+) auswählen$/);
    if (collectorPackageSelect) return `Select package ${collectorPackageSelect[1]}`;
    const collectorFiles = value.match(/^(\d+) Dateien$/);
    if (collectorFiles) return `${collectorFiles[1]} files`;
    const collectorChecked = value.match(/^(\d+)\/(\d+) geprüft$/);
    if (collectorChecked) return `${collectorChecked[1]}/${collectorChecked[2]} checked`;
    const copy = value.match(/^([\s\S]+?)\s+Klicken zum Kopieren$/);
    if (copy) return `Click to copy ${copy[1]}`;
    const cancelledPart = value.match(/^· (\d+) abgebrochen$/);
    if (cancelledPart) return `· ${cancelledPart[1]} cancelled`;
    const quotaUnknown = value.match(/^(.+): unbekannt \((.+)\)$/);
    if (quotaUnknown) return `${quotaUnknown[1]}: unknown (${quotaUnknown[2]})`;
    const quota = value.match(/^(.+): (.+) frei von (.+) \((.+)% frei\) \| (.+)$/);
    if (quota) return `${quota[1]}: ${quota[2]} free of ${quota[3]} (${quota[4]}% free) | ${quota[5]}`;
    const namedLimit = value.match(/^(.+): (.+) Limit muss eine Zahl >= 0 sein\.$/);
    if (namedLimit) return `${namedLimit[1]}: ${namedLimit[2]} limit must be a number >= 0.`;
    const dailyBlocked = value.match(/^Tageslimit erreicht, bis zum Tagesreset gesperrt(.*)$/);
    if (dailyBlocked) return `Daily limit reached, blocked until the daily reset${dailyBlocked[1]}`;
    const failed = value.match(/^fehlgeschlagen(.*)$/);
    if (failed) return `failed${failed[1]}`;
    const timeout = value.match(/^Timeout\/Abbruch(.*) → nächster Account beim Retry$/);
    if (timeout) return `Timeout/cancellation${timeout[1]} → next account on retry`;
    const localLimit = value.match(/^Lokales Tageslimit erreicht \((.+) \/ (.+)\)\.$/);
    if (localLimit) return `Local daily limit reached (${localLimit[1]} / ${localLimit[2]}).`;
    const noUpdate = value.match(/^Kein Update verfügbar \(v(.+)\)$/);
    if (noUpdate) return `No update available (v${noUpdate[1]})`;
    const cookies = value.match(/^(\d+) BestDebrid-Cookies importiert$/);
    if (cookies) return `${cookies[1]} BestDebrid cookies imported`;
    const saved = value.match(/^(.+) gespeichert$/);
    if (saved) return `${saved[1]} saved`;
    const removeMega = value.match(/^Soll der Mega-Debrid-Account (.+) wirklich entfernt werden\?$/);
    if (removeMega) return `Remove the Mega-Debrid account ${removeMega[1]}?`;
    const removeKey = value.match(/^Soll der Debrid-Link-Key (.+) wirklich entfernt werden\?$/);
    if (removeKey) return `Remove the Debrid-Link key ${removeKey[1]}?`;
    const counterReset = value.match(/^(.+): Tageszähler zurückgesetzt$/);
    if (counterReset) return `${counterReset[1]}: Daily counter reset`;
    const actionFailed = value.match(/^(.+): (Reset|Umschalten|Aktion) fehlgeschlagen: (.+)$/);
    if (actionFailed) return `${actionFailed[1]}: ${{ Reset: "Reset", Umschalten: "Toggle", Aktion: "Action" }[actionFailed[2] as "Reset" | "Umschalten" | "Aktion"]} failed: ${actionFailed[3]}`;
    const toggleFailed = value.match(/^(.+) konnte nicht umgeschaltet werden: (.+)$/);
    if (toggleFailed) return `${toggleFailed[1]} could not be toggled: ${toggleFailed[2]}`;
    const historyQuestion = value.match(/^(\d+) Einträge aus dem Verlauf entfernen\?$/);
    if (historyQuestion) return `Remove ${historyQuestion[1]} entries from history?`;
    const historyRemoved = value.match(/^(\d+) Verlaufseinträge entfernt$/);
    if (historyRemoved) return `${historyRemoved[1]} history entries removed`;
    const packageCount = value.match(/^(\d+) Paket\(e\)$/);
    if (packageCount) return `${packageCount[1]} package(s)`;
    const linkCount = value.match(/^(\d+) Link\(s\)$/);
    if (linkCount) return `${linkCount[1]} link(s)`;
    const exportSelected = value.match(/^Ausgewählte (Pakete|Dateien) exportieren \((\d+)\)$/);
    if (exportSelected) return `Export selected ${exportSelected[1] === "Pakete" ? "packages" : "files"} (${exportSelected[2]})`;
    const toggleAll = value.match(/^Alle (.+) umschalten$/);
    if (toggleAll) return `Toggle all ${toggleAll[1]}`;
    const removeSelected = value.match(/^Ausgewählte entfernen \((\d+)\)$/);
    if (removeSelected) return `Remove selected (${removeSelected[1]})`;
    const removeCollection = value.match(/^Soll die Sammlung (.+) mit (\d+) Link\(s\) wirklich entfernt werden\?$/);
    if (removeCollection) return `Do you really want to remove collection ${removeCollection[1]} with ${removeCollection[2]} link(s)?`;
    const removeEmptyCollection = value.match(/^Soll die leere Sammlung (.+) wirklich entfernt werden\?$/);
    if (removeEmptyCollection) return `Do you really want to remove the empty collection ${removeEmptyCollection[1]}?`;
    const copyTitle = value.match(/^([\s\S]+?)\s+Klicken zum Kopieren$/);
    if (copyTitle) return `Click to copy ${copyTitle[1]}`;
    const moveColumnDirection = value.match(/^(.+) nach (links|rechts) verschieben$/);
    if (moveColumnDirection) return `Move ${deToEn.get(moveColumnDirection[1]) ?? moveColumnDirection[1]} ${moveColumnDirection[2] === "links" ? "left" : "right"}`;
    const moveColumn = value.match(/^(.+) verschieben$/);
    if (moveColumn) return `Move ${deToEn.get(moveColumn[1]) ?? moveColumn[1]}`;
    const copied = value.match(/^(.+) kopiert$/);
    if (copied) return `${copied[1]} copied`;
    const suffixes: Array<[RegExp, string]> = [
      [/^(.+) auswählen$/, "Select $1"], [/^(.+) einklappen$/, "Collapse $1"], [/^(.+) ausklappen$/, "Expand $1"],
      [/^(.+) aktivieren$/, "Enable $1"], [/^(.+) deaktivieren$/, "Disable $1"], [/^(.+) Aktionen$/, "$1 actions"], [/^(.+) entfernen$/, "Remove $1"], [/^(.+) kopieren$/, "Copy $1"]
    ];
    for (const [pattern, replacement] of suffixes) if (pattern.test(value)) return value.replace(pattern, replacement);
    return value
      .replace(/Automatisch entpacken/g, "Extract automatically")
      .replace(/Wartet auf Wiederholung/g, "Waiting to retry")
      .replace(/Fehlgeschlagen nach (\d+) Versuchen/g, "Failed after $1 attempts")
      .replace(/(\d+) Fehler/g, "$1 errors");
  } else {
    const update = value.match(/^(.+) is available\. Installed version: (.+)\.$/);
    if (update) return `${update[1]} ist verfügbar. Installierte Version: ${update[2]}.`;
    const pagination = value.match(/^([\d.,]+\s*[–-]\s*[\d.,]+) of ([\d.,]+)$/);
    if (pagination) return `${pagination[1]} von ${pagination[2]}`;
    const schedule = value.match(/^Schedule rule (\d+)$/);
    if (schedule) return `Zeitregel ${schedule[1]}`;
    const scheduled = value.match(/^Scheduled: (.+)$/);
    if (scheduled) return `Geplant: ${scheduled[1].replace(/^Today\b/, "Heute")}`;
    const cancelled = value.match(/^(\d+) cancelled$/);
    if (cancelled) return `${cancelled[1]} abgebrochen`;
    const labelledCount = value.match(/^(Entries|Visible|Selected): (\d+)$/);
    if (labelledCount) return `${({ Entries: "Einträge", Visible: "Sichtbar", Selected: "Ausgewählt" } as const)[labelledCount[1] as "Entries" | "Visible" | "Selected"]}: ${labelledCount[2]}`;
    const perPage = value.match(/^(\d+) per page$/);
    if (perPage) return `${perPage[1]} pro Seite`;
    const filter = value.match(/^(All|Active|Queued|Paused|Completed|Errors) (\d+)$/);
    if (filter) return `${enToDe.get(filter[1]) ?? filter[1]} ${filter[2]}`;
    const runtimeAvailability = value.match(/^(\d+) of (\d+) available$/);
    if (runtimeAvailability) return `${runtimeAvailability[1]} von ${runtimeAvailability[2]} verfügbar`;
    const runtimeAgo = value.match(/^(\d+) (min|hr) ago$/);
    if (runtimeAgo) return `vor ${runtimeAgo[1]} ${runtimeAgo[2] === "min" ? "Min" : "Std"}`;
    const runtimeCooldown = value.match(/^(.+) · (\d+) (sec|min|hr)$/);
    if (runtimeCooldown) {
      const reason = enToDe.get(runtimeCooldown[1]) ?? runtimeCooldown[1];
      const unit = runtimeCooldown[3] === "sec" ? "Sek" : runtimeCooldown[3] === "min" ? "Min" : "Std";
      return `${reason} · ${runtimeCooldown[2]} ${unit}.`;
    }
    const remaining = value.match(/^(.+) of (.+) remaining$/);
    if (remaining) return `${remaining[1]} von ${remaining[2]} übrig`;
    const unknownRemaining = value.match(/^Unknown file sizes: (\d+)\. The actual remaining amount may be higher\.$/);
    if (unknownRemaining) return `Noch unbekannte Dateigrößen: ${unknownRemaining[1]}. Die tatsächliche Restmenge kann höher sein.`;
    const actionsFor = value.match(/^Actions for (.+)$/);
    if (actionsFor) return `Aktionen für ${actionsFor[1]}`;
    const assignment = value.match(/^Remove (.+) assignment$/);
    if (assignment) return `${assignment[1]} Zuordnung entfernen`;
    const providerFor = value.match(/^Provider for (.+)$/);
    if (providerFor) return `Provider für ${providerFor[1]}`;
    const move = value.match(/^Move (.+) (up|down)$/);
    if (move) return `${move[1]} nach ${move[2] === "up" ? "oben" : "unten"}`;
    const audio = value.match(/^Audio track: (.+)$/);
    if (audio) return `Tonspur: ${audio[1].replace(/without DE tag/g, "ohne DE-Tag").replace(/ffmpeg missing/g, "ffmpeg fehlt").replace(/(\d+) errors/g, "$1 Fehler")}`;
    const result = value.match(/^(\d+\/\d+) completed(.*)$/);
    if (result) return `${result[1]} fertig${result[2].replace(/(\d+) errors/g, "$1 Fehler").replace(/(\d+) cancelled/g, "$1 abgebrochen")}`;
    const extracting = value.match(/^Extracting (\d+%)$/);
    if (extracting) return `Entpacken ${extracting[1]}`;
    const finalizing = value.match(/^Finalizing - (\d+%)$/);
    if (finalizing) return `Finalisieren - ${finalizing[1]}`;
    const checkedUntil = value.match(/^Account checked — (.+) until (.+)$/);
    if (checkedUntil) return `Account geprüft — ${checkedUntil[1]} bis ${checkedUntil[2]}`;
    const credentialsFor = value.match(/^Credentials for (.+)$/);
    if (credentialsFor) return `Zugangsdaten für ${credentialsFor[1]}`;
    const checked = value.match(/^Account checked — (.+)$/);
    if (checked) return `Account geprüft — ${checked[1]}`;
    const invalid = value.match(/^Invalid account — (.+)$/);
    if (invalid) return `Account ungültig — ${invalid[1]}`;
    const queueLinks = value.match(/^(\d+) link\(s\) added to the queue$/);
    if (queueLinks) return `${queueLinks[1]} Link(s) zur Queue hinzugefügt`;
    const packagesAndLinks = value.match(/^(\d+) package\(s\), (\d+) link\(s\) (added|imported|exported)$/);
    if (packagesAndLinks) return `${packagesAndLinks[1]} Paket(e), ${packagesAndLinks[2]} Link(s) ${{ added: "hinzugefügt", imported: "importiert", exported: "exportiert" }[packagesAndLinks[3] as "added" | "imported" | "exported"]}`;
    const selected = value.match(/^(\d+) selected$/);
    if (selected) return `${selected[1]} ausgewählt`;
    const ago = value.match(/^(\d+) (min|hr|day) ago$/);
    if (ago) return `vor ${ago[1]} ${ago[2] === "min" ? "Min" : ago[2] === "hr" ? "Std" : "Tag"}`;
    const validation = value.match(/^(.+): (Add at least one account|Enter an access token|Enter a login or email address|Enter a password|The daily limit must be a number >= 0|Enter at least one valid API key)\.$/);
    if (validation) {
      const messages: Record<string, string> = {
        "Add at least one account": "Mindestens einen Account hinzufügen",
        "Enter an access token": "Bitte Zugangstoken eintragen",
        "Enter a login or email address": "Bitte Login oder E-Mail eintragen",
        "Enter a password": "Bitte Passwort eintragen",
        "The daily limit must be a number >= 0": "Tageslimit muss eine Zahl >= 0 sein",
        "Enter at least one valid API key": "Bitte mindestens einen gültigen API-Key eintragen"
      };
      return `${validation[1]}: ${messages[validation[2]]}.`;
    }
    const clipboard = value.match(/^Clipboard: (\d+) link\(s\) detected$/);
    if (clipboard) return `Zwischenablage: ${clipboard[1]} Link(s) erkannt`;
    const disabledKeys = value.match(/^(\d+\/\d+) API keys disabled\.$/);
    if (disabledKeys) return `${disabledKeys[1]} API-Keys deaktiviert.`;
    const accountCheck = value.match(/^Account check: (\d+\/\d+) logins valid, (\d+) with premium\.$/);
    if (accountCheck) return `Account-Check: ${accountCheck[1]} Login gültig, ${accountCheck[2]} mit Premium.`;
    const scopedAccountCheck = value.match(/^(Active|All) accounts: (\d+\/\d+) logins valid, (\d+) with premium\.$/);
    if (scopedAccountCheck) return `${scopedAccountCheck[1] === "Active" ? "Aktive" : "Alle"} Accounts: ${scopedAccountCheck[2]} Login gültig, ${scopedAccountCheck[3]} mit Premium.`;
    const removeAccount = value.match(/^Remove (.+) from the account list\?$/);
    if (removeAccount) return `Soll ${removeAccount[1]} wirklich aus der Accountliste entfernt werden?`;
    const resolved = value.match(/^Conflicts resolved: (\d+) overwritten, (\d+) skipped$/);
    if (resolved) return `Konflikte gelöst: ${resolved[1]} überschrieben, ${resolved[2]} übersprungen`;
    const importedDlc = value.match(/^DLC imported: (\d+) package\(s\), (\d+) link\(s\)$/);
    if (importedDlc) return `DLC importiert: ${importedDlc[1]} Paket(e), ${importedDlc[2]} Link(s)`;
    const imported = value.match(/^(Imported|Drag and drop): (\d+) package\(s\), (\d+) link\(s\)$/);
    if (imported) return `${imported[1] === "Imported" ? "Importiert" : "Drag-and-Drop"}: ${imported[2]} Paket(e), ${imported[3]} Link(s)`;
    const warnings = value.match(/^(\d+) errors, (\d+) warnings \(latest (\d+)\)$/);
    if (warnings) return `${warnings[1]} Fehler, ${warnings[2]} Warnungen (letzte ${warnings[3]})`;
    const capture = value.match(/^Capture links locally for (.+)\.$/);
    if (capture) return `Links für ${capture[1]} lokal erfassen.`;
    const copy = value.match(/^Click to copy (.+)$/);
    if (copy) return `${copy[1]} Klicken zum Kopieren`;
    const cancelledPart = value.match(/^· (\d+) cancelled$/);
    if (cancelledPart) return `· ${cancelledPart[1]} abgebrochen`;
    const quotaUnknown = value.match(/^(.+): unknown \((.+)\)$/);
    if (quotaUnknown) return `${quotaUnknown[1]}: unbekannt (${quotaUnknown[2]})`;
    const quota = value.match(/^(.+): (.+) free of (.+) \((.+)% free\) \| (.+)$/);
    if (quota) return `${quota[1]}: ${quota[2]} frei von ${quota[3]} (${quota[4]}% frei) | ${quota[5]}`;
    const namedLimit = value.match(/^(.+): (.+) limit must be a number >= 0\.$/);
    if (namedLimit) return `${namedLimit[1]}: ${namedLimit[2]} Limit muss eine Zahl >= 0 sein.`;
    const dailyBlocked = value.match(/^Daily limit reached, blocked until the daily reset(.*)$/);
    if (dailyBlocked) return `Tageslimit erreicht, bis zum Tagesreset gesperrt${dailyBlocked[1]}`;
    const failed = value.match(/^failed(.*)$/);
    if (failed) return `fehlgeschlagen${failed[1]}`;
    const timeout = value.match(/^Timeout\/cancellation(.*) → next account on retry$/);
    if (timeout) return `Timeout/Abbruch${timeout[1]} → nächster Account beim Retry`;
    const localLimit = value.match(/^Local daily limit reached \((.+) \/ (.+)\)\.$/);
    if (localLimit) return `Lokales Tageslimit erreicht (${localLimit[1]} / ${localLimit[2]}).`;
    const noUpdate = value.match(/^No update available \(v(.+)\)$/);
    if (noUpdate) return `Kein Update verfügbar (v${noUpdate[1]})`;
    const cookies = value.match(/^(\d+) BestDebrid cookies imported$/);
    if (cookies) return `${cookies[1]} BestDebrid-Cookies importiert`;
    const saved = value.match(/^(.+) saved$/);
    if (saved) return `${saved[1]} gespeichert`;
    const removeMega = value.match(/^Remove the Mega-Debrid account (.+)\?$/);
    if (removeMega) return `Soll der Mega-Debrid-Account ${removeMega[1]} wirklich entfernt werden?`;
    const removeKey = value.match(/^Remove the Debrid-Link key (.+)\?$/);
    if (removeKey) return `Soll der Debrid-Link-Key ${removeKey[1]} wirklich entfernt werden?`;
    const counterReset = value.match(/^(.+): Daily counter reset$/);
    if (counterReset) return `${counterReset[1]}: Tageszähler zurückgesetzt`;
    const actionFailed = value.match(/^(.+): (Reset|Toggle|Action) failed: (.+)$/);
    if (actionFailed) return `${actionFailed[1]}: ${{ Reset: "Reset", Toggle: "Umschalten", Action: "Aktion" }[actionFailed[2] as "Reset" | "Toggle" | "Action"]} fehlgeschlagen: ${actionFailed[3]}`;
    const toggleFailed = value.match(/^(.+) could not be toggled: (.+)$/);
    if (toggleFailed) return `${toggleFailed[1]} konnte nicht umgeschaltet werden: ${toggleFailed[2]}`;
    const historyQuestion = value.match(/^Remove (\d+) entries from history\?$/);
    if (historyQuestion) return `${historyQuestion[1]} Einträge aus dem Verlauf entfernen?`;
    const historyRemoved = value.match(/^(\d+) history entries removed$/);
    if (historyRemoved) return `${historyRemoved[1]} Verlaufseinträge entfernt`;
    const removeCollection = value.match(/^Do you really want to remove collection (.+) with (\d+) link\(s\)\?$/);
    if (removeCollection) return `Soll die Sammlung ${removeCollection[1]} mit ${removeCollection[2]} Link(s) wirklich entfernt werden?`;
    const removeEmptyCollection = value.match(/^Do you really want to remove the empty collection (.+)\?$/);
    if (removeEmptyCollection) return `Soll die leere Sammlung ${removeEmptyCollection[1]} wirklich entfernt werden?`;
    const pageStatus = value.match(/^Page ([\d.,\s]+) of ([\d.,\s]+)$/);
    if (pageStatus) return `Seite ${pageStatus[1]} von ${pageStatus[2]}`;
    const collectorSelection = value.match(/^Select (.+) from (.+), line (\d+)$/);
    if (collectorSelection) return `${collectorSelection[1]} aus ${collectorSelection[2]}, Zeile ${collectorSelection[3]} auswählen`;
    const collectorTransfer = value.match(/^Send (selection|all) \((\d+)\)$/);
    if (collectorTransfer) return `${collectorTransfer[1] === "selection" ? "Auswahl" : "Alle"} übergeben (${collectorTransfer[2]})`;
    const collectorPackageSelect = value.match(/^Select package (.+)$/);
    if (collectorPackageSelect) return `Paket ${collectorPackageSelect[1]} auswählen`;
    const collectorFiles = value.match(/^(\d+) files$/);
    if (collectorFiles) return `${collectorFiles[1]} Dateien`;
    const collectorChecked = value.match(/^(\d+)\/(\d+) checked$/);
    if (collectorChecked) return `${collectorChecked[1]}/${collectorChecked[2]} geprüft`;
    const moveColumnDirection = value.match(/^Move (.+) (left|right)$/);
    if (moveColumnDirection) return `${enToDe.get(moveColumnDirection[1]) ?? moveColumnDirection[1]} nach ${moveColumnDirection[2] === "left" ? "links" : "rechts"} verschieben`;
    const moveColumn = value.match(/^Move (.+)$/);
    if (moveColumn) return `${enToDe.get(moveColumn[1]) ?? moveColumn[1]} verschieben`;
    const packageCount = value.match(/^(\d+) package\(s\)$/);
    if (packageCount) return `${packageCount[1]} Paket(e)`;
    const linkCount = value.match(/^(\d+) link\(s\)$/);
    if (linkCount) return `${linkCount[1]} Link(s)`;
    const exportSelected = value.match(/^Export selected (packages|files) \((\d+)\)$/);
    if (exportSelected) return `Ausgewählte ${exportSelected[1] === "packages" ? "Pakete" : "Dateien"} exportieren (${exportSelected[2]})`;
    const toggleAll = value.match(/^Toggle all (.+)$/);
    if (toggleAll) return `Alle ${toggleAll[1]} umschalten`;
    const removeSelected = value.match(/^Remove selected \((\d+)\)$/);
    if (removeSelected) return `Ausgewählte entfernen (${removeSelected[1]})`;
    const copied = value.match(/^(.+) copied$/);
    if (copied) return `${copied[1]} kopiert`;
    const suffixes: Array<[RegExp, string]> = [
      [/^Select (.+)$/, "$1 auswählen"], [/^Collapse (.+)$/, "$1 einklappen"], [/^Expand (.+)$/, "$1 ausklappen"],
      [/^Enable (.+)$/, "$1 aktivieren"], [/^Disable (.+)$/, "$1 deaktivieren"], [/^(.+) actions$/, "$1 Aktionen"], [/^Remove (.+)$/, "$1 entfernen"], [/^Copy (.+)$/, "$1 kopieren"]
    ];
    for (const [pattern, replacement] of suffixes) if (pattern.test(value)) return value.replace(pattern, replacement);
    return value
      .replace(/Extract automatically/g, "Automatisch entpacken")
      .replace(/Waiting to retry/g, "Wartet auf Wiederholung")
      .replace(/Failed after (\d+) attempts/g, "Fehlgeschlagen nach $1 Versuchen")
      .replace(/(\d+) errors/g, "$1 Fehler");
  }
}

export function translateUiText(value: string, language: AppLanguage): string {
  const leading = value.match(/^\s*/)?.[0] ?? "";
  const trailing = value.match(/\s*$/)?.[0] ?? "";
  const core = value.slice(leading.length, value.length - trailing.length);
  if (!core) return value;
  const translated = (language === "en" ? deToEn : enToDe).get(core) ?? translateDynamic(core, language);
  return `${leading}${translated}${trailing}`;
}

type Localizer = { setLanguage: (language: AppLanguage) => void; disconnect: () => void };

export function createUiLocalizer(documentRef: Document, initialLanguage: AppLanguage): Localizer {
  let language = initialLanguage;
  const sourceText = new WeakMap<Text, string>();
  const renderedText = new WeakMap<Text, string>();
  const sourceAttributes = new WeakMap<Element, Map<string, string>>();
  const renderedAttributes = new WeakMap<Element, Map<string, string>>();

  const ignored = (node: Node): boolean => node.parentElement?.closest('[data-i18n-ignore="true"]') !== null;
  const localizeText = (node: Text): void => {
    if (ignored(node)) return;
    const current = node.data;
    const lastRendered = renderedText.get(node);
    if (!sourceText.has(node) || (lastRendered !== undefined && current !== lastRendered)) sourceText.set(node, current);
    const next = translateUiText(sourceText.get(node) ?? current, language);
    renderedText.set(node, next);
    if (current !== next) node.data = next;
  };
  const localizeElement = (element: Element): void => {
    if (element.closest('[data-i18n-ignore="true"]')) return;
    let sources = sourceAttributes.get(element);
    let rendered = renderedAttributes.get(element);
    if (!sources) { sources = new Map(); sourceAttributes.set(element, sources); }
    if (!rendered) { rendered = new Map(); renderedAttributes.set(element, rendered); }
    for (const attribute of attributes) {
      const current = element.getAttribute(attribute);
      if (current === null) continue;
      const lastRendered = rendered.get(attribute);
      if (!sources.has(attribute) || (lastRendered !== undefined && current !== lastRendered)) sources.set(attribute, current);
      const next = translateUiText(sources.get(attribute) ?? current, language);
      rendered.set(attribute, next);
      if (current !== next) element.setAttribute(attribute, next);
    }
  };
  const localizeTree = (root: Node): void => {
    if (root.nodeType === Node.TEXT_NODE) localizeText(root as Text);
    if (root.nodeType === Node.ELEMENT_NODE) localizeElement(root as Element);
    const walker = documentRef.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeType === Node.TEXT_NODE) localizeText(node as Text);
      else localizeElement(node as Element);
      node = walker.nextNode();
    }
  };
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "characterData") localizeText(mutation.target as Text);
      else if (mutation.type === "attributes") localizeElement(mutation.target as Element);
      else for (const node of mutation.addedNodes) localizeTree(node);
    }
  });
  const start = (): void => {
    documentRef.documentElement.lang = language;
    localizeTree(documentRef.body);
    observer.observe(documentRef.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: [...attributes] });
  };
  start();
  return {
    setLanguage(nextLanguage) {
      language = nextLanguage;
      documentRef.documentElement.lang = language;
      localizeTree(documentRef.body);
    },
    disconnect() { observer.disconnect(); }
  };
}
