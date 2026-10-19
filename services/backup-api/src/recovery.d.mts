export function recoveryDescriptor(pem: string): { version: number; keyId: string; publicKey: string };
export function recoverOnlineKey(record: { id: string; blob: string; deleteVerifier: string; recovery?: unknown }, privateKey: string): string;
