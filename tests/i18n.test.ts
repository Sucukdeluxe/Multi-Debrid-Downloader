import { describe, expect, it } from "vitest";
import { normalizeLanguage, translateUiText } from "../src/renderer/i18n";

describe("renderer localization", () => {
  it("falls back to English", () => {
    expect(normalizeLanguage(undefined)).toBe("en");
    expect(normalizeLanguage("fr")).toBe("en");
    expect(normalizeLanguage("de")).toBe("de");
  });

  it("translates exact interface labels in both directions", () => {
    expect(translateUiText("Einstellungen speichern", "en")).toBe("Save settings");
    expect(translateUiText("Save settings", "de")).toBe("Einstellungen speichern");
    expect(translateUiText("Änderungen verwerfen", "en")).toBe("Discard changes");
    expect(translateUiText("Discard changes", "de")).toBe("Änderungen verwerfen");
    expect(translateUiText("Ungespeicherte Änderungen verworfen", "en")).toBe("Unsaved changes discarded");
    expect(translateUiText("Zwischenstand gespeichert – weitere Änderungen sind ungespeichert", "en")).toBe("Progress saved – additional changes remain unsaved");
    expect(translateUiText("Passwort/Zugang", "en")).toBe("Password/access");
    expect(translateUiText("Animationen", "en")).toBe("Animations");
    expect(translateUiText("Animations", "de")).toBe("Animationen");
  });

  it.each([
    ["Deepbrid API", "Deepbrid API"],
    ["Direkter Zugriff über API-Key.", "Direct access via API key."],
    ["Deepbrid gespeichert", "Deepbrid saved"]
  ])("translates Deepbrid account UI text %s", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
  });

  it.each([
    ["Proxy-only ist aktiviert, aber es ist keine Proxy-Liste hinterlegt. Hinterlege sie unter Einstellungen → Geschwindigkeit.", "Proxy-only is enabled, but no proxy list is configured. Add one under Settings → Speed."],
    ["Proxy-only ist aktiviert, aber die hinterlegte Proxy-Liste kann nicht gelesen werden. Prüfe die Datei unter Einstellungen → Geschwindigkeit.", "Proxy-only is enabled, but the configured proxy list cannot be read. Check the file under Settings → Speed."],
    ["Proxy-only ist aktiviert, aber die hinterlegte Proxy-Liste ist leer oder enthält keine gültigen HTTP-Proxys.", "Proxy-only is enabled, but the configured proxy list is empty or contains no valid HTTP proxies."],
    ["Proxy-only ist aktiviert, aber der feste API-Proxy ist in der Liste nicht verfügbar. Prüfe den Listeneintrag unter Einstellungen → Geschwindigkeit.", "Proxy-only is enabled, but the fixed API proxy is not available in the list. Check the list entry under Settings → Speed."],
    ["Proxy-only ist aktiviert, aber der feste API-Proxy ist nicht erreichbar oder lehnt die Verbindung ab. Prüfe den Proxy unter Einstellungen → Geschwindigkeit.", "Proxy-only is enabled, but the fixed API proxy is unreachable or refuses the connection. Check the proxy under Settings → Speed."]
  ])("translates Proxy-only account guidance %s", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it.each([
    ["Dieser Schlüssel stellt deine Einstellungen inklusive gespeicherter Zugangsdaten und hinterlegter Proxy-Liste wieder her. Bewahre ihn wie ein Passwort auf.", "This key restores your settings, including saved credentials and the configured proxy list. Keep it as secure as a password."],
    ["Füge den vollständigen MDD2-Schlüssel ein. Einstellungen und eine enthaltene Proxy-Liste werden durch die gespeicherte Version ersetzt.", "Paste the complete MDD2 key. Settings and any included proxy list will be replaced by the stored version."],
    ["Einstellungen und Proxy-Liste aus Online-Sicherung wiederhergestellt", "Settings and proxy list restored from online backup"],
    ["Einstellungen wiederhergestellt; Proxy-only wurde deaktiviert, weil die Online-Sicherung keine Proxy-Liste enthält", "Settings restored; Proxy-only was disabled because the online backup contains no proxy list"]
  ])("translates online proxy-list backup text %s", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it.each([
    ["Erfolgsmeldungen senden", "Send success notifications"],
    ["Gesammelt (alle 2 Minuten)", "Grouped (every 2 minutes)"],
    ["Jedes Paket einzeln", "Each package individually"],
    ["Melden, wenn der gesamte Lauf fertig ist", "Notify when the entire run completes"],
    ["Melden, wenn die Restmenge unterschritten wird", "Notify when the remaining amount falls below the threshold"],
    ["Restmengenschwelle (GB)", "Remaining amount threshold (GB)"],
    ["Melden, wenn Downloads stillstehen", "Notify when downloads stall"],
    ["Stillstand bestätigen nach (Sek.)", "Confirm stall after (sec.)"],
    ["Frühestens erneut melden nach (Min.)", "Notify again after at least (min.)"],
    ["Melden, wenn Downloads wieder laufen", "Notify when downloads resume"]
  ])("translates notification center setting %s in both directions", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it.each([
    ["Starttag", "Start day"],
    ["Ab heute", "Starting today"],
    ["Ab morgen", "Starting tomorrow"],
    ["Bitte eine gültige Startzeit auswählen.", "Select a valid start time."]
  ])("translates daily schedule text %s in both directions", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it("translates dynamic update and pagination text", () => {
    expect(translateUiText("v2.0.14 ist verfügbar. Installierte Version: 2.0.13.", "en"))
      .toBe("v2.0.14 is available. Installed version: 2.0.13.");
    expect(translateUiText("1–46 von 46", "en")).toBe("1–46 of 46");
    expect(translateUiText("100.001–100.005 von 100.005", "en")).toBe("100.001–100.005 of 100.005");
    expect(translateUiText("100.001–100.005 of 100.005", "de")).toBe("100.001–100.005 von 100.005");
  });

  it.each([
    ["Finalisieren - 0%", "Finalizing - 0%"],
    ["Finalisieren - 50%", "Finalizing - 50%"],
    ["Finalisieren - 100%", "Finalizing - 100%"]
  ])("translates compact finalization progress %s in both directions", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it("translates the complete history surface including status values", () => {
    const translations = new Map([
      ["Alle Einträge", "All entries"],
      ["Heute", "Today"],
      ["Letzte 7 Tage", "Last 7 days"],
      ["Älter", "Older"],
      ["Gelöscht", "Deleted"],
      ["Fehlgeschlagen", "Failed"],
      ["Verlauf leeren", "Clear history"],
      ["Gesamtverlauf löschen", "Delete all history"],
      ["Erneut hinzufügen", "Add again"],
      ["Im Ordner zeigen", "Show in folder"],
      ["Auswahl löschen", "Clear selection"],
      ["Noch kein Verlauf", "No history yet"],
      ["Keine passenden Einträge", "No matching entries"]
    ]);

    for (const [german, english] of translations) {
      expect(translateUiText(german, "en")).toBe(english);
      expect(translateUiText(english, "de")).toBe(german);
    }
  });

  it.each([
    ["Download gestartet", "Download started"],
    ["Download beendet", "Download finished"],
    ["Nachbearbeitung gestartet", "Post-processing started"],
    ["Gesamtdauer", "Total duration"],
    ["Erfolgreich / Fehlgeschlagen / Abgebrochen", "Successful / Failed / Cancelled"],
    ["Archive / Parts / Ausgaben", "Archives / parts / outputs"],
    ["Fehlerphase", "Failure phase"],
    ["Fehlerkategorie", "Error category"],
    ["Download / Offline / Entpacken / Remux / Cleanup / Nachbearbeitung", "Download / Offline / Extraction / Remux / Cleanup / Post-processing"],
    ["Downloaddauer (Altbestand)", "Download duration (legacy)"],
    ["Archivvorgänge", "Archive operations"],
    ["Remuxvorgänge", "Remux operations"],
    ["Keine Archivvorgänge", "No archive operations"],
    ["Keine Remuxvorgänge", "No remux operations"]
  ])("translates history lifecycle text %s in both directions", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it.each([
    ["2 Parts", "2 parts"],
    ["1.250 Parts", "1,250 parts"]
  ])("translates dynamic history operation text %s in both directions", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it.each([
    ["Letzte 24 Stunden", "Last 24 hours"],
    ["Account-Traffic der vergangenen 24 Stunden.", "Account traffic over the past 24 hours."],
    ["Letzte 24 Stunden: Werte seit Beginn der Aufzeichnung.", "Last 24 hours: values since tracking began."],
    ["Heutige Werte stammen aus der lokalen Statistikaufzeichnung.", "Today's values come from local statistics tracking."],
    ["Datenmenge und Dateien stammen aus den Gesamtzählern; Ergebnisse und Durchschnitt seit Beginn der Statistikaufzeichnung.", "Data volume and files come from the total counters; results and averages cover the period since statistics tracking began."],
    ["Dateien werden nicht minutengenau nach Account erfasst", "File counts are not tracked per account at minute precision"],
    ["Ergebnisse werden nicht minutengenau nach Account erfasst", "Results are not tracked per account at minute precision"],
    ["Aktive Downloadzeit wird nur tagesweise erfasst", "Active download time is tracked by day only"],
    ["Fehler werden nicht minutengenau nach Account erfasst", "Errors are not tracked per account at minute precision"],
    ["Letzte sieben Tage", "Last seven days"],
    ["Letzte 30 Tage", "Last 30 days"],
    ["Seit Beginn der Statistikaufzeichnung", "Since statistics tracking began"],
    ["Noch keine aktive Downloadzeit mit übertragenen Daten erfasst", "No active download time with transferred data has been recorded yet"],
    ["In den vergangenen 24 Stunden wurde noch kein Account-Traffic erfasst.", "No account traffic has been recorded in the past 24 hours."],
    ["In diesem Zeitraum wurden noch keine Providerwerte erfasst.", "No provider values have been recorded for this period."]
  ])("translates statistics copy %s in both directions", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it.each([
    ["Letzte sieben Tage: 1 erfasster Tag wird bis heute zusammengefasst.", "Last seven days: 1 recorded day is summarized through today."],
    ["Letzte 30 Tage: 12 erfasste Tage werden bis heute zusammengefasst.", "Last 30 days: 12 recorded days are summarized through today."],
    ["1,5 GB", "1.5 GB"],
    ["1.250 GB", "1,250 GB"],
    ["1,5 MB/s", "1.5 MB/s"],
    ["50,5 %", "50.5 %"],
    ["Daten: 1.250 GB", "Data: 1,250 GB"],
    ["Dateien: 1.250", "Files: 1,250"],
    ["Erfolg: 50,5 %", "Success: 50.5 %"],
    ["Fehler: 1.250", "Errors: 1,250"],
    ["Provider: 1.250", "Providers: 1,250"],
    ["Accounts: 1.250", "Accounts: 1,250"],
    ["5 fertig · 2 Fehler", "5 completed · 2 errors"],
    ["1.250 fertig · 2.500 Fehler", "1,250 completed · 2,500 errors"]
  ])("localizes dynamic statistics text %s in both directions", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it.each([
    ["1.250 GB", "de", "1.250 GB"],
    ["1,5 GB", "de", "1,5 GB"],
    ["1,250 GB", "en", "1,250 GB"],
    ["1.5 GB", "en", "1.5 GB"],
    ["50,5 %", "de", "50,5 %"],
    ["50.5 %", "en", "50.5 %"]
  ])("preserves statistics numbers already formatted for %s", (value, language, expected) => {
    expect(translateUiText(value, language as "de" | "en")).toBe(expected);
  });

  it.each([
    ["Hell", "Light"],
    ["Dunkel", "Dark"]
  ])("translates the German theme name %s in both directions", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it.each([
    ["Entpackte Downloads sind ausgeblendet", "Extracted downloads are hidden"],
    ["Deaktiviere „Entpackte Einträge ausblenden“, um sie wieder anzuzeigen.", "Disable “Hide extracted entries” to show them again."],
    ["Downloads können derzeit nicht gestartet werden", "Downloads cannot be started right now"],
    ["Nur fehlerhafte Dateien zurücksetzen", "Reset failed files only"],
    ["Gesamtes Paket zurücksetzen", "Reset entire package"],
    ["Ausgewählte Pakete vollständig zurücksetzen", "Reset selected packages completely"]
  ])("translates download state text %s in both directions", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it.each([
    ["Start fehlgeschlagen: IPC_TIMEOUT", "Start failed: IPC_TIMEOUT"],
    ["Pause fehlgeschlagen: IPC_TIMEOUT", "Pause failed: IPC_TIMEOUT"]
  ])("translates download action failures %s in both directions", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it.each([
    ["Ausgewählte Downloads starten (1.250)", "Start selected downloads (1,250)"],
    ["Ausgewählte Pakete exportieren (1.250)", "Export selected packages (1,250)"],
    ["Ausgewählte Dateien exportieren (1.250)", "Export selected files (1,250)"],
    ["Alle 1.250 umschalten", "Toggle all 1,250"],
    ["Ausgewählte Dateien entfernen (1.250)", "Remove selected files (1,250)"],
    ["Zurücksetzen (1.250)", "Reset (1,250)"],
    ["überspringen (1.250)", "skip (1,250)"],
    ["Ausgewählte entfernen (1.250)", "Remove selected (1,250)"]
  ])("localizes dynamic download action %s in both directions", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it.each([
    ["Ausgewählte Downloads starten (1250)", "Start selected downloads (1,250)", "Ausgewählte Downloads starten (1.250)"],
    ["Ausgewählte Pakete exportieren (1250)", "Export selected packages (1,250)", "Ausgewählte Pakete exportieren (1.250)"],
    ["Ausgewählte Dateien exportieren (1250)", "Export selected files (1,250)", "Ausgewählte Dateien exportieren (1.250)"],
    ["Alle 1250 umschalten", "Toggle all 1,250", "Alle 1.250 umschalten"],
    ["Ausgewählte Dateien entfernen (1250)", "Remove selected files (1,250)", "Ausgewählte Dateien entfernen (1.250)"],
    ["Zurücksetzen (1250)", "Reset (1,250)", "Zurücksetzen (1.250)"],
    ["überspringen (1250)", "skip (1,250)", "überspringen (1.250)"],
    ["Ausgewählte entfernen (1250)", "Remove selected (1,250)", "Ausgewählte entfernen (1.250)"]
  ])("formats raw download action counts in both target locales", (germanRaw, english, germanLocalized) => {
    expect(translateUiText(germanRaw, "en")).toBe(english);
    expect(translateUiText(germanRaw, "de")).toBe(germanLocalized);
    expect(translateUiText(english, "de")).toBe(germanLocalized);
  });

  it("translates dynamic queue and availability values", () => {
    expect(translateUiText("26/26 online", "en")).toBe("26/26 online");
    expect(translateUiText("3 abgebrochen", "en")).toBe("3 cancelled");
    expect(translateUiText("Geplant: 18:30", "en")).toBe("Scheduled: 18:30");
    expect(translateUiText("Einträge: 2", "en")).toBe("Entries: 2");
    expect(translateUiText("Sichtbar: 2", "en")).toBe("Visible: 2");
    expect(translateUiText("Ausgewählt: 0", "en")).toBe("Selected: 0");
    expect(translateUiText("2 pro Seite", "en")).toBe("2 per page");
    expect(translateUiText("Sichtbar: ", "en")).toBe("Visible: ");
    expect(translateUiText(" pro Seite", "en")).toBe(" per page");
    expect(translateUiText("Soll die Sammlung Tab 2 mit 5 Link(s) wirklich entfernt werden?", "en"))
      .toBe("Do you really want to remove collection Tab 2 with 5 link(s)?");
    expect(translateUiText("Soll die leere Sammlung Tab 2 wirklich entfernt werden?", "en"))
      .toBe("Do you really want to remove the empty collection Tab 2?");
    expect(translateUiText("Link kopieren", "en")).toBe("Copy Link");
    expect(translateUiText("example.test Klicken zum Kopieren", "en")).toBe("Click to copy example.test");
    expect(translateUiText("Klicken zum Kopieren", "en")).toBe("Click to copy");
    expect(translateUiText("Geprüft", "en")).toBe("Checked");
    expect(translateUiText("gerade eben", "en")).toBe("just now");
    expect(translateUiText("Noch unbekannte Dateigrößen: 3. Die tatsächliche Restmenge kann höher sein.", "en"))
      .toBe("Unknown file sizes: 3. The actual remaining amount may be higher.");
    expect(translateUiText("Geschwindigkeit verschieben", "en")).toBe("Move Speed");
    expect(translateUiText("Geschwindigkeit nach links verschieben", "en")).toBe("Move Speed left");
    expect(translateUiText("Move Speed right", "de")).toBe("Geschwindigkeit nach rechts verschieben");
    expect(translateUiText("Verlaufsseiten", "en")).toBe("History pages");
    expect(translateUiText("Vorherige Verlaufsseite", "en")).toBe("Previous history page");
    expect(translateUiText("Nächste Verlaufsseite", "en")).toBe("Next history page");
    expect(translateUiText("Zurück", "en")).toBe("Back");
    expect(translateUiText("Vor", "en")).toBe("Next");
    expect(translateUiText("Seite 2 von 7", "en")).toBe("Page 2 of 7");
    expect(translateUiText("Page 2 of 7", "de")).toBe("Seite 2 von 7");
    expect(translateUiText("Seite 1.000 von 2.500", "en")).toBe("Page 1.000 of 2.500");
    expect(translateUiText("1 von 2 verfügbar", "en")).toBe("1 of 2 available");
    expect(translateUiText("vor 2 Min.", "en")).toBe("2 min ago");
    expect(translateUiText("Rate-Limit aktiv · 48 Sek.", "en")).toBe("Rate limit active · 48 sec");
    expect(translateUiText("Rate limit active · 48 sec", "de")).toBe("Rate-Limit aktiv · 48 Sek.");
    expect(translateUiText("Accountdaten werden aktualisiert.", "en")).toBe("Account data is being updated.");
    expect(translateUiText("Keine passenden Dienste oder Zugangstypen gefunden.", "en"))
      .toBe("No matching services or access types found.");
    expect(translateUiText("https://example.test/a aus Sammlung A, Zeile 3 auswählen", "en"))
      .toBe("Select https://example.test/a from Sammlung A, line 3");
    expect(translateUiText("Select https://example.test/a from Sammlung A, line 3", "de"))
      .toBe("https://example.test/a aus Sammlung A, Zeile 3 auswählen");
    expect(translateUiText("abc••••\nKlicken zum Kopieren", "en")).toBe("Click to copy abc••••");
  });

  it.each([
    ["Pakete:", "Packages:"],
    ["Links:", "Links:"],
    ["Downloads übergeben", "Transfer downloads"],
    ["Linksammler-Filter", "Link collector filters"],
    ["Suche und Paketdarstellung", "Search and package display"],
    ["Gesammelte Downloadpakete", "Collected download packages"],
    ["Analyse läuft im Hintergrund", "Analysis is running in the background"],
    ["Name, URL oder Hoster", "Name, URL, or host"],
    ["Teilweise online", "Partially online"],
    ["Hinzugefügt", "Added"],
    ["Passe Suche oder Statusfilter an.", "Adjust the search or status filter."],
    ["Die ersten Links erscheinen sofort nach dem Import.", "The first links appear immediately after import."],
    ["Links werden vorbereitet", "Links are being prepared"],
    ["Füge Links hinzu, um Pakete vor dem Download zu prüfen.", "Add links to check packages before downloading."],
    ["Links erscheinen sofort und werden anschließend im Hintergrund geprüft.", "Links appear immediately and are then checked in the background."],
    ["Eine URL pro Zeile", "One URL per line"],
    ["Keine übertragbaren Links ausgewählt", "No transferable links selected"],
    ["Alle sichtbaren Links auswählen", "Select all visible links"],
    ["Der Linksammler ist zu groß, um gespeichert zu werden.", "The link collector is too large to save."]
  ])("translates collector label %s in both directions", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it.each([
    ["Auswahl übergeben (3)", "Send selection (3)"],
    ["Alle übergeben (20.000)", "Send all (20,000)"],
    ["Paket Staffel 1 auswählen", "Select package Staffel 1"],
    ["2.001 Dateien", "2,001 files"],
    ["20.000/20.000 online", "20,000/20,000 online"],
    ["Pakete: 2.001", "Packages: 2,001"],
    ["Links: 20.000", "Links: 20,000"],
    ["Ausgewählt: 1.250", "Selected: 1,250"],
    ["Der Linksammler kann höchstens 2.000 Pakete enthalten.", "The link collector can contain at most 2,000 packages."],
    ["Der Linksammler kann höchstens 20.000 Links enthalten.", "The link collector can contain at most 20,000 links."],
    ["Der Queue-Export überschreitet das Collector-Limit von 2.000 Paketen.", "The queue export exceeds the link collector limit of 2,000 packages."],
    ["Der Queue-Export überschreitet das Collector-Limit von 20.000 Links.", "The queue export exceeds the link collector limit of 20,000 links."],
    ["1.250", "1,250"]
  ])("translates dynamic collector text %s in both directions", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it("translates nested collector persistence and import failures", () => {
    expect(translateUiText("Links konnten nicht vorbereitet werden: Error: Der Queue-Export ist ungültig.", "en"))
      .toBe("Links could not be prepared: Error: The queue export is invalid.");
    expect(translateUiText("Linksammler konnte nicht gespeichert werden: Error: disk full", "en"))
      .toBe("Link collector could not be saved: Error: disk full");
  });

  it.each([
    ["1 Paket(e), 2 Link(s) gesammelt", "1 package(s), 2 link(s) collected"],
    ["DLC gesammelt: 1 Paket(e), 2 Link(s)", "DLC collected: 1 package(s), 2 link(s)"],
    ["1 von 2 Link(s) übergeben; Sammlung bleibt erhalten", "1 of 2 link(s) transferred; collection remains"],
    ["1 Paket(e), 2 Link(s) übergeben", "1 package(s), 2 link(s) transferred"],
    ["Linksammler-Payload ist ungültig", "Link collector payload is invalid"]
  ])("translates collector runtime feedback %s in both directions", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it.each([
    ["Verfügbarkeit", "Availability"],
    ["Hinzugefügt am", "Added on"],
    ["Ungeprüft", "Unchecked"],
    ["Paket gestoppt", "Package stopped"],
    ["Noch keine Downloads", "No downloads yet"],
    ["Füge Links hinzu, um den ersten Download zu starten.", "Add links to start the first download."],
    ["Neue Sammlung", "New collection"],
    ["Links erfassen", "Capture links"],
    ["Datei importieren", "Import file"],
    ["Sammlung verarbeiten", "Process collection"],
    ["An Downloads übergeben", "Send to downloads"],
    ["Keine passenden Links", "No matching links"],
    ["Noch keine Links", "No links yet"],
    ["Eine URL oder Rohzeile pro Zeile", "One URL or raw line per line"],
    ["Prüfen und speichern", "Check and save"],
    ["Accounts durchsuchen", "Search accounts"],
    ["Account-Typ filtern", "Filter account type"],
    ["Keine passenden Account-Typen.", "No matching account types."],
    ["Geschützter Zugang", "Protected access"],
    ["Immer erste Tonspur", "Always first audio track"],
    ["Keine Archive löschen", "Do not delete archives"],
    ["Sieben Tage", "Seven days"],
    ["Zeitraum", "Period"],
    ["Nicht verfügbar", "Unavailable"],
    ["Datenmenge", "Data volume"],
    ["Erfolgsquote", "Success rate"],
    ["Durchschnitt", "Average"],
    ["Live aus der aktuellen Renderer-Sitzung", "Live from the current renderer session"],
    ["Kontextmenü", "Context menu"],
    ["Die Oberfläche hat einen Fehler ausgelöst", "The interface encountered an error"],
    ["Oberfläche neu laden", "Reload interface"],
    ["Unbekannter Fehler", "Unknown error"],
    ["Details anzeigen", "Show details"],
    ["Details ausblenden", "Hide details"]
  ])("translates renderer text %s in both directions", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it.each([
    ["Film.mkv auswählen", "Select Film.mkv"],
    ["Aktionen für Film.mkv", "Actions for Film.mkv"],
    ["RapidGator Zuordnung entfernen", "Remove RapidGator assignment"],
    ["RapidGator nach oben", "Move RapidGator up"],
    ["Geplant: Heute 22:15", "Scheduled: Today 22:15"],
    ["Tonspur: 2 OK · 1 ohne DE-Tag · ffmpeg fehlt · 3 Fehler", "Audio track: 2 OK · 1 without DE tag · ffmpeg missing · 3 errors"],
    ["4/8 fertig · 2 Fehler", "4/8 completed · 2 errors"],
    ["Entpacken 52%", "Extracting 52%"],
    ["Fehlgeschlagen nach 3 Versuchen: HTTP 503 von https://host.test/a", "Failed after 3 attempts: HTTP 503 von https://host.test/a"],
    ["Update-Check fehlgeschlagen: ECONNRESET https://api.test/v1", "Update check failed: ECONNRESET https://api.test/v1"],
    ["Account geprüft — Premium bis 2027-01-01", "Account checked — Premium until 2027-01-01"],
    ["7 Link(s) zur Queue hinzugefügt", "7 link(s) added to the queue"],
    ["2 Paket(e), 5 Link(s) importiert", "2 package(s), 5 link(s) imported"],
    ["3 ausgewählt", "3 selected"],
    ["vor 4 Std", "4 hr ago"],
    ["Zeitregel 4", "Schedule rule 4"],
    ["1.5 GB von 10 GB übrig", "1.5 GB of 10 GB remaining"],
    ["Verbleibend", "Remaining"]
  ])("translates composed renderer text %s without changing its payload", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it.each([
    "https://rapidgator.net/file/abc?token=secret",
    "C:\\Downloads\\Film [1080p]\\video.mkv",
    "video.GERMAN.DL.1080p.mkv",
    "ECONNRESET at api.example.test:443",
    "RapidGator API: quota=0"
  ])("keeps free technical content unchanged: %s", (value) => {
    expect(translateUiText(value, "en")).toBe(value);
    expect(translateUiText(value, "de")).toBe(value);
  });

  it.each([
    ["nicht gesetzt", "not set"],
    ["Schätzwert", "Estimate"],
    ["ist verfügbar. Installierte Version:", "is available. Installed version:"],
    ["Tageslimit erreicht. Neue Links wechseln auf den nächsten Hoster.", "Daily limit reached. New links will switch to the next hoster."],
    ["Der ausgewählte Real-Debrid-Account wurde nicht gefunden.", "The selected Real-Debrid account was not found."],
    ["Nur lokal", "Local only"],
    ["Name kopiert", "Name copied"],
    ["Link kopiert", "Link copied"],
    ["Bei \"überspringen\" wird nur das erneute Entpacken übersprungen - offene Downloads bleiben in der Queue.", "With \"skip\", only repeated extraction is skipped - open downloads remain in the queue."]
  ])("translates remaining renderer inventory text %s", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });

  it.each([
    ["Debug-Server aktiv: 127.0.0.1:9345", "Debug server active: 127.0.0.1:9345"],
    ["Unbekannter Account-Typ: custom-provider", "Unknown account type: custom-provider"],
    ["RapidGator: Bitte Passwort eintragen.", "RapidGator: Enter a password."],
    ["Update-Download: 42% (42 MB / 100 MB)", "Update download: 42% (42 MB / 100 MB)"],
    ["Zwischenablage: 3 Link(s) erkannt", "Clipboard: 3 link(s) detected"],
    ["2/4 API-Keys deaktiviert.", "2/4 API keys disabled."],
    ["Account-Check: 3/4 Login gültig, 2 mit Premium.", "Account check: 3/4 logins valid, 2 with premium."],
    ["Aktive Accounts: 1/1 Login gültig, 1 mit Premium.", "Active accounts: 1/1 logins valid, 1 with premium."],
    ["Alle Accounts: 2/5 Login gültig, 2 mit Premium.", "All accounts: 2/5 logins valid, 2 with premium."],
    ["Soll RapidGator wirklich aus der Accountliste entfernt werden?", "Remove RapidGator from the account list?"],
    ["Konflikte gelöst: 2 überschrieben, 3 übersprungen", "Conflicts resolved: 2 overwritten, 3 skipped"],
    ["DLC importiert: 2 Paket(e), 5 Link(s)", "DLC imported: 2 package(s), 5 link(s)"],
    ["3 Fehler, 2 Warnungen (letzte 5)", "3 errors, 2 warnings (latest 5)"],
    ["Links für Sammlung 1 lokal erfassen.", "Capture links locally for Sammlung 1."],
    ["Film.mkv Klicken zum Kopieren", "Click to copy Film.mkv"]
  ])("translates additional composed renderer text %s", (german, english) => {
    expect(translateUiText(german, "en")).toBe(english);
    expect(translateUiText(english, "de")).toBe(german);
  });
});
