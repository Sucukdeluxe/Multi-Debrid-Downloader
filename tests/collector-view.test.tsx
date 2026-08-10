import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  mergeCollectorDraftText,
  planCollectorTabRemoval,
  planCollectorTextReplacement
} from "../src/renderer/App";
import {
  buildCollectorRows,
  buildCollectorViewModel,
  type CollectorSourceTab
} from "../src/renderer/views/collector/collector-model";
import {
  CollectorInputDialog,
  CollectorContent,
  CollectorToolbar,
  CollectorView,
  type CollectorViewActions
} from "../src/renderer/views/collector/CollectorView";

function visitElements(node: ReactNode, visit: (element: ReactElement) => void): void {
  if (Array.isArray(node)) {
    node.forEach((child) => visitElements(child, visit));
    return;
  }
  if (!isValidElement(node)) {
    return;
  }
  visit(node);
  visitElements(node.props.children, visit);
  visitElements(node.props.actions, visit);
}

function findElement(node: ReactNode, predicate: (element: ReactElement) => boolean): ReactElement {
  let result: ReactElement | null = null;
  visitElements(node, (element) => {
    if (!result && predicate(element)) {
      result = element;
    }
  });
  if (!result) {
    throw new Error("Element not found");
  }
  return result;
}

function findButton(node: ReactNode, label: string): ReactElement {
  return findElement(node, (element) => element.type === "button" && element.props.children === label);
}

function createActions(overrides: Partial<CollectorViewActions> = {}): CollectorViewActions {
  return {
    onTabSelect: () => {},
    onTabAdd: () => {},
    onTabRemove: () => {},
    onOpenInput: () => {},
    onImportDlc: () => {},
    onImportFile: () => {},
    onExportQueue: () => {},
    onSubmit: () => {},
    onQueryChange: () => {},
    onSelectionChange: () => {},
    onRemoveSelected: () => {},
    ...overrides
  };
}

const populatedTabs: CollectorSourceTab[] = [
  {
    id: "tab-a",
    name: "Sammlung A",
    text: "https://example.test/a\n\n https://example.test/b "
  }
];

describe("collector model", () => {
  it("derives stable rows from non-empty raw lines without validating or regrouping them", () => {
    const rows = buildCollectorRows(populatedTabs, "tab-a", "");

    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.id)).toEqual(["tab-a:0", "tab-a:2"]);
    expect(rows.map((row) => row.originalLineIndex)).toEqual([0, 2]);
    expect(rows.map((row) => row.value)).toEqual([
      "https://example.test/a",
      "https://example.test/b"
    ]);
    expect(rows[0].linkCount).toBe(2);
    expect(rows[1].linkCount).toBe(2);
  });

  it("filters presentation rows while keeping source counts and original line identities", () => {
    const model = buildCollectorViewModel(populatedTabs, "tab-a", "EXAMPLE.TEST/B", false, ["tab-a:0"]);

    expect(model.rows.map((row) => row.id)).toEqual(["tab-a:2"]);
    expect(model.tabs).toEqual([{ id: "tab-a", name: "Sammlung A", linkCount: 2 }]);
    expect(model.selectedIds).toEqual(["tab-a:0"]);
    expect(model.empty).toBe(false);
  });

  it("preserves clipboard and drop appends that arrive while an input draft is open", () => {
    expect(mergeCollectorDraftText(
      "https://example.test/old",
      "https://example.test/old\nhttps://example.test/clipboard",
      "https://example.test/edited"
    )).toBe("https://example.test/edited\nhttps://example.test/clipboard");
    expect(mergeCollectorDraftText("old", "old", "edited")).toBe("edited");
  });

  it("moves the active identity to an existing neighbor before later appends arrive", () => {
    const tabs: CollectorSourceTab[] = [
      { id: "tab-a", name: "Sammlung A", text: "a" },
      { id: "tab-b", name: "Sammlung B", text: "b" },
      { id: "tab-c", name: "Sammlung C", text: "c" }
    ];

    expect(planCollectorTabRemoval(tabs, "tab-b", "tab-b")).toEqual({
      tabs: [tabs[0], tabs[2]],
      activeTabId: "tab-a"
    });
    expect(planCollectorTabRemoval(tabs, "tab-c", "tab-a")).toEqual({
      tabs: [tabs[1], tabs[2]],
      activeTabId: "tab-c"
    });
  });

  it("invalidates positional row selection whenever raw text is replaced", () => {
    const tabs: CollectorSourceTab[] = [
      { id: "tab-a", name: "Sammlung A", text: "old-a\nold-b" },
      { id: "tab-b", name: "Sammlung B", text: "untouched" }
    ];

    expect(planCollectorTextReplacement(tabs, "tab-a", "new-a")).toEqual({
      tabs: [
        { id: "tab-a", name: "Sammlung A", text: "new-a" },
        tabs[1]
      ],
      selectedIds: []
    });
  });
});

describe("CollectorView", () => {
  it("keeps empty, busy and error states inside the same table body", () => {
    const empty = renderToStaticMarkup(
      <CollectorView
        actions={createActions()}
        model={buildCollectorViewModel([{ id: "tab-a", name: "Sammlung A", text: "" }], "tab-a", "", false, [])}
      />
    );
    const busy = renderToStaticMarkup(
      <CollectorView
        actions={createActions()}
        model={{ ...buildCollectorViewModel([], "", "", true, []), error: "" }}
      />
    );
    const failed = renderToStaticMarkup(
      <CollectorView
        actions={createActions()}
        model={{ ...buildCollectorViewModel([], "", "", false, []), error: "Import fehlgeschlagen" }}
      />
    );

    for (const [html, state] of [
      [empty, "Noch keine Links"],
      [busy, "Links werden verarbeitet"],
      [failed, "Import fehlgeschlagen"]
    ]) {
      expect(html.indexOf(state)).toBeGreaterThan(html.indexOf("data-visual-region=\"collector-table-body\""));
    }
    expect(empty).toContain("data-visual-region=\"collector-empty-state\"");
    expect(empty).not.toContain("aria-label=\"Seitennavigation\"");
  });

  it("renders compact occupied rows and removes the empty marker", () => {
    const html = renderToStaticMarkup(
      <CollectorView
        actions={createActions()}
        model={buildCollectorViewModel(populatedTabs, "tab-a", "", false, [])}
      />
    );

    expect(html.match(/class=\"collector-row(?: is-selected)?\"/g)).toHaveLength(2);
    expect(html).not.toContain("data-visual-region=\"collector-empty-state\"");
    expect(html).toContain("data-visual-region=\"collector-sidebar\"");
    expect(html).toContain("data-visual-region=\"collector-toolbar\"");
    expect(html).toContain("data-visual-region=\"collector-table-body\"");
    expect(html).not.toContain("data-visual-region=\"downloads-toolbar\"");
    expect(html).not.toContain("aria-label=\"Seitennavigation\"");
  });

  it("separates local input, queue submission, search, selection and local removal callbacks", () => {
    let inputOpens = 0;
    let queueSubmits = 0;
    let query = "";
    let selected = "";
    let removals = 0;
    const actions = createActions({
      onOpenInput: () => { inputOpens += 1; },
      onSubmit: () => { queueSubmits += 1; },
      onQueryChange: (value) => { query = value; },
      onSelectionChange: (rowId) => { selected = rowId; },
      onRemoveSelected: () => { removals += 1; }
    });
    const toolbar = CollectorToolbar({
      actions,
      model: buildCollectorViewModel(populatedTabs, "tab-a", "", false, ["tab-a:0"])
    });
    const content = CollectorContent({
      actions,
      model: buildCollectorViewModel(populatedTabs, "tab-a", "", false, ["tab-a:0"])
    });

    findButton(toolbar, "Links hinzufügen").props.onClick();
    expect(inputOpens).toBe(1);
    expect(queueSubmits).toBe(0);

    findButton(toolbar, "An Downloads übergeben").props.onClick();
    expect(queueSubmits).toBe(1);

    const search = findElement(toolbar, (element) => element.props.label === "Links durchsuchen");
    search.props.onChange({ target: { value: "release" } });
    expect(query).toBe("release");

    const checkbox = findElement(content, (element) => element.type === "input" && element.props["aria-label"] === "Link auswählen");
    checkbox.props.onChange();
    findButton(toolbar, "Auswahl entfernen").props.onClick();
    expect(selected).toBe("tab-a:0");
    expect(removals).toBe(1);
    expect(queueSubmits).toBe(1);
  });

  it("names the input dialog and commits only through the local draft callback", () => {
    let value = "";
    let commits = 0;
    const dialog = CollectorInputDialog({
      open: true,
      tabName: "Sammlung A",
      value,
      onChange: (next) => { value = next; },
      onClose: () => {},
      onCommit: () => { commits += 1; }
    });
    const html = renderToStaticMarkup(dialog);

    expect(html).toContain("role=\"dialog\"");
    expect(html).toContain("aria-label=\"Links\"");
    expect(html).toContain("Links hinzufügen");
    expect(html).toContain("Übernehmen");

    const textbox = findElement(dialog, (element) => element.type === "textarea" && element.props["aria-label"] === "Links");
    textbox.props.onChange({ target: { value: "https://example.test/new" } });
    findButton(dialog, "Übernehmen").props.onClick();
    expect(value).toBe("https://example.test/new");
    expect(commits).toBe(1);
  });
});
