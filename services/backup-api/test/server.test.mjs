import assert from 'node:assert/strict'
import { createHash, randomBytes } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises'
import { request as createHttpRequest } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import lockfile from 'proper-lockfile'
import { createBackupServer } from '../src/server.mjs'

const allowedOrigin = 'https://downloads.24-music.de'

function backupFixture() {
  const deleteSecret = randomBytes(32).toString('base64url')
  return {
    deleteSecret,
    payload: {
      id: randomBytes(16).toString('base64url'),
      blob: randomBytes(96).toString('base64url'),
      deleteVerifier: createHash('sha256').update(Buffer.from(deleteSecret, 'base64url')).digest('base64url')
    }
  }
}

async function startApi(options = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), 'mdd-backup-api-'))
  const server = createBackupServer({
    rootDir,
    allowedOrigins: [allowedOrigin],
    rateLimit: { max: 100, windowMs: 60_000 },
    ...options
  })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  return {
    rootDir,
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    async close() {
      await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
      await rm(rootDir, { recursive: true, force: true })
    }
  }
}

async function request(api, path, options = {}) {
  return fetch(`${api.baseUrl}${path}`, options)
}

test('health endpoint reports readiness without exposing storage details', async t => {
  const api = await startApi()
  t.after(() => api.close())

  const response = await request(api, '/health')

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), { status: 'ok' })
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('health endpoint rejects an unusable storage path', async t => {
  const container = await mkdtemp(join(tmpdir(), 'mdd-backup-health-'))
  const rootDir = join(container, 'not-a-directory')
  await writeFile(rootDir, 'occupied')
  const server = createBackupServer({ rootDir, allowedOrigins: [allowedOrigin] })
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const baseUrl = `http://127.0.0.1:${server.address().port}`
  t.after(async () => {
    await new Promise(resolve => server.close(resolve))
    await rm(container, { recursive: true, force: true })
  })

  const response = await fetch(`${baseUrl}/health`)

  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { status: 'unavailable' })
})

test('creates and retrieves an immutable opaque backup across server restarts', async t => {
  const api = await startApi()
  const fixture = backupFixture()
  t.after(async () => {
    if (api.server.listening) await new Promise(resolve => api.server.close(resolve))
    await rm(api.rootDir, { recursive: true, force: true })
  })

  const created = await request(api, '/v1/backups', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: allowedOrigin },
    body: JSON.stringify(fixture.payload)
  })

  assert.equal(created.status, 201)
  assert.deepEqual(await created.json(), { created: true })
  await new Promise(resolve => api.server.close(resolve))

  api.server = createBackupServer({ rootDir: api.rootDir, allowedOrigins: [allowedOrigin] })
  await new Promise((resolve, reject) => {
    api.server.once('error', reject)
    api.server.listen(0, '127.0.0.1', resolve)
  })
  api.baseUrl = `http://127.0.0.1:${api.server.address().port}`

  const retrieved = await request(api, '/v1/backups/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: allowedOrigin },
    body: JSON.stringify({ id: fixture.payload.id })
  })
  assert.equal(retrieved.status, 200)
  assert.deepEqual(await retrieved.json(), { blob: fixture.payload.blob })

  const duplicate = await request(api, '/v1/backups', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: allowedOrigin },
    body: JSON.stringify({ ...fixture.payload, blob: randomBytes(96).toString('base64url') })
  })
  assert.equal(duplicate.status, 409)

  const unchanged = await request(api, '/v1/backups/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: fixture.payload.id })
  })
  assert.deepEqual(await unchanged.json(), { blob: fixture.payload.blob })
})

test('validates IDs, verifiers, content type, JSON and opaque blob encoding', async t => {
  const api = await startApi()
  t.after(() => api.close())
  const fixture = backupFixture()
  const invalidPayloads = [
    { ...fixture.payload, id: 'short' },
    { ...fixture.payload, blob: 'not+base64url' },
    { ...fixture.payload, deleteVerifier: 'short' },
    { id: fixture.payload.id, blob: fixture.payload.blob },
    { ...fixture.payload, extra: true }
  ]

  for (const payload of invalidPayloads) {
    const response = await request(api, '/v1/backups', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload)
    })
    assert.equal(response.status, 400)
  }

  const malformed = await request(api, '/v1/backups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{'
  })
  assert.equal(malformed.status, 400)

  const wrongType = await request(api, '/v1/backups', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify(fixture.payload)
  })
  assert.equal(wrongType.status, 415)
})

test('accepts a 256 KiB decoded blob and rejects one byte more', async t => {
  const api = await startApi()
  t.after(() => api.close())
  const fixture = backupFixture()

  const accepted = await request(api, '/v1/backups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...fixture.payload, blob: randomBytes(262_144).toString('base64url') })
  })
  const oversizedFixture = backupFixture()
  const rejected = await request(api, '/v1/backups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ...oversizedFixture.payload, blob: randomBytes(262_145).toString('base64url') })
  })

  assert.equal(accepted.status, 201)
  assert.equal(rejected.status, 413)
})

test('responds before an oversized request body finishes streaming', async t => {
  const api = await startApi()
  t.after(() => api.close())
  const url = new URL('/v1/backups', api.baseUrl)
  const client = createHttpRequest(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' }
  })
  t.after(() => client.destroy())

  const responsePromise = new Promise((resolve, reject) => {
    client.once('response', resolve)
    client.once('error', reject)
  })
  client.write('A'.repeat(393_217))
  const response = await Promise.race([
    responsePromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Server did not reject streaming body')), 1_000))
  ])

  assert.equal(response.statusCode, 413)
  response.resume()
})

test('deletes only with the matching client secret and uses constant not-found responses', async t => {
  const api = await startApi()
  t.after(() => api.close())
  const fixture = backupFixture()
  await request(api, '/v1/backups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fixture.payload)
  })

  const missing = await request(api, '/v1/backups/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: randomBytes(16).toString('base64url') })
  })
  const unauthorized = await request(api, '/v1/backups/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: fixture.payload.id })
  })
  const wrongSecret = await request(api, '/v1/backups/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: fixture.payload.id, deleteSecret: randomBytes(32).toString('base64url') })
  })

  assert.equal(missing.status, 404)
  assert.equal(unauthorized.status, 404)
  assert.equal(wrongSecret.status, 404)
  const missingBody = await missing.text()
  const unauthorizedBody = await unauthorized.text()
  const wrongSecretBody = await wrongSecret.text()
  assert.equal(missingBody, unauthorizedBody)
  assert.equal(unauthorizedBody, wrongSecretBody)
  assert.equal(wrongSecretBody, '{"error":"not_found"}')

  const deleted = await request(api, '/v1/backups/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: fixture.payload.id, deleteSecret: fixture.deleteSecret })
  })
  assert.equal(deleted.status, 204)
  assert.equal((await readdir(api.rootDir)).length, 0)

  const afterDelete = await request(api, '/v1/backups/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: fixture.payload.id })
  })
  assert.equal(afterDelete.status, 404)
})

test('allows only configured browser origins and supports preflight', async t => {
  const api = await startApi()
  t.after(() => api.close())

  const allowed = await request(api, '/health', { headers: { origin: allowedOrigin } })
  assert.equal(allowed.headers.get('access-control-allow-origin'), allowedOrigin)
  assert.equal(allowed.headers.get('vary'), 'Origin')

  const denied = await request(api, '/health', { headers: { origin: 'https://attacker.example' } })
  assert.equal(denied.status, 403)
  assert.equal(denied.headers.get('access-control-allow-origin'), null)

  const preflight = await request(api, '/v1/backups', {
    method: 'OPTIONS',
    headers: {
      origin: allowedOrigin,
      'access-control-request-method': 'POST',
      'access-control-request-headers': 'content-type'
    }
  })
  assert.equal(preflight.status, 204)
  assert.equal(preflight.headers.get('access-control-allow-origin'), allowedOrigin)
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/)
})

test('rate limits backup routes without limiting health checks', async t => {
  const api = await startApi({ trustedProxy: true, rateLimit: { max: 2, windowMs: 60_000 } })
  t.after(() => api.close())

  const restore = (id, address) => request(api, '/v1/backups/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': address },
    body: JSON.stringify({ id })
  })
  const first = await restore(randomBytes(16).toString('base64url'), '198.51.100.1')
  const independent = await restore(randomBytes(16).toString('base64url'), '198.51.100.2')
  const second = await restore(randomBytes(16).toString('base64url'), '198.51.100.1')
  const limited = await restore(randomBytes(16).toString('base64url'), '198.51.100.1')
  const health = await request(api, '/health')

  assert.equal(first.status, 404)
  assert.equal(independent.status, 404)
  assert.equal(second.status, 404)
  assert.equal(limited.status, 429)
  assert.equal(limited.headers.get('retry-after'), '60')
  assert.equal(health.status, 200)
})

test('enforces an atomic global storage capacity without blocking existing restores', async t => {
  const api = await startApi({ maxStorageBytes: 420 })
  const secondServer = createBackupServer({ rootDir: api.rootDir, allowedOrigins: [allowedOrigin], maxStorageBytes: 420 })
  await new Promise((resolve, reject) => {
    secondServer.once('error', reject)
    secondServer.listen(0, '127.0.0.1', resolve)
  })
  const secondBaseUrl = `http://127.0.0.1:${secondServer.address().port}`
  t.after(() => api.close())
  t.after(() => new Promise(resolve => secondServer.close(resolve)))
  const first = backupFixture()
  const second = backupFixture()
  const create = (fixture, baseUrl = api.baseUrl) => fetch(`${baseUrl}/v1/backups`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fixture.payload)
  })

  const results = await Promise.all([create(first), create(second, secondBaseUrl)])

  assert.deepEqual(results.map(response => response.status).sort(), [201, 507])
  const stored = results[0].status === 201 ? first : second
  const restored = await request(api, '/v1/backups/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: stored.payload.id })
  })
  assert.equal(restored.status, 200)
  const storedFiles = await readdir(api.rootDir)
  assert.equal(storedFiles.length, 1)
  assert.match(storedFiles[0], /^[A-Za-z0-9_-]{22}\.json$/)

  const deleted = await request(api, '/v1/backups/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: stored.payload.id, deleteSecret: stored.deleteSecret })
  })
  assert.equal(deleted.status, 204)
  const blocked = stored === first ? second : first
  assert.equal((await create(blocked)).status, 201)
})

test('limits anonymous uploads separately while keeping restores available', async t => {
  const api = await startApi({
    rateLimit: { max: 2, windowMs: 60_000 },
    uploadRateLimit: { max: 1, windowMs: 60_000 }
  })
  t.after(() => api.close())
  const first = backupFixture()
  const second = backupFixture()
  const create = fixture => request(api, '/v1/backups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fixture.payload)
  })

  assert.equal((await create(first)).status, 201)
  assert.equal((await create(second)).status, 429)
  const restored = await request(api, '/v1/backups/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: first.payload.id })
  })
  assert.equal(restored.status, 200)
})

test('never takes over an old storage lock that may still have an active owner', async t => {
  const api = await startApi()
  t.after(() => api.close())
  const lockPath = join(api.rootDir, '.storage.lock')
  const release = await lockfile.lock(api.rootDir, {
    realpath: false,
    lockfilePath: lockPath,
    stale: 30_000,
    update: 10_000
  })
  t.after(() => release().catch(() => {}))
  const fixture = backupFixture()
  const pending = request(api, '/v1/backups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fixture.payload)
  })

  const early = await Promise.race([
    pending.then(() => 'responded'),
    new Promise(resolve => setTimeout(() => resolve('waiting'), 100))
  ])

  assert.equal(early, 'waiting')
  await release()
  assert.equal((await pending).status, 201)
})

test('recovers a storage lock left by a terminated process', async t => {
  const api = await startApi()
  t.after(() => api.close())
  const lockPath = join(api.rootDir, '.storage.lock')
  await mkdir(lockPath)
  const old = new Date(Date.now() - 60_000)
  await utimes(lockPath, old, old)
  const fixture = backupFixture()
  const pending = request(api, '/v1/backups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fixture.payload)
  })

  const early = await Promise.race([
    pending.then(response => response.status),
    new Promise(resolve => setTimeout(() => resolve('timeout'), 500))
  ])
  await pending

  assert.equal(early, 201)
  assert.equal((await readdir(api.rootDir)).some(name => name.includes('.stale.')), false)
})

test('revalidates delete authorization inside the storage lock', async t => {
  const api = await startApi()
  t.after(() => api.close())
  const original = backupFixture()
  const replacement = backupFixture()
  replacement.payload.id = original.payload.id
  await request(api, '/v1/backups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(original.payload)
  })
  const lockPath = join(api.rootDir, '.storage.lock')
  const release = await lockfile.lock(api.rootDir, {
    realpath: false,
    lockfilePath: lockPath,
    stale: 30_000,
    update: 10_000
  })
  t.after(() => release().catch(() => {}))
  const pendingDelete = request(api, '/v1/backups/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: original.payload.id, deleteSecret: original.deleteSecret })
  })
  await new Promise(resolve => setTimeout(resolve, 50))
  await writeFile(join(api.rootDir, `${original.payload.id}.json`), JSON.stringify({
    version: 1,
    blob: replacement.payload.blob,
    deleteVerifier: replacement.payload.deleteVerifier,
    createdAt: new Date().toISOString()
  }))
  await release()

  assert.equal((await pendingDelete).status, 404)
  const restored = await request(api, '/v1/backups/restore', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ id: original.payload.id })
  })
  assert.equal(restored.status, 200)
  assert.deepEqual(await restored.json(), { blob: replacement.payload.blob })
})

test('never accepts backup IDs in URLs', async t => {
  const api = await startApi()
  t.after(() => api.close())
  const id = randomBytes(16).toString('base64url')

  const read = await request(api, `/v1/backups/${id}`)
  const remove = await request(api, `/v1/backups/${id}`, { method: 'DELETE' })
  const query = await request(api, `/v1/backups?backup=${id}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(backupFixture().payload)
  })

  assert.equal(read.status, 404)
  assert.equal(remove.status, 404)
  assert.equal(query.status, 404)
})

test('stored records contain no delete secret and operational logs contain no IDs or blobs', async t => {
  const messages = []
  const api = await startApi({ logger: message => messages.push(String(message)) })
  t.after(() => api.close())
  const fixture = backupFixture()

  await request(api, '/v1/backups', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(fixture.payload)
  })

  const files = await readdir(api.rootDir)
  assert.equal(files.length, 1)
  const stored = await readFile(join(api.rootDir, files[0]), 'utf8')
  assert.equal(stored.includes(fixture.deleteSecret), false)
  assert.equal(messages.some(message => message.includes(fixture.payload.id)), false)
  assert.equal(messages.some(message => message.includes(fixture.payload.blob)), false)
})
