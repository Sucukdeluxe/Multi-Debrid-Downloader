# Task 3 Report: Ferndiagnose-Authentifizierung

Status: umgesetzt.

Umgesetzt:

- Ferndiagnose-Endpunkte akzeptieren nur noch `Authorization: Bearer`.
- Query-Token werden kontrolliert mit `query_token_rejected` abgewiesen.
- Tokenvergleich nutzt `crypto.timingSafeEqual` nur bei gleicher Byte-Länge.
- Diagnoseantworten setzen `Cache-Control: no-store` und keine CORS-Wildcard.
- Nicht erlaubte Methoden liefern kontrolliert `method_not_allowed`.
- `/trace/config` liest per GET, Änderungen laufen nur noch per POST.
- Pro IP beziehungsweise Loopback gibt es ein kleines In-Memory-Limit mit `rate_limited`.
- Support-Manifest und Setup-Hinweise enthalten keine Token-URLs mehr und verweisen auf lokale Bridge/Tunnel-Nutzung.
- Backup-Remote-Diagnostics werden beim Export und Restore auf Allowlist plus lokale Bindung saniert; Ports, Host-Modus, Tokens und Endpoint-Felder werden nicht übernommen.

TDD-Nachweis:

- Baseline vor Teständerung: `npm run test:client -- tests/debug-server.test.ts tests/debug-server-allowlist.test.ts tests/backup-remote-diagnostics.test.ts` mit 33/33 grün.
- RED nach Teständerung: gleicher fokussierter Lauf mit erwarteten Fehlschlägen für no-store, Query-Rejection, GET-Mutation, Methodengate, Rate-Limit und Backup-Sanitizing.
- GREEN nach Implementierung: gleicher fokussierter Lauf mit 38/38 grün.

Verifikation:

- `npm run test:client -- tests/debug-server.test.ts tests/debug-server-allowlist.test.ts tests/backup-remote-diagnostics.test.ts`
- `npx tsc --noEmit`
- `npm run build`
- `git diff --check -- src/main/debug-server.ts src/main/debug-setup.ts src/main/backup-payload.ts tests/debug-server.test.ts tests/debug-server-allowlist.test.ts tests/backup-remote-diagnostics.test.ts`
- Feste Suchstrings in den geänderten Main-Dateien ohne Treffer: `?token=`, `Access-Control-Allow-Origin`, `remoteBaseUrlTemplate`, `searchParams.get("token")`, `Bearer ${authToken}`, `Cache-Control": "no-cache`.

Hinweise:

- Kein Release, Push oder Deployment ausgeführt.
- Der fokussierte Vitest-Lauf meldet weiterhin die bestehende Vite-CJS-Deprecation-Warnung.
