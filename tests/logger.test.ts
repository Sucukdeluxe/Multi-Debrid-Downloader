import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { configureLogger, flushLogger, getLogFilePath, logger } from "../src/main/logger";

const tempDirs: string[] = [];

afterEach(async () => {
  await flushLogger();
  for (const dir of tempDirs.splice(0)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("logger", () => {
  it("redacts secrets, accounts, URLs and local paths before every log sink", async () => {
    const baseDir = fs.mkdtempSync(path.join(os.tmpdir(), "rd-logger-redaction-"));
    tempDirs.push(baseDir);
    configureLogger(baseDir);

    logger.warn("URL=https://rapidgator.net/file/private?token=secret | target=C:\\Users\\Admin\\Desktop\\private.rar | email=user@example.com | password=hunter2 | Authorization: Bearer abc.def");
    await flushLogger();

    const content = fs.readFileSync(getLogFilePath(), "utf8");
    expect(content).toContain("rapidgator.net#");
    expect(content).toContain("<redacted-path>");
    expect(content).toContain("<redacted-account>");
    expect(content).toContain("password=<redacted>");
    expect(content).not.toContain("/file/private");
    expect(content).not.toContain("C:\\Users\\Admin");
    expect(content).not.toContain("user@example.com");
    expect(content).not.toContain("hunter2");
    expect(content).not.toContain("abc.def");
  });
});
