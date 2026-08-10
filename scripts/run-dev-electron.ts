import { execFile, spawn } from "node:child_process";
import { copyFile, mkdir, readFile, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const execFileAsync = promisify(execFile);
const productName = "Multi-Debrid-Downloader";
const executableName = `${productName}.exe`;

async function brandExecutable(executable: string, icon: string, version: string): Promise<void> {
  const editorName = process.arch === "x64" ? "rcedit-x64.exe" : "rcedit.exe";
  const editor = path.resolve("node_modules", "rcedit", "bin", editorName);
  await execFileAsync(editor, [
    executable,
    "--set-file-version", version,
    "--set-product-version", version,
    "--set-icon", icon,
    "--set-version-string", "CompanyName", "Sucukdeluxe",
    "--set-version-string", "FileDescription", productName,
    "--set-version-string", "InternalName", productName,
    "--set-version-string", "LegalCopyright", "Copyright © 2026 Sucukdeluxe",
    "--set-version-string", "OriginalFilename", executableName,
    "--set-version-string", "ProductName", productName
  ]);
}

export async function prepareDevElectron(source: string, target: string, icon: string, version: string): Promise<string> {
  await mkdir(path.dirname(target), { recursive: true });
  const temporaryTarget = `${target}.${process.pid}.tmp.exe`;
  await rm(temporaryTarget, { force: true });
  await copyFile(source, temporaryTarget);
  await brandExecutable(temporaryTarget, icon, version);
  await rm(target, { force: true });
  await rename(temporaryTarget, target);
  return target;
}

async function readVersion(): Promise<string> {
  const packageJson = JSON.parse(await readFile(path.resolve("package.json"), "utf8")) as { version: string };
  return packageJson.version;
}

function isProcessRunning(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "EPERM";
  }
}

async function removeStaleDevExecutables(directory: string, activeTarget: string): Promise<void> {
  const names = await readdir(directory).catch(() => []);
  await Promise.all(names
    .filter((name) => name === executableName || (name.startsWith(`${productName}-dev-`) && name.endsWith(".exe")))
    .map(async (name) => {
      const candidate = path.join(directory, name);
      const pid = Number(name.match(/^Multi-Debrid-Downloader-dev-(\d+)\.exe(?:\.\d+\.tmp\.exe)?$/)?.[1] || 0);
      if (candidate !== activeTarget && !isProcessRunning(pid)) {
        await rm(candidate, { force: true }).catch(() => undefined);
      }
    }));
}

async function run(): Promise<void> {
  const args = process.argv.slice(2);
  if (args[0] === "--prepare-only") {
    const [, source, target, icon, version] = args;
    if (!source || !target || !icon || !version) {
      process.exitCode = 2;
      return;
    }
    await prepareDevElectron(source, target, icon, version);
    return;
  }
  if (args[0] === "--cleanup-only") {
    const [, directory, activeTarget] = args;
    if (!directory || !activeTarget) {
      process.exitCode = 2;
      return;
    }
    await removeStaleDevExecutables(directory, activeTarget);
    return;
  }

  const source = require("electron") as string;
  const directory = path.dirname(source);
  const target = path.join(directory, `${productName}-dev-${process.pid}.exe`);
  const icon = path.resolve("assets/app_icon.ico");
  const version = await readVersion();
  await removeStaleDevExecutables(directory, target);
  await prepareDevElectron(source, target, icon, version);

  const child = spawn(target, ["."], { stdio: "inherit", windowsHide: false });
  child.on("close", async (code, signal) => {
    await rm(target, { force: true }).catch(() => undefined);
    process.exitCode = code ?? (signal ? 1 : 0);
  });
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      if (!child.killed) {
        child.kill(signal);
      }
    });
  }
}

void run().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack || error.message : String(error)}\n`);
  process.exitCode = 1;
});
