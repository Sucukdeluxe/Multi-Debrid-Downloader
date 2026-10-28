import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export function buildWorkingSetScript(pid: number, minBytes: number, maxBytes: number): string {
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -Namespace Mdd -Name WorkingSet -MemberDefinition '[DllImport(\"kernel32.dll\", SetLastError=true)] public static extern System.IntPtr OpenProcess(uint access, bool inherit, int pid); [DllImport(\"kernel32.dll\", SetLastError=true)] public static extern bool SetProcessWorkingSetSizeEx(System.IntPtr h, System.UIntPtr min, System.UIntPtr max, uint flags); [DllImport(\"kernel32.dll\")] public static extern bool CloseHandle(System.IntPtr h);'",
    `$h = [Mdd.WorkingSet]::OpenProcess(0x0500, $false, ${Math.trunc(pid)})`,
    "if ($h -eq [IntPtr]::Zero) { throw ('OpenProcess ' + [Runtime.InteropServices.Marshal]::GetLastWin32Error()) }",
    `$ok = [Mdd.WorkingSet]::SetProcessWorkingSetSizeEx($h, [UIntPtr]::new([uint64]${Math.trunc(minBytes)}), [UIntPtr]::new([uint64]${Math.trunc(maxBytes)}), 9)`,
    "$err = [Runtime.InteropServices.Marshal]::GetLastWin32Error()",
    "[void][Mdd.WorkingSet]::CloseHandle($h)",
    "if (-not $ok) { throw ('SetProcessWorkingSetSizeEx ' + $err) }"
  ].join("; ");
}

export async function pinProcessWorkingSet(pid: number, minBytes: number, maxBytes: number): Promise<void> {
  if (process.platform !== "win32") return;
  const powershell = path.join(process.env.SystemRoot || "C:\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  await execFileAsync(powershell, ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command", buildWorkingSetScript(pid, minBytes, maxBytes)], {
    windowsHide: true,
    timeout: 30_000
  });
}
