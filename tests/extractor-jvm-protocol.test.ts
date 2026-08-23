import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { extractPackageArchives, shutdownDaemon, type ExtractArchiveFailureInfo } from "../src/main/extractor";

const hasJdk = spawnSync("javac", ["-version"], { stdio: "ignore" }).status === 0;
const originalBackend = process.env.RD_EXTRACT_BACKEND;
const originalJava = process.env.RD_JAVA_BIN;
const originalJvmRoot = process.env.RD_EXTRACTOR_JVM_DIR;
const originalFakeMode = process.env.RD_FAKE_JVM_MODE;
const originalFakeSecret = process.env.RD_FAKE_JVM_SECRET;
const tempDirs: string[] = [];
let runtimeRoot = "";

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function createArchiveFixture(prefix: string): { packageDir: string; targetDir: string } {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tempDirs.push(root);
  const packageDir = path.join(root, "pkg");
  const targetDir = path.join(root, "out");
  fs.mkdirSync(packageDir, { recursive: true });
  fs.writeFileSync(path.join(packageDir, "release.7z"), Buffer.from("377abcaf271c0004", "hex"));
  return { packageDir, targetDir };
}

function extractionOptions(fixture: ReturnType<typeof createArchiveFixture>) {
  return {
    ...fixture,
    cleanupMode: "none" as const,
    conflictMode: "skip" as const,
    removeLinks: false,
    removeSamples: false,
    passwordList: "candidate-one\ncandidate-two"
  };
}

describe.skipIf(!hasJdk).sequential("JVM protocol integration", () => {
  beforeAll(() => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-jvm-protocol-runtime-"));
    tempDirs.push(root);
    runtimeRoot = path.join(root, "extractor-jvm");
    const sourceDir = path.join(root, "source", "com", "sucukdeluxe", "extractor");
    const classesDir = path.join(runtimeRoot, "classes");
    const libDir = path.join(runtimeRoot, "lib");
    fs.mkdirSync(sourceDir, { recursive: true });
    fs.mkdirSync(classesDir, { recursive: true });
    fs.mkdirSync(libDir, { recursive: true });
    const javaSource = `package com.sucukdeluxe.extractor;
import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
public final class JBindExtractorMain {
  public static void main(String[] args) throws Exception {
    String mode = System.getenv("RD_FAKE_JVM_MODE");
    String secret = System.getenv("RD_FAKE_JVM_SECRET");
    boolean daemon = args.length == 1 && "--daemon".equals(args[0]);
    if (daemon && mode.startsWith("oneshot")) return;
    if (daemon) {
      System.out.println("RD_DAEMON_READY");
      System.out.flush();
      BufferedReader reader = new BufferedReader(new InputStreamReader(System.in, StandardCharsets.UTF_8));
      while (reader.readLine() != null) {
        System.out.println("RD_PASSWORD_ATTEMPT 1 4");
        System.out.println("RD_BACKEND fake-daemon");
        if ("daemon-success".equals(mode)) {
          System.out.println("RD_DONE");
          System.out.println("RD_REQUEST_DONE 0");
          System.out.flush();
          continue;
        }
        System.out.print("RD_PASS");
        System.out.flush();
        Thread.sleep(25L);
        System.out.print("WORD " + Base64.getEncoder().encodeToString(secret.getBytes(StandardCharsets.UTF_8)));
        System.out.flush();
        return;
      }
      return;
    }
    System.out.println("RD_PASSWORD_ATTEMPT 1 4");
    System.out.println("RD_BACKEND fake-oneshot");
    if ("oneshot-success".equals(mode)) {
      System.out.println("RD_DONE");
      return;
    }
    System.out.print("RD_PASS");
    System.out.flush();
    Thread.sleep(25L);
    System.out.print("WORD " + Base64.getEncoder().encodeToString(secret.getBytes(StandardCharsets.UTF_8)));
    System.out.flush();
    System.exit(1);
  }
}`;
    const sourcePath = path.join(sourceDir, "JBindExtractorMain.java");
    fs.writeFileSync(sourcePath, javaSource, "utf8");
    const compiled = spawnSync("javac", ["-source", "8", "-target", "8", "-encoding", "UTF-8", "-d", classesDir, sourcePath], { encoding: "utf8" });
    expect(compiled.status, `${compiled.stdout}\n${compiled.stderr}`).toBe(0);
    const sourceLibDir = path.join(process.cwd(), "resources", "extractor-jvm", "lib");
    for (const name of ["sevenzipjbinding.jar", "sevenzipjbinding-all-platforms.jar", "zip4j.jar"]) {
      fs.copyFileSync(path.join(sourceLibDir, name), path.join(libDir, name));
    }
    process.env.RD_EXTRACT_BACKEND = "jvm";
    process.env.RD_JAVA_BIN = "java";
    process.env.RD_EXTRACTOR_JVM_DIR = runtimeRoot;
  }, 20_000);

  afterEach(() => {
    shutdownDaemon();
    delete process.env.RD_FAKE_JVM_MODE;
    delete process.env.RD_FAKE_JVM_SECRET;
  });

  afterAll(() => {
    shutdownDaemon();
    for (const directory of tempDirs.splice(0)) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
    restoreEnv("RD_EXTRACT_BACKEND", originalBackend);
    restoreEnv("RD_JAVA_BIN", originalJava);
    restoreEnv("RD_EXTRACTOR_JVM_DIR", originalJvmRoot);
    restoreEnv("RD_FAKE_JVM_MODE", originalFakeMode);
    restoreEnv("RD_FAKE_JVM_SECRET", originalFakeSecret);
  });

  it("transports daemon attempts and isolates throwing log observers", async () => {
    process.env.RD_FAKE_JVM_MODE = "daemon-success";
    process.env.RD_FAKE_JVM_SECRET = "unused-daemon-secret";
    const firstFixture = createArchiveFixture("rd-jvm-daemon-callback-");
    const first = await extractPackageArchives({
      ...extractionOptions(firstFixture),
      onLog: (_level, message) => {
        if (message.startsWith("Passwort-Versuch ")) {
          throw new Error("ui callback failed");
        }
      }
    });

    expect(first).toEqual(expect.objectContaining({ extracted: 1, failed: 0, lastError: "" }));

    const secondFixture = createArchiveFixture("rd-jvm-daemon-recovery-");
    const logs: string[] = [];
    const second = await extractPackageArchives({
      ...extractionOptions(secondFixture),
      onLog: (_level, message) => logs.push(message)
    });

    expect(second).toEqual(expect.objectContaining({ extracted: 1, failed: 0 }));
    expect(logs.some((message) => message.startsWith("Passwort-Versuch 1/4:"))).toBe(true);
  }, 20_000);

  it("redacts a one-shot password payload when the JVM exits before an error event", async () => {
    const secret = "one-shot-runtime-secret";
    const encodedSecret = Buffer.from(secret, "utf8").toString("base64");
    process.env.RD_FAKE_JVM_MODE = "oneshot-crash";
    process.env.RD_FAKE_JVM_SECRET = secret;
    const fixture = createArchiveFixture("rd-jvm-oneshot-redaction-");
    const failures: ExtractArchiveFailureInfo[] = [];
    const logs: string[] = [];

    const result = await extractPackageArchives({
      ...extractionOptions(fixture),
      onArchiveFailure: (failure) => failures.push(failure),
      onLog: (_level, message) => logs.push(message)
    });

    const diagnosticText = [result.lastError, ...failures.map((failure) => `${failure.errorText}\n${failure.jvmFailureReason || ""}`), ...logs].join("\n");
    expect(result).toEqual(expect.objectContaining({ extracted: 0, failed: 1 }));
    expect(diagnosticText).toContain("RD_PASSWORD <redacted>");
    expect(diagnosticText).not.toContain(secret);
    expect(diagnosticText).not.toContain(encodedSecret);
    expect(logs.some((message) => message.startsWith("Passwort-Versuch 1/4:"))).toBe(true);
  }, 20_000);

  it("redacts a daemon password payload when the JVM exits before request completion", async () => {
    const secret = "daemon-runtime-secret";
    const encodedSecret = Buffer.from(secret, "utf8").toString("base64");
    process.env.RD_FAKE_JVM_MODE = "daemon-crash";
    process.env.RD_FAKE_JVM_SECRET = secret;
    const fixture = createArchiveFixture("rd-jvm-daemon-redaction-");
    const failures: ExtractArchiveFailureInfo[] = [];
    const logs: string[] = [];

    const result = await extractPackageArchives({
      ...extractionOptions(fixture),
      onArchiveFailure: (failure) => failures.push(failure),
      onLog: (_level, message) => logs.push(message)
    });

    const diagnosticText = [result.lastError, ...failures.map((failure) => `${failure.errorText}\n${failure.jvmFailureReason || ""}`), ...logs].join("\n");
    expect(result).toEqual(expect.objectContaining({ extracted: 0, failed: 1 }));
    expect(diagnosticText).toContain("RD_PASSWORD <redacted>");
    expect(diagnosticText).not.toContain(secret);
    expect(diagnosticText).not.toContain(encodedSecret);
    expect(logs.some((message) => message.startsWith("Passwort-Versuch 1/4:"))).toBe(true);
  }, 20_000);
});
