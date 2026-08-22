import { isValidElement, type ReactElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { LinkAddressesDialog, type LinkAddressesDialogProps } from "../src/renderer/ui/LinkAddressesDialog";

function findElements(node: ReactNode, predicate: (element: ReactElement<Record<string, unknown>>) => boolean): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => findElements(child, predicate));
  }
  if (!isValidElement<Record<string, unknown>>(node)) {
    return [];
  }
  const matches = predicate(node) ? [node] : [];
  return [...matches, ...findElements(node.props.children as ReactNode, predicate)];
}

function createDialog(overrides: Partial<LinkAddressesDialogProps> = {}): ReactElement {
  return LinkAddressesDialog({
    title: "Testpaket",
    links: [
      { name: "Erste Datei.mkv", url: "https://example.com/first" },
      { name: "Zweite Datei.mkv", url: "https://example.com/second" }
    ],
    isPackage: true,
    onClose: vi.fn(),
    writeClipboardText: vi.fn(async () => true),
    onToast: vi.fn(),
    ...overrides
  });
}

function buttonByText(tree: ReactElement, label: string): ReactElement<Record<string, unknown>> {
  const button = findElements(tree, (element) => element.type === "button" && element.props.children === label)[0];
  expect(button, `Button ${label} fehlt`).toBeDefined();
  return button;
}

async function click(button: ReactElement<Record<string, unknown>>): Promise<void> {
  const onClick = button.props.onClick as (() => void | Promise<void>) | undefined;
  expect(onClick).toBeTypeOf("function");
  await onClick?.();
}

describe("LinkAddressesDialog", () => {
  it("kopiert einzelne Namen und URLs ausschließlich über den sicheren Writer", async () => {
    const writeClipboardText = vi.fn(async () => true);
    const onToast = vi.fn();
    const tree = createDialog({ writeClipboardText, onToast });

    const firstName = findElements(tree, (element) => element.type === "button" && element.props["aria-label"] === "Erste Datei.mkv kopieren")[0];
    const firstUrl = findElements(tree, (element) => element.type === "button" && element.props["aria-label"] === "Link kopieren")[0];
    await click(firstName);
    await click(firstUrl);

    expect(writeClipboardText).toHaveBeenNthCalledWith(1, "Erste Datei.mkv");
    expect(writeClipboardText).toHaveBeenNthCalledWith(2, "https://example.com/first");
    expect(onToast).toHaveBeenNthCalledWith(1, "Name kopiert");
    expect(onToast).toHaveBeenNthCalledWith(2, "Link kopiert");
  });

  it("meldet Erfolg nur bei true und behandelt false sowie Ablehnungen als Fehler", async () => {
    const writeClipboardText = vi.fn()
      .mockResolvedValueOnce(false)
      .mockRejectedValueOnce(new Error("clipboard unavailable"));
    const onToast = vi.fn();
    const tree = createDialog({ writeClipboardText, onToast });

    await click(buttonByText(tree, "Alle Namen kopieren"));
    await click(buttonByText(tree, "Alle Links kopieren"));

    expect(onToast).toHaveBeenNthCalledWith(1, "Kopieren fehlgeschlagen");
    expect(onToast).toHaveBeenNthCalledWith(2, "Kopieren fehlgeschlagen");
    expect(onToast).not.toHaveBeenCalledWith("Alle Namen kopiert");
    expect(onToast).not.toHaveBeenCalledWith("Alle Links kopiert");
  });

  it("übergibt große Pakettexte ohne Kürzung oder Normalisierung", async () => {
    const longName = `Groß-${"n".repeat(300_000)}`;
    const longUrl = `https://example.com/${"u".repeat(300_000)}`;
    const writeClipboardText = vi.fn(async () => true);
    const onToast = vi.fn();
    const tree = createDialog({
      links: [
        { name: longName, url: longUrl },
        { name: "  Zeilenende  ", url: "https://example.com/trailing  " }
      ],
      writeClipboardText,
      onToast
    });

    await click(buttonByText(tree, "Alle Namen kopieren"));
    await click(buttonByText(tree, "Alle Links kopieren"));

    expect(writeClipboardText).toHaveBeenNthCalledWith(1, `${longName}\n  Zeilenende  `);
    expect(writeClipboardText).toHaveBeenNthCalledWith(2, `${longUrl}\nhttps://example.com/trailing  `);
    expect(onToast).toHaveBeenNthCalledWith(1, "Alle Namen kopiert");
    expect(onToast).toHaveBeenNthCalledWith(2, "Alle Links kopiert");
  });

  it("behält Dialogdesign, Paketaktionen und Schließen-Verhalten bei", async () => {
    const onClose = vi.fn();
    const packageTree = createDialog({ onClose });
    const singleTree = createDialog({ isPackage: false });
    const dialog = findElements(packageTree, (element) => typeof element.type === "function")[0];

    expect(dialog.props.className).toBe("link-popup");
    expect(dialog.props.size).toBe("wide");
    expect(dialog.props.title).toBe("Linkadressen anzeigen");
    expect(findElements(packageTree, (element) => element.props.className === "link-popup-row")).toHaveLength(2);
    expect(findElements(packageTree, (element) => element.props.className === "link-popup-name link-popup-click")).toHaveLength(2);
    expect(findElements(packageTree, (element) => element.props.className === "link-popup-url link-popup-click")).toHaveLength(2);
    expect(buttonByText(packageTree, "Alle Namen kopieren")).toBeDefined();
    expect(buttonByText(packageTree, "Alle Links kopieren")).toBeDefined();
    expect(findElements(singleTree, (element) => element.type === "button" && element.props.children === "Alle Namen kopieren")).toHaveLength(0);
    expect(findElements(singleTree, (element) => element.type === "button" && element.props.children === "Alle Links kopieren")).toHaveLength(0);

    await click(buttonByText(packageTree, "Schließen"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});
