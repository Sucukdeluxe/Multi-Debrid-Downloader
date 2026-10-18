import { useEffect, useState } from "react";
import type { McpConfiguration, McpScope, McpStatus } from "../../shared/mcp";
import { Dialog } from "./Dialog";

export function McpDialog({ onClose, language }: { onClose(): void; language: string }) {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [form, setForm] = useState<McpConfiguration | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [code, setCode] = useState("");
  const t = (de: string, en: string) => language === "en" ? en : de;
  useEffect(() => {
    let active = true;
    const refresh = async () => {
      try {
        const next = await window.rd.getMcpStatus();
        if (active && next) { setStatus(next); setForm(previous => previous || next); }
      } catch { if (active) setError(language === "en" ? "MCP status could not be loaded." : "MCP-Status konnte nicht geladen werden."); }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 3000);
    return () => { active = false; clearInterval(timer); };
  }, [language]);
  const save = async (enabled: boolean, rotate = false) => {
    if (!form) return;
    setBusy(true); setError(""); setCode("");
    try {
      const next = rotate ? await window.rd.rotateMcp() : await window.rd.configureMcp({ enabled, relayUrl: form.relayUrl, name: form.name, scopes: form.scopes, extraRoots: form.extraRoots });
      setStatus(next); setForm(next);
    } catch (reason) { setError(String(reason)); }
    finally { setBusy(false); }
  };
  const toggle = (scope: McpScope, checked: boolean) => setForm(previous => previous ? { ...previous, scopes: checked ? [...new Set([...previous.scopes, scope])] : previous.scopes.filter(entry => entry !== scope && !(scope === "files" && entry === "transfer") && !(scope === "control" && (entry === "updates" || entry === "extraction"))) } : previous);
  const states: Record<McpStatus["connection"], string> = {
    disabled: t("Deaktiviert", "Disabled"), connecting: t("Verbindung wird hergestellt", "Connecting"), online: t("Verbunden", "Connected"), offline: t("Nicht verbunden", "Disconnected"), blocked: t("Zugriff blockiert", "Access blocked")
  };
  return <Dialog actions={null} open className="mcp-access-dialog" title={t("MCP-Fernzugriff", "MCP remote access")} onClose={onClose}>
    <p>{t("Optionaler Fernzugriff auf diese laufende Installation. Der Verbindungscode ist ein Zugangsschlüssel. Löschaktionen, Wiederherstellungen und andere kritische Änderungen benötigen zusätzlich eine Bestätigung auf diesem Rechner.", "Optional remote access to this running installation. The connection code is an access credential. Deletions, restores and other critical changes additionally require confirmation on this computer.")}</p>
    <div className="rd-status-line"><span className={`rd-dot${status?.connection === "online" ? " on" : ""}`} /><span>{status ? states[status.connection] : t("Status wird geladen …", "Loading status …")}</span></div>
    {status && <p className="rd-hint">{status.toolCount} {t("Funktionen", "tools")} · {status.activeRequests} {t("aktive Anfragen", "active requests")}</p>}
    {form && <>
      <div className="rd-field"><label htmlFor="mcp-name">{t("Name dieser Installation", "Installation name")}</label><input id="mcp-name" value={form.name} maxLength={100} disabled={busy} onChange={event => setForm({ ...form, name: event.target.value })} /></div>
      <div className="rd-field"><label htmlFor="mcp-relay">{t("Vermittlungsdienst (HTTPS)", "Relay service (HTTPS)")}</label><input id="mcp-relay" value={form.relayUrl} disabled={busy} onChange={event => setForm({ ...form, relayUrl: event.target.value })} /></div>
      <div className="rd-field"><label>{t("Berechtigungen", "Permissions")}</label>
        <label className="mcp-permission"><input type="checkbox" checked disabled /> {t("Status und Diagnose lesen", "Read status and diagnostics")}</label>
        <label className="mcp-permission"><input type="checkbox" checked={form.scopes.includes("control")} disabled={busy} onChange={event => toggle("control", event.target.checked)} /> {t("Downloads, Accounts und Einstellungen steuern", "Control downloads, accounts and settings")}</label>
        <label className="mcp-permission"><input type="checkbox" checked={form.scopes.includes("extraction")} disabled={busy || !form.scopes.includes("control")} onChange={event => toggle("extraction", event.target.checked)} /> {t("Entpacken und Archiv-Reparaturen ohne lokale Rückfrage ausführen", "Extract and repair archives without local confirmation")}</label>
        <span className="rd-hint">{t("Gilt nur für Entpacken und erneute Entpackversuche vorhandener Pakete. Integritätsprüfungen bleiben aktiv. Die eingestellten Konflikt- und Aufräumregeln gelten weiterhin, einschließlich des Löschens erfolgreich entpackter Archive. Paket-Resets und andere Löschaktionen bleiben separat bestätigungspflichtig.", "Applies only to extraction and extraction retries of existing packages. Integrity checks remain active. Configured conflict and cleanup rules still apply, including deletion of successfully extracted archives. Package resets and other deletions still require separate confirmation.")}</span>
        <label className="mcp-permission"><input type="checkbox" checked={form.scopes.includes("updates")} disabled={busy || !form.scopes.includes("control")} onChange={event => toggle("updates", event.target.checked)} /> {t("Offizielle Releases und signierte Direktupdates ohne lokale Rückfrage installieren und neu starten", "Install official releases and signed direct updates and restart without local confirmation")}</label>
        <span className="rd-hint">{t("Update-Freigabe ist standardmäßig aus und gilt nur für die installierte Windows-Version. Ein MCP-Auftrag muss die genaue Zielversion angeben. Laufende Downloads werden erst nach geprüftem Update-Download für den Neustart unterbrochen. Andere kritische Aktionen benötigen weiterhin eine Bestätigung.", "Update permission is off by default and requires the installed Windows edition. An MCP job must name the exact target version. Active downloads are parked for restart only after the update download is verified. Other critical actions still require confirmation.")}</span>
        <label className="mcp-permission"><input type="checkbox" checked={form.scopes.includes("files")} disabled={busy} onChange={event => toggle("files", event.target.checked)} /> {t("Dateien in freigegebenen Arbeitsordnern lesen und prüfen", "Read and verify files in approved work folders")}</label>
        <label className="mcp-permission"><input type="checkbox" checked={form.scopes.includes("transfer")} disabled={busy || !form.scopes.includes("files")} onChange={event => toggle("transfer", event.target.checked)} /> {t("Vollständige Dateien aus freigegebenen Arbeitsordnern übertragen", "Transfer complete files from approved work folders")}</label>
        <label className="mcp-permission"><input type="checkbox" checked={form.scopes.includes("secrets")} disabled={busy} onChange={event => toggle("secrets", event.target.checked)} /> {t("Zugangsdaten ausdrücklich auslesen / geheime Backups exportieren", "Explicitly reveal credentials / export secret backups")}</label>
        <span className="rd-hint">{t("Vollständige Dateiübertragung und Geheimniszugriff sind standardmäßig aus. Übertragene Nutzdateien sind unverändert und können vertrauliche Inhalte enthalten. Logs bleiben bereinigt; Anwendungsspeicher und Proxy-Zugangsdaten bleiben gesperrt. Kein Shell-Zugriff und kein direkter Netzwerk-Fallback bei Proxy-only.", "Complete file transfer and secret access are off by default. Transferred user files are unchanged and may contain private content. Logs remain redacted; application storage and proxy credentials remain blocked. No shell access or direct-network fallback in proxy-only mode.")}</span>
      </div>
      <div className="rd-field"><label htmlFor="mcp-roots">{t("Zusätzliche freigegebene Ordner (einer pro Zeile)", "Additional approved folders (one per line)")}</label><textarea id="mcp-roots" value={form.extraRoots.join("\n")} disabled={busy} onChange={event => setForm({ ...form, extraRoots: event.target.value.split(/\r?\n/).map(line => line.trim()).filter(Boolean) })} /><span className="rd-hint">{t("Ohne zusätzliche Freigaben sind nur konfigurierte Download-, Entpack-, Videosammel- und Logordner zugänglich. Schlüsseldateien bleiben gesperrt.", "Without additional grants only configured download, extraction, video-library and log folders are accessible. Credential files remain blocked.")}</span></div>
      {status?.enabled && <div className="rd-field">
        <button className="btn" disabled={busy} onClick={async () => { try { setCode(await window.rd.getMcpConnectionCode()); } catch (reason) { setError(String(reason)); } }}>{t("Verbindungscode anzeigen", "Show connection code")}</button>
        {code && <><input type="password" readOnly value={code} aria-label={t("Geheimer MCP-Verbindungscode", "Secret MCP connection code")} autoComplete="off" /><button className="btn" onClick={async () => { try { await window.rd.writeClipboardText(code); } catch (reason) { setError(String(reason)); } }}>{t("Verbindungscode kopieren", "Copy connection code")}</button></>}
        <span className="rd-hint">{t("Zunächst MCP einmalig in Codex einrichten. Der Code gilt nur für diese Installation und wird nicht in Sicherungen übernommen.", "Configure MCP in Codex once. This code belongs only to this installation and is not included in backups.")}</span>
      </div>}
    </>}
    {(error || status?.error) && <div className="online-backup-error">{error || status?.error}</div>}
    <div className="modal-actions">
      <button className="btn" onClick={onClose}>{t("Schließen", "Close")}</button>
      {status?.enabled && <><button className="btn danger" disabled={busy} onClick={() => { void save(false); }}>{t("Deaktivieren", "Disable")}</button><button className="btn" disabled={busy} onClick={() => { void save(true, true); }}>{t("Schlüssel erneuern", "Rotate key")}</button></>}
      <button className="btn accent" disabled={busy || !form} onClick={() => { void save(true); }}>{busy ? t("Wird gespeichert …", "Saving …") : status?.enabled ? t("Speichern", "Save") : t("Aktivieren", "Enable")}</button>
    </div>
  </Dialog>;
}
