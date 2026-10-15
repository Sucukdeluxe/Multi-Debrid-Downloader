# Media applications MCP relay protocol, version 1

This service forwards MCP JSON-RPC between an authenticated client and one running desktop installation. It does not execute application operations. The desktop is the final authorization boundary. Downloader and uploader use the same protocol, but distinct installation identities and tool catalogs.

## Transport and identity

The production base URL is `https://downloader.24-music.de/mcp-relay`. All paths below are relative to that base. HTTPS is mandatory outside explicitly enabled loopback tests. Clients must disable redirects for authenticated requests. Desktop requests must use the application's configured proxy transport and fail closed when proxy-only is blocked. No incoming desktop listener is required.

Each enrollment uses a fresh UUID `installationId`, `kind` (`downloader` or `uploader`), display `name` (1–100 characters), and two independent random 32-byte base64url secrets: `agentToken` and `clientToken`. The desktop stores these encrypted, outside normal settings/backups. The relay persists only SHA-256 token hashes and non-secret installation metadata. Enrollment is rate-limited and globally bounded; existing identities cannot be overwritten. Registration alone grants no access to another installation.

`POST /v1/installations` registers `{installationId, kind, name, agentToken, clientToken}` and returns `{installationId}` with status 201. Registration conflicts return 409 without consuming the new-installation quota. This endpoint must not log request bodies. Revoked IDs cannot be reused; their tombstones are retained for controlled administrative cleanup.

`DELETE /v1/agent/:installationId` with the agent bearer token revokes both credentials, active sessions and pending calls. The desktop then deletes its credentials. Rotation revokes the old installation and enrolls a fresh identity; old codes never become valid again. Disabling must immediately stop local execution even if the server is unreachable; revocation is retried on later contact. Secrets must never enter support bundles, application logs, normal settings or online backups.

## Desktop long polling

`GET /v1/agent/:installationId/poll` with the agent bearer token holds for at most 20 seconds and returns `{commands, cancellations, closedSessions}`. Each command is `{requestId, sessionId, deadline, principal, message}`. `principal` is `{id: installationId + ":client", installationId, role: "client"}`, constructed only by the relay after client authentication. It is never copied from JSON-RPC. Version 1 has one client credential per installation; local scopes are never accepted from the client or the relay. Rotation creates a fresh installation identity. `message` is one MCP JSON-RPC object. Commands are delivered once, never automatically replayed after an uncertain disconnect. The desktop rejects expired commands and maintains bounded active work and duplicate-request protection. Polling continues concurrently with operations. A desktop is online while its latest authenticated poll is recent; merely enrolling is not online.

`POST /v1/agent/:installationId/results` with the agent bearer token accepts `{requestId, response}`. `response` is a JSON-RPC response object, or `null` for a notification. The relay only accepts results for requests belonging to that installation; expired/cancelled/duplicate results return 409. A disconnected client cancels outstanding work. Cancellation is delivered through the next poll; desktop operations receive an AbortSignal and must not begin a mutation after cancellation. Cancellation cannot undo an operation already committed.

## MCP client

The Streamable HTTP MCP URL is `/mcp/:installationId`. Authentication is `Authorization: Bearer <clientToken>`. `POST` accepts one JSON-RPC message (no batches). JSON responses are returned directly. Notifications return 202. `initialize` creates a random `Mcp-Session-Id`; subsequent requests must supply this header. Sessions are bound to the authenticated installation, bounded and expire when idle. `DELETE` closes only that MCP session. `GET` returns 405: this transport uses JSON responses, not an unsolicited event stream. No credential is accepted in a URL or query string.

The desktop implements MCP initialization, ping, tools/list, tools/call, resources/list, resources/read, prompts/list and prompts/get. Tool catalogs use JSON Schema and MCP annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). Tools are explicit application operations, never arbitrary shell, JavaScript, IPC method names or filesystem paths without validated roots.

## Authorization and confirmation

Local capabilities: `read` (safe state/diagnostics), `control` (ordinary application changes), `files` (bounded configured roots), `secrets` (explicit reveal only; off by default). Read/control/files are enabled only after the user activates MCP; a read-only option is supported. Additional roots and secret access are granted only locally, never by an MCP tool. The relay cannot enlarge these permissions.

Every tool revalidates input, local capabilities and cancellation immediately before executing. Destructive tools require a real local confirmation dialog identifying the exact tool and arguments, defaulting to cancel with an expiry. A model-returned boolean or a second tool call cannot grant approval. Approvals cannot be reused for another action. File deletion, account removal, queue/history clearing, resetting downloaded data, restoring backups, restarting/quitting/updating the app are destructive. Dangerous settings changes that can trigger cleanup or change filesystem roots also require confirmation.

Normal output is redacted even when secret access is enabled. Only an explicit secret-reveal tool may return a requested secret. Audit records store time, installation, request ID, tool name, outcome and duration, not arguments or result content. Logs/resources/support exports remain redacted. Lists are paginated, limits are enforced and long operations expose bounded status/progress/cancellation rather than blocking indefinitely.

## Resource limits and errors

Request bodies are limited to 1 MiB; responses to 8 MiB. Poll responses batch commands within approximately 1.5 MB so a bounded desktop reader can receive simultaneous large requests. Maximum 32 active requests and 16 MCP sessions per installation. Tool call timeout is at most 120 seconds; polling timeout is 20 seconds. Unauthorized requests return 401, offline installations 503, invalid input 400, conflicts 409, limits 429, expired calls 504. JSON-RPC error messages and logs must not contain credentials or raw request bodies. Successful execution is not inferred from HTTP 200: callers must inspect JSON-RPC/tool errors.

## Connection code

`media-mcp:v1:` followed by base64url UTF-8 JSON `{v:1,url,installationId,kind,name,token}`. `url` is the full HTTPS MCP endpoint. The code is a credential, not encryption. It is displayed/copied only by an explicit local action. A local setup helper must validate its URL, refuse redirects and keep the token out of command-line arguments and console output. Initial Codex MCP configuration is required; a connection code alone does not dynamically register tools in a running chat.

## Verification

Each implementation must verify its tool catalog against every exposed action, positive and negative input cases, permissions, confirmation denial and expiry, simultaneous changes, cancellation, response redaction, bounded pagination, stale/disconnected sessions and restart. Transport tests must cover two independent installations, wrong credential roles, cross-installation session/result injection, revocation/rotation, no mutation replay, request limits and proxy-only failure. Test with an official MCP client as well as HTTP-level negative cases. Existing transfer/extraction behavior and legacy support exports must retain their regression coverage. Legacy remote control is removed only after its supported functions have an explicit tested replacement or documented local-only boundary.
