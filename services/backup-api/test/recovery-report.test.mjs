import assert from 'node:assert/strict'
import test from 'node:test'
import { formatRecoveryReport, recoveryMetadata } from '../src/recovery-report.mjs'

const key = 'MDD2-' + 'A'.repeat(70)

test('formats date in Berlin time with source IP and the online key', () => {
  assert.equal(formatRecoveryReport({ createdAt: '2026-09-22T12:30:00.000Z', sourceIp: '203.0.113.7' }, key), `22.09.2026 - 14:30 | IP: 203.0.113.7 | Schlüssel: ${key}\n`)
  assert.equal(formatRecoveryReport({ createdAt: '2026-01-22T12:30:00.000Z', sourceIp: '2001:db8::7' }, key), `22.01.2026 - 13:30 | IP: 2001:db8::7 | Schlüssel: ${key}\n`)
  assert.equal(formatRecoveryReport({ createdAt: '2026-09-21T22:00:00.000Z', sourceIp: '::ffff:192.0.2.1' }, key), `22.09.2026 - 00:00 | IP: 192.0.2.1 | Schlüssel: ${key}\n`)
})

test('keeps legacy metadata explicitly unknown and does not invent a date or IP', () => {
  assert.deepEqual(recoveryMetadata({}), { createdAt: null, sourceIp: null })
  assert.equal(formatRecoveryReport({}, key), `Datum unbekannt | IP: unbekannt | Schlüssel: ${key}\n`)
  assert.equal(formatRecoveryReport({ createdAt: 'invalid', sourceIp: 'invalid\nInjected' }, key), `Datum unbekannt | IP: unbekannt | Schlüssel: ${key}\n`)
  assert.throws(() => formatRecoveryReport({}, key + '\nInjected'))
})
