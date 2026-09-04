import type { OfflineSkipScope } from "../../../shared/types";

export function OfflineRemovalScopeChoice({ scope, english, onChange }: {
  scope: OfflineSkipScope;
  english: boolean;
  onChange: (scope: OfflineSkipScope) => void;
}) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: "16px 0", display: "grid", gap: 14 }}>
      <legend style={{ marginBottom: 12 }}>{english ? "What should be removed?" : "Was soll entfernt werden?"}</legend>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <input type="radio" name="offline-removal-scope" value="package" checked={scope === "package"} onChange={() => onChange("package")} />
        <span><strong>{english ? "Entire packages" : "Ganze Pakete"}</strong><br />
          {english ? "Remove the entire parent package as soon as one link is offline." : "Das gesamte übergeordnete Paket entfernen, sobald ein Link offline ist."}
        </span>
      </label>
      <label style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>
        <input type="radio" name="offline-removal-scope" value="archive" checked={scope === "archive"} onChange={() => onChange("archive")} />
        <span><strong>{english ? "Only affected archive sets" : "Nur betroffene Archivsätze"}</strong><br />
          {english ? "Remove all parts of the affected episode or archive. Other episodes in the package remain." : "Alle Parts der betroffenen Folge oder des Archivs entfernen. Andere Folgen im Paket bleiben erhalten."}
        </span>
      </label>
      <p style={{ margin: 0 }}>{english ? "Active downloads being removed will stop. Downloaded files are kept in both cases." : "Die zu entfernenden laufenden Downloads werden gestoppt. Heruntergeladene Dateien bleiben in beiden Fällen erhalten."}</p>
    </fieldset>
  );
}
