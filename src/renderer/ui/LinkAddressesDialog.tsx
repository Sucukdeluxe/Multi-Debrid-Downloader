import type { ReactElement } from "react";
import { Dialog } from "./Dialog";

export interface LinkAddressesDialogProps {
  title: string;
  links: Array<{ name: string; url: string }>;
  isPackage: boolean;
  onClose: () => void;
  writeClipboardText: (text: string) => Promise<boolean>;
  onToast: (message: string) => void;
}

export function LinkAddressesDialog({
  title,
  links,
  isPackage,
  onClose,
  writeClipboardText,
  onToast
}: LinkAddressesDialogProps): ReactElement {
  const copy = async (text: string, successMessage: string): Promise<void> => {
    try {
      const copied = await writeClipboardText(text);
      onToast(copied === true ? successMessage : "Kopieren fehlgeschlagen");
    } catch {
      onToast("Kopieren fehlgeschlagen");
    }
  };

  return (
    <Dialog actions={null} className="link-popup" onClose={onClose} open size="wide" title="Linkadressen anzeigen">
      <p>{title}</p>
      <div className="link-popup-list">
        {links.map((link, index) => (
          <div key={index} className="link-popup-row">
            <button
              aria-label={`${link.name} kopieren`}
              className="link-popup-name link-popup-click"
              onClick={() => copy(link.name, "Name kopiert")}
              title={`${link.name}\nKlicken zum Kopieren`}
              type="button"
            >
              {link.name}
            </button>
            <button
              aria-label="Link kopieren"
              className="link-popup-url link-popup-click"
              onClick={() => copy(link.url, "Link kopiert")}
              title={`${link.url}\nKlicken zum Kopieren`}
              type="button"
            >
              {link.url}
            </button>
          </div>
        ))}
      </div>
      <div className="modal-actions">
        {isPackage ? (
          <button className="btn" onClick={() => copy(links.map((link) => link.name).join("\n"), "Alle Namen kopiert")} type="button">
            Alle Namen kopieren
          </button>
        ) : null}
        {isPackage ? (
          <button className="btn" onClick={() => copy(links.map((link) => link.url).join("\n"), "Alle Links kopiert")} type="button">
            Alle Links kopieren
          </button>
        ) : null}
        <button className="btn" onClick={onClose} type="button">Schließen</button>
      </div>
    </Dialog>
  );
}
