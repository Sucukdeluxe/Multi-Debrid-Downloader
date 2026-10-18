import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import path from "node:path";
import { createHash, randomUUID, verify } from "node:crypto";

export const DIRECT_UPDATE_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAsxxTU+SLgr/uMXILBlGWMmWJ4WjY45VhhVmU8fq5CJs=\n-----END PUBLIC KEY-----\n";
export interface InstallerManifest {
  version: string;
  baseVersion: string;
  bytes: number;
  sha256: string;
  expiresAt: number;
  installationId: string;
  requestKey: string;
}
export const installerSigningData = (m: InstallerManifest): Buffer => Buffer.from([
  "mdd-direct-installer-v1", m.version, m.baseVersion, m.bytes, m.sha256, m.expiresAt, m.installationId, m.requestKey
].join("\n"));

interface Upload {
  id: string;
  manifest: InstallerManifest;
  signature: string;
  principal: string;
  authorization: string;
  file: string;
  received: number;
  state: "receiving" | "verified" | "committed";
}
interface UploadOptions {
  directory: string;
  publicKey?: string;
  installationId(): string;
  version(): string;
  authorize(): string;
  canReplace?(): Promise<boolean>;
  install(file: string, manifest: InstallerManifest, validate: () => void, allowInterrupt: boolean, signal: AbortSignal): Promise<unknown>;
}

export class McpInstallerUploads {
  private upload: Upload | null = null;
  constructor(private options: UploadOptions) {}

  private validate(m: InstallerManifest, signature: string): void {
    const version = /^\d{1,6}\.\d{1,6}\.\d{1,6}$/;
    if (!m || !version.test(m.version) || !version.test(m.baseVersion)
      || !Number.isSafeInteger(m.bytes) || m.bytes < 131072 || m.bytes > 268435456
      || !/^[a-f0-9]{64}$/.test(m.sha256) || !/^[A-Za-z0-9_-]{8,128}$/.test(m.requestKey)
      || !/^[a-f0-9-]{36}$/.test(m.installationId) || m.installationId !== this.options.installationId()
      || !Number.isSafeInteger(m.expiresAt) || m.expiresAt <= Date.now() || m.expiresAt > Date.now() + 86400000
      || typeof signature !== "string" || !/^[A-Za-z0-9+/]{86}==$/.test(signature)) throw new Error("Ungültiges oder abgelaufenes Update-Manifest.");
    const base = m.baseVersion.split(".").map(Number);
    const target = m.version.split(".").map(Number);
    const different = target.findIndex((value, index) => value !== base[index]);
    if (m.baseVersion !== this.options.version() || different < 0 || target[different] < base[different]) throw new Error("Update passt nicht zur installierten Ausgangsversion.");
    if (!verify(null, installerSigningData(m), this.options.publicKey || DIRECT_UPDATE_PUBLIC_KEY, Buffer.from(signature, "base64"))) throw new Error("Update-Signatur ungültig.");
  }

  private get(id: string, principal: string, validateManifest = true): Upload {
    const authorization = this.options.authorize();
    const upload = this.upload;
    if (!upload || upload.id !== id || upload.principal !== principal || upload.authorization !== authorization) throw new Error("Update-Übertragung nicht verfügbar oder nicht berechtigt.");
    if (validateManifest) this.validate(upload.manifest, upload.signature);
    return upload;
  }

  private summary(upload: Upload) {
    return { uploadId: upload.id, version: upload.manifest.version, bytes: upload.manifest.bytes, received: upload.received, state: upload.state, maxChunkBytes: 524288 };
  }

  async begin(manifest: InstallerManifest, signature: string, principal: string) {
    const authorization = this.options.authorize();
    this.validate(manifest, signature);
    if (this.upload && ((this.upload.authorization !== authorization && this.upload.state !== "committed") || (this.upload.state === "committed" && await this.options.canReplace?.()))) {
      await fs.rm(this.upload.file, { force: true });
      this.upload = null;
    }
    if (this.upload) {
      if (this.upload.principal === principal && this.upload.authorization === authorization && this.upload.signature === signature
        && installerSigningData(this.upload.manifest).equals(installerSigningData(manifest))) return this.summary(this.upload);
      throw new Error("Eine Update-Übertragung ist bereits vorhanden. Zuerst abschließen oder abbrechen.");
    }
    const id = randomUUID();
    await fs.mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    for (const entry of await fs.readdir(this.options.directory, { withFileTypes: true })) {
      if (!entry.isFile() || !/^[a-f0-9-]{36}\.exe$/.test(entry.name)) continue;
      const old = path.join(this.options.directory, entry.name);
      const stat = await fs.stat(old);
      if (Date.now() - stat.mtimeMs > 86400000) await fs.rm(old, { force: true }).catch(() => {});
    }
    const file = path.join(this.options.directory, `${id}.exe`);
    const handle = await fs.open(file, "wx", 0o600);
    await handle.close();
    this.upload = { id, manifest: { ...manifest }, signature, principal, authorization, file, received: 0, state: "receiving" };
    return this.summary(this.upload);
  }

  status(id: string, principal: string) { return this.summary(this.get(id, principal, false)); }

  async chunk(id: string, principal: string, offset: number, base64: string) {
    const upload = this.get(id, principal);
    if (upload.state !== "receiving" || !Number.isSafeInteger(offset) || offset < 0 || offset > upload.received
      || typeof base64 !== "string" || base64.length > 699052 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new Error("Ungültiger Update-Datenblock.");
    const bytes = Buffer.from(base64, "base64");
    if (!bytes.length || bytes.length > 524288 || bytes.toString("base64") !== base64 || offset + bytes.length > upload.manifest.bytes) throw new Error("Ungültige Update-Blockgröße.");
    const handle = await fs.open(upload.file, "r+");
    try {
      if (offset < upload.received) {
        if (offset + bytes.length > upload.received) throw new Error("Überlappender Update-Datenblock.");
        const previous = Buffer.alloc(bytes.length);
        const read = await handle.read(previous, 0, previous.length, offset);
        if (read.bytesRead !== bytes.length || !previous.equals(bytes)) throw new Error("Wiederholter Update-Datenblock stimmt nicht überein.");
      } else {
        let written = 0;
        while (written < bytes.length) {
          const result = await handle.write(bytes, written, bytes.length - written, offset + written);
          if (!result.bytesWritten) throw new Error("Update-Datenblock konnte nicht geschrieben werden.");
          written += result.bytesWritten;
        }
        upload.received += bytes.length;
      }
    } finally { await handle.close(); }
    return this.summary(upload);
  }

  async commit(id: string, principal: string, allowInterrupt: boolean, signal: AbortSignal) {
    const upload = this.get(id, principal);
    signal.throwIfAborted();
    if (upload.received !== upload.manifest.bytes) throw new Error("Update-Übertragung ist unvollständig.");
    if (upload.state === "receiving") {
      const handle = await fs.open(upload.file, "r+");
      try { await handle.sync(); } finally { await handle.close(); }
      const hash = createHash("sha256");
      for await (const bytes of createReadStream(upload.file)) { signal.throwIfAborted(); hash.update(bytes); }
      if ((await fs.stat(upload.file)).size !== upload.manifest.bytes || hash.digest("hex") !== upload.manifest.sha256) throw new Error("SHA-256-Prüfung des Update-Pakets fehlgeschlagen.");
      upload.state = "verified";
    }
    const validate = () => { this.get(id, principal); };
    const result = await this.options.install(upload.file, upload.manifest, validate, allowInterrupt, signal);
    upload.state = "committed";
    return result;
  }

  async cancel(id: string, principal: string) {
    const upload = this.get(id, principal, false);
    if (upload.state === "committed") throw new Error("Die Installation wurde bereits übergeben; Status des Update-Auftrags prüfen.");
    await fs.rm(upload.file, { force: true });
    this.upload = null;
    return { cancelled: true };
  }
}
