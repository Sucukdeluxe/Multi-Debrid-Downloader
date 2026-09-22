# Multi-Debrid Backup API

Die API speichert clientseitig verschlüsselte Backups. Neue Clients hinterlegen zusätzlich den Online-Schlüssel als RSA-3072-OAEP-SHA-256-verschlüsselte Kopie. Der Dienst erhält ausschließlich den öffentlichen Wiederherstellungsschlüssel; der private Schlüssel bleibt außerhalb des Datenverzeichnisses und des Dienstprozesses. Mit diesem privaten Schlüssel kann der Betreiber Online-Schlüssel und damit auch die gespeicherten Zugangsdaten wiederherstellen. Es handelt sich daher nicht um eine ausschließlich für den Nutzer entschlüsselbare Sicherung.

Jeder Export wird als eigener unveränderlicher Datensatz gespeichert. Es gibt keine automatische Ablaufzeit und ein neuer Export überschreibt oder löscht keine älteren Sicherungen.

## Konfiguration

| Variable | Standard | Bedeutung |
|---|---:|---|
| `HOST` | `127.0.0.1` | Bind-Adresse |
| `PORT` | `8787` | HTTP-Port hinter einem TLS-Reverse-Proxy |
| `BACKUP_DATA_DIR` | `./data` | Persistentes Datenverzeichnis |
| `RECOVERY_PUBLIC_KEY_FILE` | leer | PEM-Datei mit öffentlichem RSA-3072-Wiederherstellungsschlüssel |
| `ALLOWED_ORIGINS` | leer | Kommagetrennte erlaubte Browser-Origins |
| `RATE_LIMIT_MAX` | `60` | Maximalzahl pro IP und Zeitfenster |
| `RATE_LIMIT_WINDOW_MS` | `60000` | Länge des Zeitfensters |
| `UPLOAD_RATE_LIMIT_MAX` | `10` | Maximale neue Sicherungen pro IP und Upload-Zeitfenster |
| `UPLOAD_RATE_LIMIT_WINDOW_MS` | `3600000` | Länge des separaten Upload-Zeitfensters |
| `MAX_STORAGE_BYTES` | `10737418240` | Globale Obergrenze des persistenten Speichers in Bytes |
| `TRUST_PROXY` | `false` | `true`, wenn der vertrauenswürdige Proxy `X-Forwarded-For` überschreibt |

## Start

```powershell
$env:BACKUP_DATA_DIR = 'C:\ProgramData\MultiDebridBackup'
$env:ALLOWED_ORIGINS = 'https://downloads.24-music.de'
$env:MAX_STORAGE_BYTES = '10737418240'
$env:TRUST_PROXY = 'true'
npm start
```

Der Dienst sollte nur hinter einem TLS-Reverse-Proxy öffentlich erreichbar sein. Bei `TRUST_PROXY=true` muss dieser den eingehenden `X-Forwarded-For`-Header vollständig ersetzen. Das Datenverzeichnis benötigt regelmäßige Dateisystem-Backups.

## HTTP-Vertrag

`POST /v1/backups/recovery-key` liefert Version, Fingerabdruck und öffentlichen Wiederherstellungsschlüssel oder HTTP 503 bei fehlender Konfiguration. `POST /v1/backups` akzeptiert `id`, `blob`, `deleteVerifier` und optional `recovery` (Version 1, `keyId`, RSA-Chiffrat). Ältere Clients bleiben kompatibel; neue App-Exporte verlangen eine funktionierende Wiederherstellungskonfiguration und fallen nicht still auf ungesicherte Schlüssel zurück. Die zusätzliche Kopie wird atomar mit dem Backup gespeichert und zusammen damit gelöscht. OAEP bindet sie an Backup-ID, Blob-Hash und Löschverifikator. `POST /v1/backups/restore` akzeptiert `id` und liefert ausschließlich `blob`, niemals die Schlüsselkopie. `POST /v1/backups/delete` akzeptiert `id` und `deleteSecret`. Fehlerhafte Löschgeheimnisse und unbekannte IDs sind nicht unterscheidbar. IDs erscheinen nie in URLs. Es gibt keinen HTTP-Endpunkt zum Auslesen oder Auflisten von Online-Schlüsseln.

## Administrative Schlüsselwiederherstellung

Vor der produktiven Aktivierung: Datenbestand sichern und Export verifizieren, Ablauf mit Testdaten prüfen, Deployment und Dienstneustart ausdrücklich freigeben lassen. Zuerst Server aktualisieren und konfigurieren, dann den neuen Client verteilen. Bestehende Backups werden nicht verändert; ohne ursprünglich hinterlegte Schlüsselkopie ist keine nachträgliche Wiederherstellung möglich.

Die folgenden Linux-Pfade sind Beispiele und müssen an die tatsächliche Installation angepasst werden. Befehle im Verzeichnis `services/backup-api` ausführen.

1. Als Administrator ein neues, noch nicht vorhandenes Schlüsselverzeichnis außerhalb des Backup-Datenverzeichnisses anlegen:

   ```sh
   node src/recovery-admin.mjs init /root/mdd-recovery-keys
   ```

   Es entstehen `private.pem` und `public.pem`, Dateien mit Modus 0600 und Verzeichnis 0700. Der Befehl überschreibt keine vorhandenen Schlüssel. Unter Windows müssen zusätzlich restriktive NTFS-ACLs gesetzt werden; Unix-Dateimodi allein schützen dort nicht ausreichend.

2. `private.pem` separat und verschlüsselt sichern und die Wiederherstellung mit dieser Kopie prüfen. Weder ins Repository noch in das Backup-Datenverzeichnis oder ein Support-Bundle legen. Der Webdienst darf keinen Lesezugriff darauf erhalten. Nur `public.pem` in ein für den Dienst lesbares Konfigurationsverzeichnis kopieren und `RECOVERY_PUBLIC_KEY_FILE` auf dessen absoluten Pfad setzen. Ein ungültiger konfigurierter Schlüssel verhindert den Dienststart. Ohne konfigurierte Datei bleiben alte Clients nutzbar, neue Exporte schlagen gezielt fehl.

3. Sicherungen anhand von Datum und ID auflisten (keine Zugangsdaten oder Online-Schlüssel):

   ```sh
   node src/recovery-admin.mjs list /var/lib/mdd-backups
   ```

   `recoveryKeyId: null` bedeutet: keine Schlüsselkopie vorhanden. Bei mehreren Sicherungen dienen Erstellungszeitpunkt und Backup-ID zur Zuordnung; Inhalte oder Accountnamen werden nicht aufgelistet.

4. Als Administrator den Schlüssel in eine neue Datei außerhalb des Datenverzeichnisses schreiben:

   ```sh
   node src/recovery-admin.mjs recover /var/lib/mdd-backups BACKUP_ID /root/mdd-recovery-keys/private.pem /root/mdd-online-key.txt
   ```

   `BACKUP_ID` durch die ausgewählte ID ersetzen. Der Befehl prüft Schlüssel-Fingerabdruck, OAEP-Bindung, MDD2-Prüfsumme, Löschverifikator und AES-GCM-Authentizität des Backups. Er überschreibt keine Datei und gibt den Schlüssel nicht im Terminal aus. Die Ausgabedatei enthält den vollständigen MDD2-Schlüssel und ist wie ein Passwort zu behandeln. Sicher auf den eigenen Rechner übertragen, in MDD unter „Online-Schlüssel importieren“ verwenden und nicht in Chats oder Logs kopieren.

Schlüsselrotation: Alte private Schlüssel sicher behalten, solange zugehörige Sicherungen existieren. Neue öffentliche Schlüssel gelten nur für neue Exporte; vorhandene Kopien werden nicht umgeschrieben. Bei Verlust des privaten Schlüssels sind die dazugehörigen Schlüsselkopien nicht wiederherstellbar. Der Dienst benötigt den privaten Schlüssel auch nach der Einrichtung nicht.
