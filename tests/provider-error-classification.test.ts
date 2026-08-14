import { describe, expect, it } from "vitest";
import { parseDebridLinkTerminalFailure } from "../src/main/download-manager";

describe("provider error classification", () => {
  it("does not relabel an aggregated Real-Debrid failure as Debrid-Link", () => {
    const message = "Error: Unrestrict fehlgeschlagen: Mega-Debrid nicht verfuegbar (alle aktiven Accounts deaktiviert oder ausgeschopft) | Debrid-Link nicht verfuegbar (alle aktiven API-Keys deaktiviert oder ausgeschopft) | Real-Debrid: traffic_exhausted";

    expect(parseDebridLinkTerminalFailure(message)).toBeNull();
  });

  it("still recognizes a direct Debrid-Link terminal failure", () => {
    expect(parseDebridLinkTerminalFailure("Debrid-Link nicht verfuegbar: kein aktiver API-Key")).toMatchObject({
      kind: "no_active_key"
    });
  });
});
