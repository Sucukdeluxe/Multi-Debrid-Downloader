import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import {
  getAccountRotationLogPath,
  getRecentRotationEvents,
  initAccountRotationLog,
  logAccountRotation,
  runWithRotationItemSink,
  shutdownAccountRotationLog,
  type CorrelatedRotationEvent
} from "../src/main/account-rotation-log";
import type { RotationEvent } from "../src/shared/types";

const tempDirs: string[] = [];

afterEach(() => {
  shutdownAccountRotationLog();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("rotation item-sink (AsyncLocalStorage)", () => {
  it("routes the FULL rotation trail (incl. TEST) to the active item sink", async () => {
    const captured: RotationEvent[] = [];
    await runWithRotationItemSink((ev) => captured.push(ev), async () => {
      logAccountRotation("INFO", "Mega-Debrid Web", "Account 1/3 (ab**xy)", "TEST", { link: "x" });
      logAccountRotation("WARN", "Mega-Debrid Web", "Account 1/3 (ab**xy)", "FAILED", { reason: "Timeout", cooldownSec: 30, next: "Account 2/3 (cd**zw)" });
      logAccountRotation("INFO", "Mega-Debrid Web", "Account 2/3 (cd**zw)", "TEST", { link: "x" });
      logAccountRotation("INFO", "Mega-Debrid Web", "Account 2/3 (cd**zw)", "OK", { fileName: "f.mkv" });
      await Promise.resolve();
    });

    const events = captured.map((e) => e.event);
    expect(events).toEqual(["TEST", "FAILED", "TEST", "OK"]);
    const failed = captured.find((e) => e.event === "FAILED");
    expect(failed?.reason).toBe("Timeout");
    expect(failed?.accountLabel).toBe("Account 1/3");
    expect(failed?.next).toBe("Account 2/3");
  });

  it("removes account identities, credentials and source URLs before events reach a sink or ring", async () => {
    const captured: RotationEvent[] = [];
    const sourceUrl = "https://source-user:source-pass@files.example.test/private/file.rar?token=query-secret";
    await runWithRotationItemSink((event) => captured.push(event), async () => {
      logAccountRotation("WARN", "Mega-Debrid Web", "Account 1/3 (al***ce)", "FAILED", {
        reason: `Incorrect password for alice@example.test password=provider-secret masked=al***ce@identity.invalid source=${sourceUrl}`,
        category: "invalid",
        cooldownSec: 30,
        next: "Account 2/3 (bo***ob)",
        token: "direct-token-secret",
        authorization: "Bearer direct-bearer-secret",
        credentials: {
          username: "nested-user",
          password: "nested-password-secret",
          apiKey: "nested-api-key-secret",
          sourceUrl
        }
      });
    });

    const event = captured[0];
    const serialized = JSON.stringify(event);
    expect(event).toMatchObject({
      accountLabel: "Account 1/3",
      category: "invalid",
      cooldownSec: 30,
      next: "Account 2/3"
    });
    expect(event.reason).toContain("Incorrect password");
    expect(event.reason).toMatch(/files\.example\.test#[a-f0-9]{10}/);
    expect(serialized).not.toContain("alice@example.test");
    expect(serialized).not.toContain("provider-secret");
    expect(serialized).not.toContain("source-user");
    expect(serialized).not.toContain("source-pass");
    expect(serialized).not.toContain("query-secret");
    expect(serialized).not.toContain("al***ce");
    expect(serialized).not.toContain("bo***ob");
    for (const sensitive of ["identity.invalid", "direct-token-secret", "direct-bearer-secret", "nested-user", "nested-password-secret", "nested-api-key-secret"]) {
      expect(serialized).not.toContain(sensitive);
    }
    expect(JSON.stringify(getRecentRotationEvents(10))).not.toContain("provider-secret");
  });

  it("writes only anonymous accounts and fingerprinted links to the account rotation log", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-rotation-safety-"));
    tempDirs.push(root);
    const sourceUrl = "https://log-user:log-pass@rapidgator.net/file/private?token=rotation-secret";
    initAccountRotationLog(root);

    logAccountRotation("WARN", "Mega-Debrid API", "Account 1/2 (lo***in)", "FAILED", {
      reason: `Unauthorized login=private-login password=private-password at ${sourceUrl}`,
      category: "invalid",
      link: sourceUrl,
      next: "Account 2/2 (ne***xt)",
      token: "direct-log-token-secret",
      authorization: "Bearer direct-log-bearer-secret",
      credentials: {
        username: "nested-log-user",
        password: "nested-log-password-secret",
        apiKey: "nested-log-api-key-secret",
        sourceUrl
      }
    });

    const logPath = getAccountRotationLogPath();
    expect(logPath).not.toBeNull();
    shutdownAccountRotationLog();
    const content = fs.readFileSync(logPath!, "utf8");
    expect(content).toContain("Account 1/2 | FAILED");
    expect(content).toContain("category=invalid");
    expect(content).toMatch(/link=rapidgator\.net#[a-f0-9]{10}/);
    expect(content).toContain("next=Account 2/2");
    for (const sensitive of ["log-user", "log-pass", "rotation-secret", "private-login", "private-password", "lo***in", "ne***xt", "direct-log-token-secret", "direct-log-bearer-secret", "nested-log-user", "nested-log-password-secret", "nested-log-api-key-secret", sourceUrl]) {
      expect(content).not.toContain(sensitive);
    }
  });

  it("writes the active correlation IDs into the account rotation log", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-rotation-correlation-"));
    tempDirs.push(root);
    initAccountRotationLog(root);

    await runWithRotationItemSink(
      () => undefined,
      async () => {
        logAccountRotation("INFO", "Mega-Debrid API", "Account 1/1", "OK");
      },
      { attemptId: "attempt-log", itemId: "item-log", packageId: "package-log" }
    );

    const logPath = getAccountRotationLogPath();
    expect(logPath).not.toBeNull();
    shutdownAccountRotationLog();
    const content = fs.readFileSync(logPath!, "utf8");
    expect(content).toContain("attemptId=attempt-log");
    expect(content).toContain("itemId=item-log");
    expect(content).toContain("packageId=package-log");
  });

  it("does not leak events to the sink outside the run() scope", () => {
    const captured: RotationEvent[] = [];
    logAccountRotation("INFO", "Debrid-Link", "Key 1/2 (k1)", "OK");
    expect(captured).toHaveLength(0);
  });

  it("isolates two parallel item sinks (no cross-attribution)", async () => {
    const a: RotationEvent[] = [];
    const b: RotationEvent[] = [];
    await Promise.all([
      runWithRotationItemSink((ev) => a.push(ev), async () => {
        logAccountRotation("INFO", "Mega-Debrid Web", "Account 1 (a)", "TEST");
        await new Promise((r) => setTimeout(r, 10));
        logAccountRotation("INFO", "Mega-Debrid Web", "Account 1 (a)", "OK");
      }),
      runWithRotationItemSink((ev) => b.push(ev), async () => {
        logAccountRotation("INFO", "Debrid-Link", "Key 1 (b)", "TEST");
        await new Promise((r) => setTimeout(r, 5));
        logAccountRotation("WARN", "Debrid-Link", "Key 1 (b)", "FAILED", { reason: "badToken" });
      })
    ]);
    expect(a.every((e) => e.provider === "Mega-Debrid Web")).toBe(true);
    expect(b.every((e) => e.provider === "Debrid-Link")).toBe(true);
    expect(a.map((e) => e.event)).toEqual(["TEST", "OK"]);
    expect(b.map((e) => e.event)).toEqual(["TEST", "FAILED"]);
  });

  it("attaches and isolates optional attempt, item and package IDs across parallel rotations", async () => {
    const first: CorrelatedRotationEvent[] = [];
    const second: CorrelatedRotationEvent[] = [];

    await Promise.all([
      runWithRotationItemSink(
        (event) => first.push(event),
        async () => {
          logAccountRotation("INFO", "Mega-Debrid Web", "Account 1/2", "TEST");
          await new Promise((resolve) => setTimeout(resolve, 10));
          logAccountRotation("INFO", "Mega-Debrid Web", "Account 1/2", "OK");
        },
        { attemptId: "attempt-a", itemId: "item-a", packageId: "package-a" }
      ),
      runWithRotationItemSink(
        (event) => second.push(event),
        async () => {
          logAccountRotation("INFO", "Mega-Debrid Web", "Account 2/2", "TEST");
          await new Promise((resolve) => setTimeout(resolve, 5));
          logAccountRotation("WARN", "Mega-Debrid Web", "Account 2/2", "FAILED");
        },
        { attemptId: "attempt-b", itemId: "item-b", packageId: "package-b" }
      )
    ]);

    expect(first).toHaveLength(2);
    expect(first.every((event) => event.attemptId === "attempt-a" && event.itemId === "item-a" && event.packageId === "package-a")).toBe(true);
    expect(second).toHaveLength(2);
    expect(second.every((event) => event.attemptId === "attempt-b" && event.itemId === "item-b" && event.packageId === "package-b")).toBe(true);

    const correlatedRing = getRecentRotationEvents(10).filter((event) => event.attemptId === "attempt-a" || event.attemptId === "attempt-b");
    expect(correlatedRing).toHaveLength(4);
    expect(correlatedRing.filter((event) => event.attemptId === "attempt-a").every((event) => event.itemId === "item-a" && event.packageId === "package-a")).toBe(true);
    expect(correlatedRing.filter((event) => event.attemptId === "attempt-b").every((event) => event.itemId === "item-b" && event.packageId === "package-b")).toBe(true);
  });

  it("feeds the global UI ring with TEST and outcome events", () => {
    logAccountRotation("INFO", "Mega-Debrid API", "Account 9 (zz)", "TEST");
    logAccountRotation("INFO", "Mega-Debrid API", "Account 9 (zz)", "OK", { fileName: "ring.mkv" });
    const ring = getRecentRotationEvents(10);
    expect(ring.some((e) => e.event === "OK" && e.accountLabel === "Account 9")).toBe(true);
    expect(ring.some((e) => e.event === "TEST" && e.accountLabel === "Account 9")).toBe(true);
  });

  it("marks TIMEOUT_COOLDOWN as a failed attempt in the global UI ring without changing its event type", () => {
    logAccountRotation("WARN", "Mega-Debrid Web", "Account 10 (xy)", "TIMEOUT_COOLDOWN", {
      reason: "aborted:debrid",
      cooldownSec: 30,
      next: "Account 11 (yz)"
    });

    const event = getRecentRotationEvents(10).find((entry) => entry.accountLabel === "Account 10");

    expect(event).toMatchObject({
      event: "TIMEOUT_COOLDOWN",
      reason: "Versuch fehlgeschlagen: aborted:debrid"
    });
  });
});
