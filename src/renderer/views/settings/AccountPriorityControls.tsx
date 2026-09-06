import type { ReactElement } from "react";
import type { AccountSelectionMode } from "../../../shared/account-usage-rules";

export interface AccountPriorityModel {
  mode: AccountSelectionMode;
  accounts: readonly { id: string; label: string; mode: string; status: string }[];
}

export function AccountPriorityControls({ provider, model, busy, onModeChange, onMove }: {
  provider: string;
  model: AccountPriorityModel;
  busy: boolean;
  onModeChange?: (provider: string, mode: AccountSelectionMode) => void;
  onMove?: (provider: string, accountId: string, targetId: string) => void;
}): ReactElement {
  const locale = typeof document !== "undefined" && document.documentElement.lang === "de" ? "de-DE" : "en-US";
  return <details className="settings-account-priority" onDragStart={(event) => event.stopPropagation()} onDragOver={(event) => event.stopPropagation()} onDrop={(event) => event.stopPropagation()}>
    <summary>Account-Reihenfolge</summary>
    <fieldset disabled={busy} className="settings-account-priority-mode">
      <legend>Account-Auswahl</legend>
      {(["automatic", "priority"] as const).map((mode) => <label key={mode}>
        <input type="radio" name={`account-selection-${provider}`} checked={model.mode === mode} disabled={!onModeChange} onChange={() => onModeChange?.(provider, mode)} />
        {mode === "automatic" ? "Automatisch verteilen" : "Feste Reihenfolge"}
      </label>)}
    </fieldset>
    <p>{model.mode === "priority" ? "Der erste nutzbare Account hat Vorrang. Gesperrte Accounts werden übersprungen; laufende Downloads bleiben unverändert." : "Die bisherige automatische Account-Verteilung bleibt aktiv. Die Reihenfolge gilt erst im Modus Feste Reihenfolge."}</p>
    <ol aria-label="Account-Prioritäten">
      {model.accounts.map((account, index) => <li key={account.id} data-priority-account={account.id} draggable={!busy && Boolean(onMove)}
        onDragStart={(event) => { event.stopPropagation(); event.dataTransfer.effectAllowed = "move"; event.dataTransfer.setData("application/x-mdd-account-priority", JSON.stringify({ provider, id: account.id })); }}
        onDragOver={(event) => { event.stopPropagation(); if (!busy && event.dataTransfer.types.includes("application/x-mdd-account-priority")) event.preventDefault(); }}
        onDrop={(event) => {
          event.stopPropagation();
          if (busy) return;
          event.preventDefault();
          try {
            const source = JSON.parse(event.dataTransfer.getData("application/x-mdd-account-priority"));
            if (source.provider === provider && model.accounts.some((candidate) => candidate.id === source.id)) onMove?.(provider, source.id, account.id);
          } catch {}
        }}>
        <span className="settings-account-priority-identity"><span aria-hidden="true">{(index + 1).toLocaleString(locale)}.</span> <span>{account.label}</span><small>{account.mode} · {account.status}</small></span>
        <span className="settings-provider-order-actions">
          <button type="button" disabled={busy || !onMove || index === 0} aria-label={`${account.label} nach oben`} onClick={() => onMove?.(provider, account.id, model.accounts[index - 1].id)}>↑</button>
          <button type="button" disabled={busy || !onMove || index === model.accounts.length - 1} aria-label={`${account.label} nach unten`} onClick={() => onMove?.(provider, account.id, model.accounts[index + 1].id)}>↓</button>
        </span>
      </li>)}
    </ol>
    {model.accounts.length === 0 ? <p>Keine Accounts vorhanden.</p> : null}
  </details>;
}
