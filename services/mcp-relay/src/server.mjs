import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
const PROTOCOLS = new Set(['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05']);
const digest = (value) => crypto.createHash('sha256').update(value).digest('hex');
const fault = (status, code) => Object.assign(new Error(code), { status });
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

async function readJson(req, limit = 1_048_576) {
  if (!String(req.headers['content-type'] || '').toLowerCase().startsWith('application/json')) throw fault(415, 'json_required');
  if (Number(req.headers['content-length']) > limit) throw fault(413, 'request_too_large');
  const chunks = [];
  let length = 0;
  for await (const chunk of req) {
    length += chunk.length;
    if (length > limit) throw fault(413, 'request_too_large');
    chunks.push(chunk);
  }
  try {
    const result = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!result || typeof result !== 'object' || Array.isArray(result)) throw new Error();
    return result;
  } catch { throw fault(400, 'invalid_json'); }
}

function json(res, status, value, headers = {}) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', ...headers });
  res.end(value === undefined ? undefined : JSON.stringify(value));
}

export async function createRelay(options) {
  const dataDir = path.resolve(options.dataDir);
  const prefix = options.prefix || '';
  const pollMs = options.pollMs ?? 20_000;
  const callMs = options.callMs ?? 120_000;
  const onlineMs = options.onlineMs ?? 45_000;
  const sessionMs = options.sessionMs ?? 600_000;
  const installations = new Map();
  const states = new Map();
  const rates = new Map();
  let persistence = Promise.resolve();
  let closing = false;
  await fs.mkdir(dataDir, { recursive: true, mode: 0o700 });
  for (const name of await fs.readdir(dataDir)) {
    if (!name.endsWith('.json') || !ID.test(name.slice(0, -5))) continue;
    const record = JSON.parse(await fs.readFile(path.join(dataDir, name), 'utf8'));
    if (record.id !== name.slice(0, -5) || !/^[a-f0-9]{64}$/.test(record.agentHash) || !/^[a-f0-9]{64}$/.test(record.clientHash)) throw new Error('invalid_registry_record');
    installations.set(record.id, record);
  }
  function serialize(operation) {
    const result = persistence.then(operation);
    persistence = result.catch(() => {});
    return result;
  }
  async function persist(record, create = false) {
    const target = path.join(dataDir, `${record.id}.json`);
    const temporary = `${target}.${crypto.randomUUID()}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
    try {
      if (create) {
        await fs.link(temporary, target);
        await fs.unlink(temporary);
      } else await fs.rename(temporary, target);
    } catch (error) {
      await fs.unlink(temporary).catch(() => {});
      throw error;
    }
  }
  function state(id) {
    if (!states.has(id)) states.set(id, { lastSeen: 0, sessions: new Map(), jobs: new Map(), cancellations: new Set(), closedSessions: new Set(), poll: null });
    return states.get(id);
  }
  function authenticate(req, id, role) {
    const bearer = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(String(req.headers.authorization || ''))?.[1];
    const record = installations.get(id);
    const hash = digest(bearer || 'invalid');
    if (!record || record.revokedAt || !same(record[`${role}Hash`], hash)) throw fault(401, 'unauthorized');
    return record;
  }
  function limit(req, category, max, windowMs) {
    const peer = req.socket.remoteAddress || '';
    const forwarded = options.trustLoopbackProxy && ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(peer) ? req.headers['x-real-ip'] : null;
    const key = `${category}:${typeof forwarded === 'string' ? forwarded : peer}`;
    const now = Date.now();
    let entry = rates.get(key);
    if (!entry && rates.size >= 10_000) {
      for (const [k, v] of rates) if (v.until <= now) rates.delete(k);
      if (rates.size >= 10_000) throw fault(429, 'rate_limited');
    }
    if (!entry || entry.until <= now) rates.set(key, entry = { until: now + windowMs, count: 0 });
    if (++entry.count > max) throw fault(429, 'rate_limited');
    if (rates.size > 10_000) for (const [k, v] of rates) if (v.until <= now) rates.delete(k);
  }
  function deliver(s) {
    if (!s.poll) return;
    const commands = [];
    let bytes = 0;
    for (const job of s.jobs.values()) {
      if (job.delivered) continue;
      const size = Buffer.byteLength(JSON.stringify(job.command));
      if (commands.length && bytes + size > 1_500_000) break;
      bytes += size;
      job.delivered = true;
      commands.push(job.command);
    }
    if (!commands.length && !s.cancellations.size && !s.closedSessions.size) return;
    const poll = s.poll;
    s.poll = null;
    clearTimeout(poll.timer);
    const payload = { commands, cancellations: [...s.cancellations], closedSessions: [...s.closedSessions] };
    s.cancellations.clear();
    s.closedSessions.clear();
    json(poll.res, 200, payload);
  }
  function cancel(s, requestId, status = 499, code = 'client_disconnected') {
    const job = s.jobs.get(requestId);
    if (!job) return;
    clearTimeout(job.timer);
    s.jobs.delete(requestId);
    if (job.delivered) s.cancellations.add(requestId);
    json(job.res, status, { error: code });
    deliver(s);
  }
  function closeSession(s, sessionId) {
    s.sessions.delete(sessionId);
    s.closedSessions.add(sessionId);
    for (const [id, job] of s.jobs) if (job.command.sessionId === sessionId) cancel(s, id, 409, 'session_closed');
    deliver(s);
  }
  async function handle(req, res) {
    if (closing) throw fault(503, 'shutting_down');
    if (req.headers.origin) throw fault(403, 'browser_origin_not_allowed');
    const url = new URL(req.url || '/', 'http://relay.local');
    if (url.search) throw fault(400, 'query_not_supported');
    if (prefix && !url.pathname.startsWith(`${prefix}/`)) throw fault(404, 'not_found');
    const route = prefix ? url.pathname.slice(prefix.length) : url.pathname;
    if (req.method === 'GET' && route === '/health') return json(res, 200, { ok: true, protocol: 1 });
    limit(req, 'requests', 600, 60_000);
    if (req.method === 'POST' && route === '/v1/installations') {
      const input = await readJson(req, 2048);
      if (!ID.test(input.installationId) || !['downloader', 'uploader'].includes(input.kind) || typeof input.name !== 'string' || !input.name.trim() || input.name.length > 100 || !TOKEN.test(input.agentToken) || !TOKEN.test(input.clientToken) || input.agentToken === input.clientToken) throw fault(400, 'invalid_enrollment');
      if (installations.has(input.installationId)) throw fault(409, 'installation_exists');
      limit(req, 'enroll', options.enrollPerHour ?? 5, 3_600_000);
      const record = { id: input.installationId, kind: input.kind, name: input.name.trim(), agentHash: digest(input.agentToken), clientHash: digest(input.clientToken), createdAt: new Date().toISOString() };
      await serialize(async () => {
        if (installations.has(record.id)) throw fault(409, 'installation_exists');
        if ([...installations.values()].filter(entry => !entry.revokedAt).length >= (options.maxInstallations ?? 256) || installations.size >= 4096) throw fault(429, 'installation_limit');
        await persist(record, true);
        installations.set(record.id, record);
      });
      return json(res, 201, { installationId: record.id });
    }
    const agent = /^\/v1\/agent\/([0-9a-f-]+)(?:\/(poll|results))?$/.exec(route);
    if (agent && ID.test(agent[1])) {
      const id = agent[1];
      const record = authenticate(req, id, 'agent');
      const s = state(id);
      if (!agent[2] && req.method === 'DELETE') {
        await serialize(async () => {
          const revoked = { ...record, revokedAt: new Date().toISOString() };
          await persist(revoked);
          installations.set(id, revoked);
        });
        for (const sessionId of [...s.sessions.keys()]) closeSession(s, sessionId);
        if (s.poll) {
          clearTimeout(s.poll.timer);
          json(s.poll.res, 401, { error: 'revoked' });
          s.poll = null;
        }
        return json(res, 200, { revoked: true });
      }
      if (agent[2] === 'poll' && req.method === 'GET') {
        if (s.poll) throw fault(409, 'poll_already_active');
        s.lastSeen = Date.now();
        const poll = { res, timer: null };
        poll.timer = setTimeout(() => {
          if (s.poll === poll) {
            s.poll = null;
            json(res, 200, { commands: [], cancellations: [], closedSessions: [] });
          }
        }, pollMs);
        s.poll = poll;
        res.on('close', () => {
          if (s.poll === poll) s.poll = null;
          clearTimeout(poll.timer);
        });
        return deliver(s);
      }
      if (agent[2] === 'results' && req.method === 'POST') {
        const input = await readJson(req, 8_388_608);
        const job = s.jobs.get(input.requestId);
        if (!job || !job.delivered) throw fault(409, 'request_not_pending');
        const response = input.response;
        if (job.hasId && (!response || response.jsonrpc !== '2.0' || response.id !== job.command.message.id || (!Object.hasOwn(response, 'result') && !Object.hasOwn(response, 'error')))) throw fault(400, 'invalid_rpc_response');
        if (!job.hasId && response !== null) throw fault(400, 'notification_response_must_be_null');
        s.jobs.delete(input.requestId);
        clearTimeout(job.timer);
        json(job.res, job.hasId ? 200 : 202, job.hasId ? response : undefined, job.headers);
        return json(res, 200, { accepted: true });
      }
      throw fault(405, 'method_not_allowed');
    }
    const mcp = /^\/mcp\/([0-9a-f-]+)$/.exec(route);
    if (mcp && ID.test(mcp[1])) {
      const id = mcp[1];
      authenticate(req, id, 'client');
      if (req.headers['mcp-protocol-version'] && !PROTOCOLS.has(String(req.headers['mcp-protocol-version']))) throw fault(400, 'unsupported_protocol_version');
      const s = state(id);
      if (req.method === 'GET') return json(res, 405, { error: 'json_transport_only' }, { Allow: 'POST, DELETE' });
      const sessionHeader = req.headers['mcp-session-id'];
      if (req.method === 'DELETE') {
        if (typeof sessionHeader !== 'string' || !s.sessions.has(sessionHeader)) throw fault(404, 'session_not_found');
        closeSession(s, sessionHeader);
        return json(res, 200, { closed: true });
      }
      if (req.method !== 'POST') throw fault(405, 'method_not_allowed');
      if (s.lastSeen < Date.now() - onlineMs) throw fault(503, 'installation_offline');
      const message = await readJson(req);
      if (message.jsonrpc !== '2.0' || typeof message.method !== 'string' || (Object.hasOwn(message, 'id') && !(typeof message.id === 'string' || (typeof message.id === 'number' && Number.isSafeInteger(message.id))))) throw fault(400, 'invalid_rpc_message');
      let sessionId = sessionHeader;
      const headers = {};
      if (message.method === 'initialize') {
        if (sessionHeader) throw fault(400, 'session_already_initialized');
        if (s.sessions.size >= 16) throw fault(429, 'session_limit');
        sessionId = crypto.randomUUID();
        s.sessions.set(sessionId, Date.now());
        headers['Mcp-Session-Id'] = sessionId;
      } else {
        if (typeof sessionId !== 'string') throw fault(400, 'session_required');
        if (!s.sessions.has(sessionId)) throw fault(404, 'session_not_found');
        s.sessions.set(sessionId, Date.now());
      }
      if (s.jobs.size >= 32) throw fault(429, 'request_limit');
      const requestId = crypto.randomUUID();
      const command = { requestId, sessionId, deadline: Date.now() + callMs, principal: { id: `${id}:client`, installationId: id, role: 'client' }, message };
      const job = { command, res, headers, hasId: Object.hasOwn(message, 'id'), delivered: false, timer: null };
      job.timer = setTimeout(() => cancel(s, requestId, 504, 'request_timeout'), callMs);
      s.jobs.set(requestId, job);
      res.on('close', () => { if (!res.writableEnded) cancel(s, requestId); });
      return deliver(s);
    }
    throw fault(404, 'not_found');
  }
  const server = http.createServer((req, res) => {
    handle(req, res).catch(error => {
      const status = Number.isInteger(error.status) ? error.status : 500;
      json(res, status, { error: status === 500 ? 'internal_error' : error.message });
    });
  });
  server.requestTimeout = 135_000;
  server.headersTimeout = 15_000;
  server.maxHeadersCount = 40;
  const sweep = setInterval(() => {
    for (const s of states.values()) for (const [id, touched] of s.sessions) if (touched < Date.now() - sessionMs) closeSession(s, id);
    for (const [id, s] of states) if (!s.jobs.size && !s.poll && !s.sessions.size && s.lastSeen < Date.now() - sessionMs) states.delete(id);
  }, 30_000);
  sweep.unref();
  return {
    server,
    async close() {
      closing = true;
      clearInterval(sweep);
      for (const s of states.values()) {
        for (const id of [...s.jobs.keys()]) cancel(s, id, 503, 'shutting_down');
        if (s.poll) { clearTimeout(s.poll.timer); json(s.poll.res, 503, { error: 'shutting_down' }); s.poll = null; }
      }
      await persistence;
      await new Promise(resolve => server.close(resolve));
    }
  };
}

const entryPath = process.argv[1] ? await fs.realpath(process.argv[1]).catch(() => process.argv[1]) : null;
if (entryPath && import.meta.url === pathToFileURL(entryPath).href) {
  const relay = await createRelay({ dataDir: process.env.MCP_DATA_DIR || './data', prefix: process.env.MCP_PREFIX || '', trustLoopbackProxy: process.env.MCP_TRUST_LOOPBACK_PROXY === '1' });
  relay.server.listen(Number(process.env.PORT || 9872), process.env.HOST || '127.0.0.1', () => console.log('MCP relay listening'));
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => { void relay.close().then(() => process.exit(0)); });
}
