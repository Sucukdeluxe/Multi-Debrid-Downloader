# Multi-Debrid Backup API

Die API speichert ausschließlich bereits clientseitig verschlüsselte, undurchsichtige Backups. Schlüssel und Klartext verlassen den Client nicht.

Jeder Export wird als eigener unveränderlicher Datensatz gespeichert. Es gibt keine automatische Ablaufzeit und ein neuer Export überschreibt oder löscht keine älteren Sicherungen.

## Konfiguration

| Variable | Standard | Bedeutung |
|---|---:|---|
| `HOST` | `127.0.0.1` | Bind-Adresse |
| `PORT` | `8787` | HTTP-Port hinter einem TLS-Reverse-Proxy |
| `BACKUP_DATA_DIR` | `./data` | Persistentes Datenverzeichnis |
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

`POST /v1/backups` akzeptiert `id`, `blob` und `deleteVerifier`. `POST /v1/backups/restore` akzeptiert `id` und liefert ausschließlich `blob`. `POST /v1/backups/delete` akzeptiert `id` und `deleteSecret`. Fehlerhafte Löschgeheimnisse und unbekannte IDs sind nicht unterscheidbar. IDs erscheinen nie in URLs.
