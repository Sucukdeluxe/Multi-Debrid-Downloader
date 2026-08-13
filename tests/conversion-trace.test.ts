import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  formatConversionBlock,
  getConversionLogPath,
  hasActiveConversionTrace,
  initConversionLog,
  runWithConversionTrace,
  shutdownConversionLog,
  traceConversionPhase,
  type ConversionTrace
} from "../src/main/conversion-trace";

const tempDirs: string[] = [];

afterEach(() => {
  shutdownConversionLog();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("formatConversionBlock", () => {
  it("renders a header with verdict + total and one indented line per phase", () => {
    const trace: ConversionTrace = {
      startedAt: 1000,
      itemId: "id1",
      itemName: "tvs-foo.part5.rar",
      link: "https://rapidgator.net/file/abc/tvs-foo.part5.rar.html",
      providerOrder: "megadebrid-api,megadebrid-web",
      notes: { slots: "conv2/dl6/max8" },
      phases: [
        { atMs: 0, phase: "chain-try", provider: "megadebrid-api" },
        { atMs: 5, phase: "token", provider: "megadebrid-api", account: "2/2(e3)", tokenState: "fresh", workMs: 812, outcome: "ok" },
        { atMs: 820, phase: "api-getlink", provider: "megadebrid-api", account: "2/2(e3)", workMs: 634, outcome: "ok" }
      ]
    };
    const block = formatConversionBlock(trace, "OK", "", 1450);

    const lines = block.split("\n");
    expect(lines[0]).toContain("[CONV]");
    expect(lines[0]).toContain("itemId=id1");
    expect(lines[0]).not.toContain("tvs-foo.part5.rar");
    expect(lines[0]).not.toContain("rapidgator.net");
    expect(lines[0]).toContain("result=OK");
    expect(lines[0]).toContain("total=1450ms");
    expect(lines[0]).toContain("slots=conv2/dl6/max8");
    expect(lines).toHaveLength(4);
    expect(lines[2]).toContain("+5ms token");
    expect(lines[2]).toContain("account=Account 2/2");
    expect(lines[2]).toContain("token=fresh");
    expect(lines[2]).toContain("workMs=812");
  });

  it("includes the failure detail in the header verdict", () => {
    const trace: ConversionTrace = {
      startedAt: 0, itemId: "i", itemName: "x", link: "l", providerOrder: "megadebrid-web", notes: {},
      phases: [{ atMs: 60000, phase: "caller-timeout", provider: "megadebrid-web", outcome: "timeout", detail: "Unrestrict Timeout nach 60s" }]
    };
    const block = formatConversionBlock(trace, "FAIL", "Unrestrict Timeout nach 60s", 60003);
    expect(block.split("\n")[0]).toContain("result=FAIL (Unrestrict Timeout nach 60s)");
    expect(block).toContain("caller-timeout");
  });

  it("keeps diagnostic value while removing identities, credentials and source URLs", () => {
    const sourceUrl = "https://source-user:source-pass@files.example.test/private/file.rar?token=query-secret";
    const trace: ConversionTrace = {
      startedAt: 0,
      itemId: "item-safe",
      itemName: "file.rar",
      link: sourceUrl,
      providerOrder: "megadebrid-web",
      notes: {
        retry: 1,
        auth: "login=trace-user password=trace-password",
        token: "note-token-secret",
        credentials: JSON.stringify({ login: "nested-trace-user", password: "nested-trace-password" })
      },
      phases: [{
        atMs: 25,
        phase: "mega-account",
        provider: "megadebrid-web",
        account: "Account 1/3 (tr***ce)",
        outcome: "failed",
        detail: `Incorrect password for trace@example.test token=provider-token masked=tr***ce@identity.invalid source=${sourceUrl}`
      }]
    };

    const block = formatConversionBlock(trace, "FAIL", `Provider rejected password=header-secret at ${sourceUrl}`, 30);
    expect(block).toContain("result=FAIL");
    expect(block).toContain("Incorrect password");
    expect(block).toContain("account=Account 1/3");
    expect(block).toContain("itemId=item-safe");
    expect(block).not.toContain("files.example.test");
    for (const sensitive of ["source-user", "source-pass", "query-secret", "trace-user", "trace-password", "trace@example.test", "provider-token", "header-secret", "tr***ce", "identity.invalid", "note-token-secret", "nested-trace-user", "nested-trace-password", sourceUrl]) {
      expect(block).not.toContain(sensitive);
    }
    expect(block).not.toContain("https://");
  });

  it("renders shared opaque correlation IDs without exposing item names or source links", () => {
    const trace: ConversionTrace = {
      startedAt: 0,
      attemptId: "attempt-42",
      itemId: "item-42",
      packageId: "package-42",
      itemName: "Private.Release.Name.part1.rar",
      link: "https://private-user:private-password@rapidgator.net/file/private-token/Private.Release.Name.part1.rar",
      providerOrder: "megadebrid-web",
      notes: {},
      phases: []
    };

    const block = formatConversionBlock(trace, "OK", "", 25);

    expect(block).toContain("attemptId=attempt-42");
    expect(block).toContain("itemId=item-42");
    expect(block).toContain("packageId=package-42");
    expect(block).not.toContain("Private.Release.Name");
    expect(block).not.toContain("rapidgator.net");
    expect(block).not.toContain("private-token");
    expect(block).not.toContain("link=");
  });
});

describe("conversion trace context", () => {
  it("traceConversionPhase is a no-op outside an active trace and does not throw", () => {
    expect(hasActiveConversionTrace()).toBe(false);
    expect(() => traceConversionPhase({ phase: "orphan" })).not.toThrow();
  });

  it("activates an ambient trace across awaits inside runWithConversionTrace", async () => {
    expect(hasActiveConversionTrace()).toBe(false);
    const seen = await runWithConversionTrace(
      { itemId: "i", itemName: "n", link: "l", providerOrder: "megadebrid-api" },
      async () => {
        const before = hasActiveConversionTrace();
        traceConversionPhase({ phase: "chain-try", provider: "megadebrid-api" });
        await Promise.resolve();
        const afterAwait = hasActiveConversionTrace();
        return before && afterAwait;
      }
    );
    expect(seen).toBe(true);
    expect(hasActiveConversionTrace()).toBe(false);
  });

  it("carries optional correlation IDs through the async trace into the written block", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "rd-conversion-correlation-"));
    tempDirs.push(root);
    initConversionLog(root);

    await runWithConversionTrace(
      {
        attemptId: "attempt-written",
        itemId: "item-written",
        packageId: "package-written",
        itemName: "Clear.Release.Name.rar",
        link: "https://rapidgator.net/file/clear-link-token/Clear.Release.Name.rar",
        providerOrder: "megadebrid-api"
      },
      async () => {
        traceConversionPhase({ phase: "chain-try", provider: "megadebrid-api" });
        await Promise.resolve();
      }
    );

    const logPath = getConversionLogPath();
    expect(logPath).not.toBeNull();
    shutdownConversionLog();
    const content = fs.readFileSync(logPath!, "utf8");
    expect(content).toContain("attemptId=attempt-written");
    expect(content).toContain("itemId=item-written");
    expect(content).toContain("packageId=package-written");
    expect(content).not.toContain("Clear.Release.Name");
    expect(content).not.toContain("rapidgator.net");
    expect(content).not.toContain("clear-link-token");
  });
});
