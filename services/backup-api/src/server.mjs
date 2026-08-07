import { createHash, timingSafeEqual, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import { link, mkdir, open, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { isIP } from 'node:net'
import { join } from 'node:path'
import lockfile from 'proper-lockfile'

const maxBlobBytes = 256 * 1024
const maxBodyBytes = 384 * 1024
const idPattern = /^[A-Za-z0-9_-]{22}$/
const verifierPattern = /^[A-Za-z0-9_-]{43}$/
const blobPattern = /^[A-Za-z0-9_-]+$/
const notFoundBody = '{"error":"not_found"}'

function isCanonicalBase64Url(value, byteLength, pattern) {
  if (typeof value !== 'string' || !pattern.test(value)) return false
  const decoded = Buffer.from(value, 'base64url')
  return decoded.length === byteLength && decoded.toString('base64url') === value
}

function isValidBackup(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false
  const keys = Object.keys(payload).sort()
  if (keys.join(',') !== 'blob,deleteVerifier,id') return false
  if (!isCanonicalBase64Url(payload.id, 16, idPattern)) return false
  if (!isCanonicalBase64Url(payload.deleteVerifier, 32, verifierPattern)) return false
  if (typeof payload.blob !== 'string' || !blobPattern.test(payload.blob)) return false
  const decoded = Buffer.from(payload.blob, 'base64url')
  return decoded.length <= maxBlobBytes && decoded.toString('base64url') === payload.blob
}

function createRateLimiter({ max, windowMs }) {
  const clients = new Map()
  let requestCount = 0
  return address => {
    const now = Date.now()
    requestCount += 1
    if (requestCount % 1024 === 0) {
      for (const [key, value] of clients) {
        if (now - value.startedAt >= windowMs) clients.delete(key)
      }
    }
    const current = clients.get(address)
    if (!current || now - current.startedAt >= windowMs) {
      clients.set(address, { startedAt: now, count: 1 })
      return null
    }
    if (current.count >= max) return Math.max(1, Math.ceil((windowMs - (now - current.startedAt)) / 1000))
    current.count += 1
    return null
  }
}

function readJsonBody(request) {
  const declaredLength = Number.parseInt(request.headers['content-length'] ?? '', 10)
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    request.resume()
    return Promise.resolve({ error: 413 })
  }
  return new Promise((resolve, reject) => {
    let size = 0
    let settled = false
    const chunks = []
    const cleanup = () => {
      request.off('data', onData)
      request.off('end', onEnd)
      request.off('aborted', onAborted)
      request.off('error', onError)
    }
    const finish = result => {
      if (settled) return
      settled = true
      cleanup()
      resolve(result)
    }
    const onData = chunk => {
      size += chunk.length
      if (size > maxBodyBytes) {
        finish({ error: 413 })
        request.resume()
        return
      }
      chunks.push(chunk)
    }
    const onEnd = () => {
      try {
        finish({ value: JSON.parse(Buffer.concat(chunks).toString('utf8')) })
      } catch {
        finish({ error: 400 })
      }
    }
    const onAborted = () => reject(new Error('Request aborted'))
    const onError = error => reject(error)
    request.on('data', onData)
    request.on('end', onEnd)
    request.on('aborted', onAborted)
    request.on('error', onError)
  })
}

function recordPath(rootDir, id) {
  return join(rootDir, `${id}.json`)
}

function createMutationQueue() {
  let pending = Promise.resolve()
  return operation => {
    const result = pending.then(operation, operation)
    pending = result.catch(() => {})
    return result
  }
}

async function directoryUsage(rootDir) {
  let total = 0
  const entries = await readdir(rootDir, { withFileTypes: true })
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue
    try {
      total += (await stat(join(rootDir, entry.name))).size
    } catch (error) {
      if (error.code !== 'ENOENT') throw error
    }
  }
  return total
}

async function syncDirectory(rootDir) {
  let handle
  try {
    handle = await open(rootDir, 'r')
    await handle.sync()
  } catch (error) {
    if (!['EISDIR', 'EINVAL', 'ENOTSUP', 'EPERM', 'EBADF'].includes(error.code)) throw error
  } finally {
    await handle?.close().catch(() => {})
  }
}

async function withStorageLock(rootDir, operation) {
  await mkdir(rootDir, { recursive: true })
  const release = await lockfile.lock(rootDir, {
    realpath: false,
    lockfilePath: join(rootDir, '.storage.lock'),
    stale: 30_000,
    update: 10_000,
    retries: {
      retries: 100,
      factor: 1.1,
      minTimeout: 10,
      maxTimeout: 100,
      randomize: true
    }
  })
  try {
    return await operation()
  } finally {
    let releaseError
    try {
      await release()
    } catch (error) {
      releaseError = error
    }
    try {
      await syncDirectory(rootDir)
    } catch (error) {
      releaseError ??= error
    }
    if (releaseError) throw releaseError
  }
}

async function recordExists(rootDir, id) {
  try {
    await stat(recordPath(rootDir, id))
    return true
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
}

async function createRecord(rootDir, payload, maxStorageBytes) {
  await mkdir(rootDir, { recursive: true })
  if (await recordExists(rootDir, payload.id)) return 'duplicate'
  const contents = Buffer.from(JSON.stringify({
    version: 1,
    blob: payload.blob,
    deleteVerifier: payload.deleteVerifier,
    createdAt: new Date().toISOString()
  }), 'utf8')
  if (await directoryUsage(rootDir) + contents.length > maxStorageBytes) return 'full'
  const temporaryPath = join(rootDir, `.${randomBytes(16).toString('hex')}.tmp`)
  let handle
  let temporaryCreated = false
  let published = false
  try {
    handle = await open(temporaryPath, 'wx', 0o600)
    temporaryCreated = true
    try {
      await handle.writeFile(contents)
      await handle.sync()
    } finally {
      await handle.close()
      handle = undefined
    }
    try {
      await link(temporaryPath, recordPath(rootDir, payload.id))
    } catch (error) {
      if (error.code === 'EEXIST') return 'duplicate'
      throw error
    }
    published = true
    return 'created'
  } finally {
    let cleanupError
    try {
      await handle?.close()
    } catch (error) {
      cleanupError = error
    }
    if (temporaryCreated) {
      try {
        await unlink(temporaryPath)
      } catch (error) {
        cleanupError ??= error
      }
    }
    if (published) {
      try {
        await syncDirectory(rootDir)
      } catch (error) {
        cleanupError ??= error
      }
    }
    if (cleanupError) throw cleanupError
  }
}

async function readRecord(rootDir, id) {
  try {
    const raw = await readFile(recordPath(rootDir, id), 'utf8')
    const record = JSON.parse(raw)
    if (record?.version !== 1 || typeof record.blob !== 'string' || !isCanonicalBase64Url(record.deleteVerifier, 32, verifierPattern)) {
      throw new Error('Invalid stored record')
    }
    return record
  } catch (error) {
    if (error.code === 'ENOENT') return null
    throw error
  }
}

function securityHeaders(response) {
  response.setHeader('cache-control', 'no-store')
  response.setHeader('x-content-type-options', 'nosniff')
  response.setHeader('content-security-policy', "default-src 'none'")
  response.setHeader('referrer-policy', 'no-referrer')
}

function sendJson(response, status, body) {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(body))
}

function sendNotFound(response) {
  response.statusCode = 404
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(notFoundBody)
}

function authorizeOrigin(request, response, allowedOrigins) {
  const origin = request.headers.origin
  if (!origin) return true
  if (!allowedOrigins.has(origin)) {
    sendJson(response, 403, { error: 'origin_denied' })
    return false
  }
  response.setHeader('access-control-allow-origin', origin)
  response.setHeader('vary', 'Origin')
  return true
}

function verifierMatches(secret, expectedVerifier) {
  const actual = createHash('sha256').update(Buffer.from(secret, 'base64url')).digest()
  const expected = Buffer.from(expectedVerifier, 'base64url')
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

async function storageIsReady(rootDir) {
  const probePath = join(rootDir, `.${randomBytes(16).toString('hex')}.health`)
  try {
    await mkdir(rootDir, { recursive: true })
    const handle = await open(probePath, 'wx', 0o600)
    await handle.close()
    await unlink(probePath)
    return true
  } catch {
    await unlink(probePath).catch(() => {})
    return false
  }
}

function clientAddress(request, trustedProxy) {
  if (trustedProxy) {
    const forwarded = request.headers['x-forwarded-for']
    const candidate = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',', 1)[0].trim()
    if (candidate && isIP(candidate)) return candidate
  }
  return request.socket.remoteAddress ?? 'unknown'
}

export function createBackupServer(options) {
  if (!options?.rootDir) throw new Error('rootDir is required')
  const allowedOrigins = new Set(options.allowedOrigins ?? [])
  const rateLimit = options.rateLimit ?? { max: 60, windowMs: 60_000 }
  const uploadRateLimit = options.uploadRateLimit ?? { max: 10, windowMs: 3_600_000 }
  const maxStorageBytes = options.maxStorageBytes ?? 10 * 1024 * 1024 * 1024
  if (!Number.isSafeInteger(rateLimit.max) || rateLimit.max < 1 || !Number.isSafeInteger(rateLimit.windowMs) || rateLimit.windowMs < 1) {
    throw new Error('Invalid rate limit')
  }
  if (!Number.isSafeInteger(uploadRateLimit.max) || uploadRateLimit.max < 1 || !Number.isSafeInteger(uploadRateLimit.windowMs) || uploadRateLimit.windowMs < 1) {
    throw new Error('Invalid upload rate limit')
  }
  if (!Number.isSafeInteger(maxStorageBytes) || maxStorageBytes < 1) throw new Error('Invalid max storage size')
  const consumeRateLimit = createRateLimiter(rateLimit)
  const consumeUploadRateLimit = createRateLimiter(uploadRateLimit)
  const runStorageMutation = createMutationQueue()

  return createServer(async (request, response) => {
    securityHeaders(response)
    try {
      const url = new URL(request.url, 'http://localhost')
      if (!authorizeOrigin(request, response, allowedOrigins)) return
      if (url.search) {
        sendNotFound(response)
        return
      }

      if (request.method === 'OPTIONS') {
        const requestedMethod = request.headers['access-control-request-method']
        if (!request.headers.origin || requestedMethod !== 'POST') {
          sendJson(response, 400, { error: 'invalid_preflight' })
          return
        }
        response.statusCode = 204
        response.setHeader('access-control-allow-methods', 'POST, OPTIONS')
        response.setHeader('access-control-allow-headers', 'content-type')
        response.setHeader('access-control-max-age', '600')
        response.end()
        return
      }

      if (request.method === 'GET' && url.pathname === '/health') {
        const ready = await storageIsReady(options.rootDir)
        sendJson(response, ready ? 200 : 503, { status: ready ? 'ok' : 'unavailable' })
        return
      }

      if (url.pathname === '/v1/backups/restore' || url.pathname === '/v1/backups/delete') {
        const retryAfter = consumeRateLimit(clientAddress(request, options.trustedProxy === true))
        if (retryAfter !== null) {
          response.setHeader('retry-after', String(retryAfter))
          sendJson(response, 429, { error: 'rate_limited' })
          return
        }
      }

      if (request.method === 'POST' && ['/v1/backups', '/v1/backups/restore', '/v1/backups/delete'].includes(url.pathname)) {
        if (request.headers['content-type']?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
          sendJson(response, 415, { error: 'unsupported_media_type' })
          return
        }
        const parsed = await readJsonBody(request)
        if (parsed.error) {
          if (parsed.error === 413) response.setHeader('connection', 'close')
          sendJson(response, parsed.error, { error: parsed.error === 413 ? 'payload_too_large' : 'invalid_request' })
          return
        }
        if (url.pathname === '/v1/backups/restore') {
          const keys = parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)
            ? Object.keys(parsed.value)
            : []
          if (keys.length !== 1 || keys[0] !== 'id' || !isCanonicalBase64Url(parsed.value.id, 16, idPattern)) {
            sendNotFound(response)
            return
          }
          const record = await readRecord(options.rootDir, parsed.value.id)
          if (!record) {
            sendNotFound(response)
            return
          }
          sendJson(response, 200, { blob: record.blob })
          return
        }
        if (url.pathname === '/v1/backups/delete') {
          const keys = parsed.value && typeof parsed.value === 'object' && !Array.isArray(parsed.value)
            ? Object.keys(parsed.value).sort()
            : []
          const valid = keys.join(',') === 'deleteSecret,id'
            && isCanonicalBase64Url(parsed.value.id, 16, idPattern)
            && isCanonicalBase64Url(parsed.value.deleteSecret, 32, verifierPattern)
          if (!valid) {
            sendNotFound(response)
            return
          }
          const deleted = await runStorageMutation(() => withStorageLock(options.rootDir, async () => {
            const record = await readRecord(options.rootDir, parsed.value.id)
            if (!record || !verifierMatches(parsed.value.deleteSecret, record.deleteVerifier)) return false
            try {
              await unlink(recordPath(options.rootDir, parsed.value.id))
              return true
            } catch (error) {
              if (error.code === 'ENOENT') return false
              throw error
            }
          }))
          if (!deleted) {
            sendNotFound(response)
            return
          }
          response.statusCode = 204
          response.end()
          return
        }
        if (typeof parsed.value?.blob === 'string' && blobPattern.test(parsed.value.blob) && Buffer.from(parsed.value.blob, 'base64url').length > maxBlobBytes) {
          sendJson(response, 413, { error: 'payload_too_large' })
          return
        }
        if (!isValidBackup(parsed.value)) {
          sendJson(response, 400, { error: 'invalid_request' })
          return
        }
        const uploadRetryAfter = consumeUploadRateLimit(clientAddress(request, options.trustedProxy === true))
        if (uploadRetryAfter !== null) {
          response.setHeader('retry-after', String(uploadRetryAfter))
          sendJson(response, 429, { error: 'rate_limited' })
          return
        }
        const result = await runStorageMutation(() => withStorageLock(
          options.rootDir,
          () => createRecord(options.rootDir, parsed.value, maxStorageBytes)
        ))
        if (result === 'duplicate') {
          sendJson(response, 409, { error: 'already_exists' })
          return
        }
        if (result === 'full') {
          sendJson(response, 507, { error: 'insufficient_storage' })
          return
        }
        sendJson(response, 201, { created: true })
        return
      }

      sendNotFound(response)
    } catch {
      if (!response.headersSent) sendJson(response, 500, { error: 'internal_error' })
      else response.destroy()
    }
  })
}
