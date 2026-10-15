import fs from 'node:fs/promises';
import { spawn } from 'node:child_process';

export function protectForCurrentUser(value, decrypt = false) {
  if (process.platform !== 'win32') return Promise.reject(new Error('Windows DPAPI is required'));
  const script = "$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; $bytes=[Convert]::FromBase64String([Console]::In.ReadToEnd()); $result=[Security.Cryptography.ProtectedData]::" + (decrypt ? 'Unprotect' : 'Protect') + "($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write([Convert]::ToBase64String($result))";
  return new Promise((resolve, reject) => {
    const child = spawn('C:/Windows/System32/WindowsPowerShell/v1.0/powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let output = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Credential protection timed out')); }, 15_000);
    child.stdout.on('data', chunk => { output += chunk.toString(); if (output.length > 100_000) child.kill(); });
    child.stderr.resume();
    child.once('error', () => { clearTimeout(timer); reject(new Error('Credential protection failed')); });
    child.once('exit', code => { clearTimeout(timer); if (code !== 0) reject(new Error('Credential protection failed')); else resolve(Buffer.from(output.trim(), 'base64')); });
    child.stdin.end(Buffer.from(value).toString('base64'));
  });
}

export async function readMcpHeaders(file) {
  const bytes = await fs.readFile(file);
  if (bytes.length > 100_000) throw new Error('Invalid credential file');
  const credential = JSON.parse((await protectForCurrentUser(bytes, true)).toString('utf8'));
  if (!/^[A-Za-z0-9_-]{43}$/.test(credential.token)) throw new Error('Invalid credential');
  return { Authorization: `Bearer ${credential.token}` };
}

if (process.argv[1] && new URL(import.meta.url).pathname.toLowerCase().endsWith('/mcp-headers.mjs') && process.argv[1].replaceAll('\\', '/').toLowerCase().endsWith('/mcp-headers.mjs')) {
  try { process.stdout.write(JSON.stringify(await readMcpHeaders(process.argv[2]))); }
  catch { process.stderr.write('MCP credentials unavailable\n'); process.exitCode = 1; }
}
