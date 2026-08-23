import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const defaultRuntimeRoot = path.resolve(scriptDir, "..", "resources", "extractor-jvm");
const requiredLibNames = [
  "sevenzipjbinding.jar",
  "sevenzipjbinding-all-platforms.jar",
  "zip4j.jar"
];
const stampName = ".source.sha256";

function parseArguments(args) {
  let runtimeRoot = defaultRuntimeRoot;
  let checkOnly = false;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--check") {
      checkOnly = true;
      continue;
    }
    if (value === "--runtime-root") {
      const next = args[index + 1];
      if (!next || next.startsWith("--")) {
        throw new Error("--runtime-root benötigt einen Pfad");
      }
      runtimeRoot = path.resolve(next);
      index += 1;
      continue;
    }
    throw new Error(`Unbekanntes Argument: ${value}`);
  }
  return { runtimeRoot, checkOnly };
}

function requireFile(filePath, label) {
  let stat;
  try {
    stat = fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw new Error(`${label} fehlt: ${filePath}`);
    }
    throw error;
  }
  if (!stat.isFile() || stat.size === 0 || stat.isSymbolicLink()) {
    throw new Error(`${label} ist keine reguläre, nicht leere Datei: ${filePath}`);
  }
}

function listJavaSources(sourceRoot) {
  const sources = [];
  const pending = [sourceRoot];
  while (pending.length > 0) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".java")) {
        sources.push(entryPath);
      }
    }
  }
  sources.sort((left, right) => left.localeCompare(right, "en"));
  if (sources.length === 0) {
    throw new Error(`Keine Java-Quellen gefunden: ${sourceRoot}`);
  }
  return sources;
}

function updateDigest(hash, root, filePath) {
  const relativePath = path.relative(root, filePath).replace(/\\/g, "/");
  const content = fs.readFileSync(filePath);
  hash.update(relativePath, "utf8");
  hash.update("\0", "utf8");
  hash.update(String(content.length), "utf8");
  hash.update("\0", "utf8");
  hash.update(content);
}

function sourceDigest(runtimeRoot, sources, libs) {
  const hash = crypto.createHash("sha256");
  hash.update("javac:-source=8:-target=8:-encoding=UTF-8:-g:none\0", "utf8");
  for (const filePath of [...sources, ...libs]) {
    updateDigest(hash, runtimeRoot, filePath);
  }
  return hash.digest("hex");
}

function verifyClassesDirectory(classesDir, expectedDigest) {
  const mainClass = path.join(classesDir, "com", "sucukdeluxe", "extractor", "JBindExtractorMain.class");
  const stampPath = path.join(classesDir, stampName);
  requireFile(mainClass, "JVM-Extractor-Hauptklasse");
  requireFile(stampPath, "JVM-Extractor-Quellhash");
  const mainClassBytes = fs.readFileSync(mainClass);
  if (mainClassBytes.length < 8 || mainClassBytes.readUInt16BE(6) !== 52) {
    throw new Error("JVM-Extractor-Hauptklasse muss Java-8-Bytecode verwenden");
  }
  const actualDigest = fs.readFileSync(stampPath, "utf8").trim();
  if (actualDigest !== expectedDigest) {
    throw new Error("JVM-Extractor-Klassen sind veraltet; Java-Quelle oder Bibliotheken wurden seit dem letzten Build geändert");
  }
}

function verifyClasses(runtimeRoot, expectedDigest) {
  verifyClassesDirectory(path.join(runtimeRoot, "classes"), expectedDigest);
}

function resolveJavac() {
  const javaHome = String(process.env.JAVA_HOME || "").trim();
  const javaHomeCompiler = javaHome
    ? path.join(javaHome, "bin", process.platform === "win32" ? "javac.exe" : "javac")
    : "";
  if (javaHomeCompiler && fs.existsSync(javaHomeCompiler)) {
    return javaHomeCompiler;
  }
  return "javac";
}

function requireJavac() {
  const command = resolveJavac();
  const probe = spawnSync(command, ["-version"], { encoding: "utf8", windowsHide: true });
  if (probe.error?.code === "ENOENT" || probe.status === null) {
    throw new Error("JDK fehlt: javac wurde nicht gefunden; installiere ein JDK und setze JAVA_HOME oder PATH");
  }
  if (probe.status !== 0) {
    throw new Error(`JDK-Compiler javac ist nicht verwendbar: ${String(probe.stderr || probe.stdout || `Exit ${probe.status}`).trim()}`);
  }
  return command;
}

function replaceClasses(runtimeRoot, temporaryClasses) {
  const classesDir = path.join(runtimeRoot, "classes");
  const backupDir = path.join(runtimeRoot, `.classes-previous-${process.pid}-${Date.now()}`);
  let previousMoved = false;
  try {
    if (fs.existsSync(classesDir)) {
      fs.renameSync(classesDir, backupDir);
      previousMoved = true;
    }
    fs.renameSync(temporaryClasses, classesDir);
    if (previousMoved) {
      fs.rmSync(backupDir, { recursive: true, force: true });
    }
  } catch (error) {
    if (!fs.existsSync(classesDir) && previousMoved && fs.existsSync(backupDir)) {
      fs.renameSync(backupDir, classesDir);
    }
    throw error;
  }
}

function compileClasses(runtimeRoot, sources, libs, digest) {
  const javac = requireJavac();
  const temporaryClasses = fs.mkdtempSync(path.join(runtimeRoot, ".classes-build-"));
  try {
    const result = spawnSync(javac, [
      "-source", "8",
      "-target", "8",
      "-encoding", "UTF-8",
      "-g:none",
      "-classpath", libs.join(path.delimiter),
      "-d", temporaryClasses,
      ...sources
    ], { encoding: "utf8", windowsHide: true });
    if (result.error?.code === "ENOENT") {
      throw new Error("JDK fehlt: javac wurde nicht gefunden; installiere ein JDK und setze JAVA_HOME oder PATH");
    }
    if (result.status !== 0) {
      throw new Error(`javac fehlgeschlagen: ${String(result.stderr || result.stdout || `Exit ${result.status}`).trim()}`);
    }
    fs.writeFileSync(path.join(temporaryClasses, stampName), `${digest}\n`, "utf8");
    verifyClassesDirectory(temporaryClasses, digest);
    replaceClasses(runtimeRoot, temporaryClasses);
  } finally {
    if (fs.existsSync(temporaryClasses)) {
      fs.rmSync(temporaryClasses, { recursive: true, force: true });
    }
  }
}

function main() {
  const { runtimeRoot, checkOnly } = parseArguments(process.argv.slice(2));
  const sourceRoot = path.join(runtimeRoot, "src");
  const sources = listJavaSources(sourceRoot);
  const libs = requiredLibNames.map((name) => path.join(runtimeRoot, "lib", name));
  for (const source of sources) {
    requireFile(source, "Java-Quelle");
  }
  for (const lib of libs) {
    requireFile(lib, "JVM-Extractor-Bibliothek");
  }
  const digest = sourceDigest(runtimeRoot, sources, libs);
  if (checkOnly) {
    verifyClasses(runtimeRoot, digest);
    process.stdout.write(`JVM-Extractor-Klassen aktuell: ${digest}\n`);
    return;
  }
  compileClasses(runtimeRoot, sources, libs, digest);
  verifyClasses(runtimeRoot, digest);
  process.stdout.write(`JVM-Extractor-Klassen gebaut: ${digest}\n`);
}

try {
  main();
} catch (error) {
  process.stderr.write(`JVM-Extractor-Build fehlgeschlagen: ${String(error?.message || error)}\n`);
  process.exitCode = 1;
}
