export interface CollectorSourceTab {
  id: string;
  name: string;
  text: string;
}

export interface CollectorTabSummary {
  id: string;
  name: string;
  linkCount: number;
}

export interface CollectorRow {
  id: string;
  tabId: string;
  tabName: string;
  originalLineIndex: number;
  lineNumber: number;
  value: string;
  linkCount: number;
}

export interface CollectorViewModel {
  tabs: CollectorTabSummary[];
  activeTabId: string;
  rows: CollectorRow[];
  busy: boolean;
  query: string;
  selectedIds: string[];
  empty: boolean;
  error: string;
}

function nonEmptyLines(tab: CollectorSourceTab): Array<{ originalLineIndex: number; value: string }> {
  return tab.text
    .split(/\r?\n/)
    .map((value, originalLineIndex) => ({ originalLineIndex, value: value.trim() }))
    .filter((line) => line.value.length > 0);
}

export function buildCollectorRows(
  tabs: CollectorSourceTab[],
  activeTabId: string = tabs[0]?.id ?? "",
  query = ""
): CollectorRow[] {
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? tabs[0];
  if (!activeTab) {
    return [];
  }
  const lines = nonEmptyLines(activeTab);
  const normalizedQuery = query.trim().toLocaleLowerCase("de");
  return lines
    .filter((line) => !normalizedQuery || line.value.toLocaleLowerCase("de").includes(normalizedQuery))
    .map((line) => ({
      id: `${activeTab.id}:${line.originalLineIndex}`,
      tabId: activeTab.id,
      tabName: activeTab.name,
      originalLineIndex: line.originalLineIndex,
      lineNumber: line.originalLineIndex + 1,
      value: line.value,
      linkCount: lines.length
    }));
}

export function buildCollectorViewModel(
  tabs: CollectorSourceTab[],
  activeTabId: string,
  query: string,
  busy: boolean,
  selectedIds: string[],
  error = ""
): CollectorViewModel {
  const rows = buildCollectorRows(tabs, activeTabId, query);
  return {
    tabs: tabs.map((tab) => ({
      id: tab.id,
      name: tab.name,
      linkCount: nonEmptyLines(tab).length
    })),
    activeTabId,
    rows,
    busy,
    query,
    selectedIds,
    empty: rows.length === 0,
    error
  };
}
