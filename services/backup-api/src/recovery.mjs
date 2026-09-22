import { constants, createDecipheriv, createHash, createPublicKey, hkdfSync, privateDecrypt, timingSafeEqual } from 'node:crypto'

export function recoveryDescriptor(pem) {
  if (typeof pem !== 'string' || !pem.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('Expected a public recovery key')
  const key = createPublicKey(pem)
  if (key.asymmetricKeyType !== 'rsa' || key.asymmetricKeyDetails?.modulusLength !== 3072) throw new Error('Recovery requires RSA-3072')
  return {
    version: 1,
    keyId: createHash('sha256').update(key.export({ type: 'spki', format: 'der' })).digest('base64url'),
    publicKey: key.export({ type: 'spki', format: 'pem' }).toString()
  }
}

export function recoveryLabel(record) {
  return Buffer.from(`MDD-RECOVERY-V1:${record.id}:${record.deleteVerifier}:${createHash('sha256').update(record.blob).digest('base64url')}`)
}

export function validRecoveryEnvelope(envelope, descriptor) {
  if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope)) return false
  if (Object.keys(envelope).sort().join(',') !== 'ciphertext,keyId,version') return false
  return envelope.version === 1 && envelope.keyId === descriptor?.keyId
    && typeof envelope.ciphertext === 'string' && /^[A-Za-z0-9_-]{512}$/.test(envelope.ciphertext)
    && Buffer.from(envelope.ciphertext, 'base64url').length === 384
}

export function recoverOnlineKey(record, privateKey) {
  const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' }).toString()
  if (!validRecoveryEnvelope(record.recovery, recoveryDescriptor(publicKey))) throw new Error('No recovery envelope for this private key')
  const key = privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256', oaepLabel: recoveryLabel(record) }, Buffer.from(record.recovery.ciphertext, 'base64url')).toString('utf8')
  if (!/^MDD2-[A-Za-z0-9_-]{70}$/.test(key)) throw new Error('Invalid recovered key')
  const decoded = Buffer.from(key.slice(5), 'base64url')
  const id = decoded.subarray(0, 16)
  const master = decoded.subarray(16, 48)
  const checksum = createHash('sha256').update('MDD2-ONLINE-KEY-V1').update(id).update(master).digest().subarray(0, 4)
  if (decoded.toString('base64url') !== key.slice(5) || id.toString('base64url') !== record.id || !timingSafeEqual(checksum, decoded.subarray(48))) throw new Error('Recovered key does not match record')
  const secret = purpose => Buffer.from(hkdfSync('sha256', master, id, Buffer.from(`MDD-ONLINE-${purpose}-V1`), 32))
  if (createHash('sha256').update(secret('DELETE')).digest('base64url') !== record.deleteVerifier) throw new Error('Invalid deletion verifier')
  const blob = Buffer.from(record.blob, 'base64url')
  if (blob[0] !== 1 || blob.length < 29) throw new Error('Invalid backup blob')
  const decipher = createDecipheriv('aes-256-gcm', secret('ENCRYPTION'), blob.subarray(1, 13))
  decipher.setAAD(Buffer.concat([Buffer.from('MDD-ONLINE-BACKUP-V1'), id]))
  decipher.setAuthTag(blob.subarray(13, 29))
  decipher.update(blob.subarray(29))
  decipher.final()
  return key
}
