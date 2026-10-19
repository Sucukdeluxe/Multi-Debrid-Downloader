export type CollectorImportSource = "manual" | "clipboard";

export function shouldFocusCollectorImport(source: CollectorImportSource, switchToCollectorOnClipboard: boolean | undefined): boolean {
  return source === "manual" || switchToCollectorOnClipboard === true;
}
