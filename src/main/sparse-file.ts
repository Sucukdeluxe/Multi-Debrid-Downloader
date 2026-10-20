import { execFile } from "node:child_process";
import path from "node:path";

export function markFileSparse(filePath: string, timeoutMs = 10_000): Promise<boolean> {
  if (process.platform !== "win32") {
    return Promise.resolve(false);
  }
  const fsutil = path.join(process.env.SystemRoot || "C:\\Windows", "System32", "fsutil.exe");
  return new Promise((resolve) => {
    execFile(fsutil, ["sparse", "setflag", filePath], { windowsHide: true, timeout: timeoutMs }, (error) => resolve(!error));
  });
}
