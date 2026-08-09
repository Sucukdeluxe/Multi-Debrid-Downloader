import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ACCOUNT_SERVICE_ICONS } from "../src/renderer/account-service-icons";

const services = [
  "realdebrid",
  "megadebrid-api",
  "megadebrid-web",
  "bestdebrid",
  "alldebrid",
  "ddownload",
  "onefichier",
  "debridlink",
  "linksnappy"
] as const;

describe("account service icons", () => {
  it("bundles a valid local PNG or ICO for every account service", async () => {
    expect(Object.keys(ACCOUNT_SERVICE_ICONS).sort()).toEqual([...services].sort());
    for (const service of services) {
      const relativePath = ACCOUNT_SERVICE_ICONS[service];
      expect(relativePath.startsWith("./provider-icons/")).toBe(true);
      const bytes = await readFile(path.resolve("assets", relativePath.slice(2)));
      const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
      const ico = bytes.subarray(0, 4).equals(Buffer.from([0x00, 0x00, 0x01, 0x00]));
      expect(png || ico).toBe(true);
    }
  });

  it("uses the same Mega-Debrid icon for API and Web accounts", () => {
    expect(ACCOUNT_SERVICE_ICONS["megadebrid-api"]).toBe(ACCOUNT_SERVICE_ICONS["megadebrid-web"]);
  });
});
