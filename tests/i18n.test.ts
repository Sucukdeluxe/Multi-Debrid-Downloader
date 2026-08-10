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
    expect(translateUiText("Passwort/Zugang", "en")).toBe("Password/access");
  });

  it("translates dynamic update and pagination text", () => {
    expect(translateUiText("v2.0.14 ist verfügbar. Installierte Version: 2.0.13.", "en"))
      .toBe("v2.0.14 is available. Installed version: 2.0.13.");
    expect(translateUiText("1–46 von 46", "en")).toBe("1–46 of 46");
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
    ["1.5 GB von 10 GB übrig", "1.5 GB of 10 GB remaining"]
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
