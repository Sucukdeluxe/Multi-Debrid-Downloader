import { isIP } from 'node:net'

export function recoveryMetadata(record) {
  let sourceIp = typeof record.sourceIp === 'string' && isIP(record.sourceIp) ? record.sourceIp : null
  if (sourceIp?.startsWith('::ffff:') && isIP(sourceIp.slice(7)) === 4) sourceIp = sourceIp.slice(7)
  return { createdAt: typeof record.createdAt === 'string' ? record.createdAt : null, sourceIp }
}

export function formatRecoveryReport(record, key) {
  if (!/^MDD2-[A-Za-z0-9_-]{70}$/.test(key)) throw new Error('Invalid online key')
  const metadata = recoveryMetadata(record)
  const date = metadata.createdAt ? new Date(metadata.createdAt) : null
  let timestamp = 'Datum unbekannt'
  if (date && Number.isFinite(date.getTime())) {
    const parts = Object.fromEntries(new Intl.DateTimeFormat('de-DE', {
      timeZone: 'Europe/Berlin', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
    }).formatToParts(date).map(part => [part.type, part.value]))
    timestamp = `${parts.day}.${parts.month}.${parts.year} - ${parts.hour}:${parts.minute}`
  }
  return `${timestamp} | IP: ${metadata.sourceIp ?? 'unbekannt'} | Schlüssel: ${key}\n`
}
