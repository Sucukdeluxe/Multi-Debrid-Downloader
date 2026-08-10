import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ContextInfoButton } from "../src/renderer/ui/ContextInfoButton";
import {
  DataTable,
  DataTableBody,
  DataTableEmpty,
  DataTableFooter,
  DataTableHeader
} from "../src/renderer/ui/DataTable";
import { Icon } from "../src/renderer/ui/Icon";
import { Toolbar, ToolbarGroup, ToolbarSearch } from "../src/renderer/ui/Toolbar";
import { getThemeVariables, UI_FOCUS_RING_VARIABLE } from "../src/renderer/ui/theme";

const expectedThemes = {
  dark: {
    "--ui-canvas": "#0F0F0F",
    "--ui-surface": "#232323",
    "--ui-input": "#2B2B2B",
    "--ui-table-header": "#313131",
    "--ui-active": "#333436",
    "--ui-hover": "#373535",
    "--ui-tooltip": "#4F4D4D",
    "--ui-border": "#3D3D3D",
    "--ui-text": "#FFFFFF",
    "--ui-text-secondary": "#EAEDF3",
    "--ui-text-muted": "#919191",
    "--ui-primary": "#BAD0FC",
    "--ui-primary-hover": "#8AA5DC",
    "--ui-accent": "#3886FF",
    "--ui-warning": "#F1C786",
    "--ui-danger": "#F06464",
    "--ui-modal-secondary": "#35383D",
    "--ui-overlay": "rgba(0, 0, 0, 0.60)"
  },
  light: {
    "--ui-canvas": "#F3F4F6",
    "--ui-surface": "#FFFFFF",
    "--ui-input": "#F7F8FA",
    "--ui-table-header": "#E7E9ED",
    "--ui-active": "#DEE6F5",
    "--ui-hover": "#E8ECF3",
    "--ui-tooltip": "#35383D",
    "--ui-border": "#D0D4DB",
    "--ui-text": "#181A1F",
    "--ui-text-secondary": "#343842",
    "--ui-text-muted": "#667085",
    "--ui-primary": "#A9C2F3",
    "--ui-primary-hover": "#8AA5DC",
    "--ui-accent": "#256FDB",
    "--ui-warning": "#E8B85D",
    "--ui-danger": "#D94747",
    "--ui-modal-secondary": "#E7E9ED",
    "--ui-overlay": "rgba(0, 0, 0, 0.45)"
  }
} as const;

function relativeLuminance(color: string): number {
  const channels = color.slice(1).match(/.{2}/g)?.map((value) => Number.parseInt(value, 16) / 255) ?? [];
  const [red, green, blue] = channels.map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4);
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
}

function contrastRatio(first: string, second: string): number {
  const lighter = Math.max(relativeLuminance(first), relativeLuminance(second));
  const darker = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (lighter + 0.05) / (darker + 0.05);
}

describe("semantic themes", () => {
  it("exposes the exact frozen semantic roles for dark and light", () => {
    const dark = getThemeVariables("dark");
    const light = getThemeVariables("light");

    expect(dark).toEqual(expectedThemes.dark);
    expect(light).toEqual(expectedThemes.light);
    expect(Object.keys(dark)).toEqual(Object.keys(light));
    expect(Object.keys(dark)).toHaveLength(18);
    expect(Object.isFrozen(dark)).toBe(true);
    expect(Object.isFrozen(light)).toBe(true);
  });

  it("uses a focus ring role with at least 3 to 1 contrast on control surfaces", () => {
    for (const theme of ["dark", "light"] as const) {
      const variables = getThemeVariables(theme);
      const focus = variables[UI_FOCUS_RING_VARIABLE];
      for (const surface of ["--ui-canvas", "--ui-surface", "--ui-input", "--ui-active", "--ui-hover"] as const) {
        expect(contrastRatio(focus, variables[surface]), `${theme} focus on ${surface}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

describe("new UI primitives", () => {
  it("renders labelled current-color outline icons without emoji text", () => {
    const html = renderToStaticMarkup(<Icon name="download" label="Downloads" />);

    expect(html).toContain("aria-label=\"Downloads\"");
    expect(html).toContain("<svg");
    expect(html).toContain("stroke=\"currentColor\"");
    expect(html).not.toMatch(/[\u{1F300}-\u{1FAFF}]/u);
  });

  it("gives toolbar roles and search controls accessible names", () => {
    const html = renderToStaticMarkup(
      <Toolbar label="Downloadaktionen">
        <ToolbarGroup label="Steuerung">
          <button type="button">Start</button>
        </ToolbarGroup>
        <ToolbarSearch label="Downloads durchsuchen" value="paket" onChange={() => {}} />
      </Toolbar>
    );

    expect(html).toContain("role=\"toolbar\"");
    expect(html).toContain("aria-label=\"Downloadaktionen\"");
    expect(html).toContain("role=\"group\"");
    expect(html).toContain("aria-label=\"Steuerung\"");
    expect(html).toContain("type=\"search\"");
    expect(html).toContain("aria-label=\"Downloads durchsuchen\"");
  });

  it("keeps empty content inside the aria table body", () => {
    const html = renderToStaticMarkup(
      <DataTable>
        <DataTableHeader>Spalten</DataTableHeader>
        <DataTableBody>
          <DataTableEmpty title="Keine Einträge" description="Noch sind keine Daten vorhanden." />
        </DataTableBody>
        <DataTableFooter pageSize={10} rangeLabel="0 von 0" paginationVisible />
      </DataTable>
    );

    expect(html).toContain("role=\"table\"");
    expect(html).toContain("aria-label=\"Datentabelle\"");
    expect(html.indexOf("Keine Einträge")).toBeGreaterThan(html.indexOf("data-ui-region=\"table-body\""));
    expect(html).not.toContain("<table");
    expect(html).toContain("10 pro Seite");
    expect(html).toContain("0 von 0");
  });

  it("omits the entire footer when pagination is not visible", () => {
    const html = renderToStaticMarkup(
      <DataTableFooter pageSize={25} rangeLabel="1–25 von 80" paginationVisible={false} />
    );

    expect(html).toBe("");
  });

  it.each([
    ["null", null],
    ["false", false],
    ["whitespace", "   \n\t"],
    ["empty array", []],
    ["nested empty array", [null, false, "  ", []]]
  ])("omits context help for %s content", (_label, content) => {
    const html = renderToStaticMarkup(
      <ContextInfoButton
        contextName="Downloads"
        content={content}
        open={false}
        onOpenChange={() => {}}
      />
    );

    expect(html).toBe("");
  });

  it("renders an accessible trigger and named region for open real help", () => {
    const html = renderToStaticMarkup(
      <ContextInfoButton
        contextName="Downloads"
        content={["Vorhandene ", <strong key="help">Download-Hilfe</strong>]}
        open
        onOpenChange={() => {}}
      />
    );

    expect(html).toContain("aria-label=\"Informationen\"");
    expect(html).toContain("aria-expanded=\"true\"");
    expect(html).toContain("role=\"region\"");
    expect(html).toContain("aria-label=\"Informationen zu Downloads\"");
    expect(html).toContain("Vorhandene <strong>Download-Hilfe</strong>");
  });
});
