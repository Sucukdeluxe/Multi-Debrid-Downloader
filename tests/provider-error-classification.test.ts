import { describe, expect, it } from "vitest";
import { classifyProviderUnrestrictBackoff, isProviderUnrestrictFailure, parseDebridLinkTerminalFailure } from "../src/main/download-manager";

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

  it.each([
    ["Deepbrid-Anfrage fehlgeschlagen (rate_limit, HTTP 429, Code 429)", "busy"],
    ["Deepbrid-Anfrage fehlgeschlagen (temporary, HTTP 503, Code 503)", "temporary"],
    ["Deepbrid-Anfrage fehlgeschlagen (auth, HTTP 401, Code 401)", null],
    ["Deepbrid-Anfrage fehlgeschlagen (link, HTTP 400, Code 17)", null],
    ["Deepbrid-Anfrage fehlgeschlagen (malformed, HTTP 200, Code 200)", null]
  ])("classifies Deepbrid backoff precisely for %s", (message, expected) => {
    expect(classifyProviderUnrestrictBackoff(message)).toBe(expected);
    expect(isProviderUnrestrictFailure(message)).toBe(true);
  });
});
