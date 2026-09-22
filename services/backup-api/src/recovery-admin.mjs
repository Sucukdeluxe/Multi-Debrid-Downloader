import { generateKeyPairSync } from 'node:crypto'
import { mkdir, open, readFile, readdir, realpath } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { recoverOnlineKey, recoveryDescriptor } from './recovery.mjs'
import { formatRecoveryReport, recoveryMetadata } from './recovery-report.mjs'

async function writeExclusive(file, text) {
  const handle = await open(file, 'wx', 0o600)
  try {
    await handle.writeFile(text, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function run() {
  const [command, ...args] = process.argv.slice(2)
  if (command === 'init' && args.length === 1) {
    const directory = resolve(args[0])
    await mkdir(directory, { mode: 0o700 })
    const pair = generateKeyPairSync('rsa', {
      modulusLength: 3072,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    })
    await writeExclusive(join(directory, 'private.pem'), pair.privateKey)
    await writeExclusive(join(directory, 'public.pem'), pair.publicKey)
    process.stdout.write(`Recovery key ID: ${recoveryDescriptor(pair.publicKey).keyId}\n`)
    return
  }
  if (command === 'list' && args.length === 1) {
    const directory = resolve(args[0])
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[A-Za-z0-9_-]{22}\.json$/.test(entry.name)) continue
      const record = JSON.parse(await readFile(join(directory, entry.name), 'utf8'))
      process.stdout.write(JSON.stringify({ id: entry.name.slice(0, -5), ...recoveryMetadata(record), recoveryKeyId: record.recovery?.keyId ?? null }) + '\n')
    }
    return
  }
  if (command === 'recover' && (args.length === 4 || (args.length === 5 && args[4] === '--with-metadata'))) {
    const [root, id, privateFile, output] = args
    if (!/^[A-Za-z0-9_-]{22}$/.test(id) || Buffer.from(id, 'base64url').toString('base64url') !== id) throw new Error()
    const directory = await realpath(root)
    const privatePath = await realpath(privateFile)
    const outputPath = join(await realpath(dirname(resolve(output))), basename(output))
    for (const target of [privatePath, outputPath]) {
      const rel = relative(directory, target)
      if (!isAbsolute(rel) && rel !== '..' && !rel.startsWith('..\\') && !rel.startsWith('../')) throw new Error()
    }
    const record = JSON.parse(await readFile(join(directory, `${id}.json`), 'utf8'))
    const key = recoverOnlineKey({ ...record, id }, await readFile(privatePath, 'utf8'))
    await writeExclusive(outputPath, args[4] === '--with-metadata' ? formatRecoveryReport(record, key) : key + '\n')
    process.stdout.write('Online key written to the requested file. Protect it like a password.\n')
    return
  }
  process.stderr.write('Usage: recovery-admin.mjs init <new-key-directory> | list <backup-data-directory> | recover <backup-data-directory> <backup-id> <private.pem> <new-output-file> [--with-metadata]\n')
  process.exitCode = 1
}

run().catch(() => {
  process.stderr.write('Recovery operation failed. Check arguments, permissions, key pairing and backup integrity. Existing files are never overwritten.\n')
  process.exitCode = 1
})
