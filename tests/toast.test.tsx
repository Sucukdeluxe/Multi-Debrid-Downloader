import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Toast } from "../src/renderer/ui/Toast";

describe("Toast", () => {
  it("announces the current single toast politely", () => {
    const html = renderToStaticMarkup(<Toast message="Einstellungen gespeichert" />);

    expect(html).toContain("role=\"status\"");
    expect(html).toContain("aria-live=\"polite\"");
    expect(html).toContain("Einstellungen gespeichert");
  });

  it("renders nothing without a message", () => {
    expect(renderToStaticMarkup(<Toast message="" />)).toBe("");
  });
});
