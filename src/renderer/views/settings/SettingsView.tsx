import { useEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from "react";
import type { AppLanguage } from "../../../shared/types";
import { translateUiText } from "../../i18n";
import {
  SETTINGS_SECTIONS,
  getSettingsSaveLabel,
  searchSettings,
  type SettingsFormViewModel,
  type SettingsSaveState,
  type SettingsSearchResult,
  type SettingsSection
} from "./settings-model";
import {
  AccountWorkspace,
  type AccountWorkspaceActions,
  type AccountWorkspaceViewModel
} from "./AccountWorkspace";
import { SettingsForm, type SettingsFormActions } from "./SettingsForm";
import { SlidingSelection } from "../../ui/SlidingSelection";
import "./settings.css";

export type SettingsViewRegion = "all" | "sidebar" | "content";

export interface SettingsViewModel {
  section: SettingsSection;
  saveState: SettingsSaveState;
  saveInFlight: boolean;
  form: SettingsFormViewModel;
  forms: Record<SettingsSection, SettingsFormViewModel>;
  language: AppLanguage;
  accounts: AccountWorkspaceViewModel;
}

export interface SettingsViewActions {
  onSectionChange: (section: SettingsSection) => void;
  onDiscard: () => void;
  onSave: () => void;
  form: SettingsFormActions;
  accounts: AccountWorkspaceActions;
}

export interface SettingsViewProps {
  model: SettingsViewModel;
  actions: SettingsViewActions;
  region?: SettingsViewRegion;
}

export function SettingsSidebar({ model, actions }: SettingsViewProps): ReactElement {
  return (
    <nav aria-label="Einstellungen" className="settings-sidebar" data-visual-region="settings-sidebar">
      <div className="settings-sidebar-heading">
        <strong>Einstellungen</strong>
      </div>
      <SlidingSelection activeKey={model.section} axis="vertical" className="settings-sidebar-list">
        {SETTINGS_SECTIONS.map((section) => (
          <button
            aria-current={model.section === section.id ? "page" : undefined}
            className={`settings-sidebar-item${model.section === section.id ? " is-active" : ""}`}
            data-sliding-selection-active={model.section === section.id}
            data-sliding-selection-item="true"
            key={section.id}
            onClick={() => actions.onSectionChange(section.id)}
            type="button"
          >
            <span className="settings-sidebar-item-label">{section.label}</span>
            <span className="settings-sidebar-item-hint">{section.hint}</span>
          </button>
        ))}
      </SlidingSelection>
    </nav>
  );
}

function SettingsSearchResults({ results, onOpen }: { results: readonly SettingsSearchResult[]; onOpen: (result: SettingsSearchResult) => void }): ReactElement {
  return (
    <div className="settings-form-column settings-search-results">
      <header className="settings-form-heading">
        <h2>Suchergebnisse</h2>
        <p>{results.length === 0 ? "Keine Einstellung gefunden." : "Ein Klick öffnet den Bereich und markiert die Einstellung."}</p>
      </header>
      {results.length === 0 ? null : (
        <ul className="settings-search-list">
          {results.map((result) => (
            <li key={`${result.section}:${result.fieldId}`}>
              <button className="settings-search-result" onClick={() => onOpen(result)} type="button">
                <span className="settings-search-result-label">{result.label}</span>
                <span className="settings-search-result-path">
                  {result.groupTitle ? (
                    <>
                      <span>{result.sectionLabel}</span>
                      <span aria-hidden="true">›</span>
                      <span>{result.groupTitle}</span>
                    </>
                  ) : <span>Bereich</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function SettingsContent({ model, actions }: SettingsViewProps): ReactElement {
  const [query, setQuery] = useState("");
  const [highlightFieldId, setHighlightFieldId] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const saveLabel = getSettingsSaveLabel(model.saveState);
  const saveDisabled = model.saveInFlight || model.saveState === "clean" || model.saveState === "saved" || model.saveState === "saving";
  const discardDisabled = model.saveInFlight || model.saveState === "clean" || model.saveState === "saved" || model.saveState === "saving";
  const searching = query.trim() !== "";
  const results = useMemo(
    () => searchSettings(model.forms, query, model.language === "en" ? (text) => translateUiText(text, "en") : undefined),
    [model.forms, model.language, query]
  );

  const openResult = (result: SettingsSearchResult): void => {
    actions.onSectionChange(result.section);
    setQuery("");
    setHighlightFieldId(result.fieldId || null);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "Escape" && query !== "") {
      event.preventDefault();
      event.stopPropagation();
      setQuery("");
    } else if (event.key === "Enter" && results.length > 0) {
      event.preventDefault();
      openResult(results[0]);
    }
  };

  useEffect(() => {
    if (!highlightFieldId || searching) return;
    const field = [...(bodyRef.current?.querySelectorAll<HTMLElement>("[data-settings-field]") ?? [])]
      .find((element) => element.dataset.settingsField === highlightFieldId);
    if (!field) return;
    field.scrollIntoView({ block: "center" });
    const timer = window.setTimeout(() => setHighlightFieldId(null), 2200);
    return () => window.clearTimeout(timer);
  }, [highlightFieldId, model.section, searching]);

  return (
    <section aria-label="Einstellungsbereich" className="settings-content settings-static">
      <header className="settings-content-header">
        <div>
          <h1>Einstellungen</h1>
          <span aria-live="polite" className={`settings-save-state is-${model.saveState}`} role="status">{saveLabel}</span>
        </div>
        <div className="settings-content-actions">
          <input
            aria-label="Einstellung suchen"
            className="settings-control settings-search-input"
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onSearchKeyDown}
            placeholder="Einstellung suchen"
            type="search"
            value={query}
          />
          <button
            className="settings-button settings-button-secondary settings-discard-button"
            disabled={discardDisabled}
            onClick={actions.onDiscard}
            title="Stellt den letzten gespeicherten Stand wieder her."
            type="button"
          >Änderungen verwerfen</button>
          <button
            className="settings-button settings-button-primary settings-save-button"
            disabled={saveDisabled}
            onClick={actions.onSave}
            type="button"
          >Einstellungen speichern</button>
        </div>
      </header>
      <nav aria-label="Bereiche" className="settings-section-tabs">
        {SETTINGS_SECTIONS.map((section) => (
          <button
            aria-current={model.section === section.id ? "page" : undefined}
            className={`settings-section-tab${model.section === section.id ? " is-active" : ""}`}
            key={section.id}
            onClick={() => {
              setQuery("");
              actions.onSectionChange(section.id);
            }}
            type="button"
          >{section.label}</button>
        ))}
      </nav>
      <div className={`settings-content-body${!searching && model.section === "accounts" ? " is-accounts" : ""}`} ref={bodyRef}>
        {searching
          ? <SettingsSearchResults onOpen={openResult} results={results} />
          : model.section === "accounts"
            ? <AccountWorkspace actions={actions.accounts} model={model.accounts} />
            : <SettingsForm actions={actions.form} highlightFieldId={highlightFieldId} model={model.form} />}
      </div>
    </section>
  );
}

export function SettingsView({ model, actions, region = "all" }: SettingsViewProps): ReactElement {
  if (region === "sidebar") {
    return <SettingsSidebar actions={actions} model={model} />;
  }
  if (region === "content") {
    return <SettingsContent actions={actions} model={model} />;
  }
  return (
    <div className="settings-view">
      <SettingsSidebar actions={actions} model={model} />
      <SettingsContent actions={actions} model={model} />
    </div>
  );
}
