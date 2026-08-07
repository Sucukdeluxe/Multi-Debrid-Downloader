import type { Server } from "node:http";

export interface BackupServerOptions {
  rootDir: string;
  allowedOrigins?: string[];
  rateLimit?: {
    max: number;
    windowMs: number;
  };
  uploadRateLimit?: {
    max: number;
    windowMs: number;
  };
  maxStorageBytes?: number;
  trustedProxy?: boolean;
}

export function createBackupServer(options: BackupServerOptions): Server;
