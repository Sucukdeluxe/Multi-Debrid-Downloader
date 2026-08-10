import { describe, expect, it } from "vitest";
import { DEV_SERVER_PORT, DEV_SERVER_URL } from "../src/main/dev-server-url";

describe("development server URL", () => {
  it("uses the isolated downloader development port by default", () => {
    expect(DEV_SERVER_PORT).toBe("5180");
    expect(DEV_SERVER_URL).toBe("http://localhost:5180");
  });
});
