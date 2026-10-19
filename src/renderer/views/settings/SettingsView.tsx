import type { ReactElement } from "react";
import {
  SETTINGS_SECTIONS,
  getSettingsSaveLabel,
  type SettingsFormViewModel,
  type SettingsSaveState,
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
          >{section.label}</button>
        ))}
      </SlidingSelection>
    </nav>
  );
}

export function SettingsContent({ model, actions }: SettingsViewProps): ReactElement {
  const saveLabel = getSettingsSaveLabel(model.saveState);
  const saveDisabled = model.saveInFlight || model.saveState === "clean" || model.saveState === "saved" || model.saveState === "saving";
  const discardDisabled = model.saveInFlight || model.saveState === "clean" || model.saveState === "saved" || model.saveState === "saving";
  return (
    <section aria-label="Einstellungsbereich" className="settings-content settings-static">
      <header className="settings-content-header">
        <div>
          <h1>Einstellungen</h1>
          <span aria-live="polite" className={`settings-save-state is-${model.saveState}`} role="status">{saveLabel}</span>
        </div>
        <div className="settings-content-actions">
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
      <div className={`settings-content-body${model.section === "accounts" ? " is-accounts" : ""}`}>
        {model.section === "accounts"
          ? <AccountWorkspace actions={actions.accounts} model={model.accounts} />
          : <SettingsForm actions={actions.form} model={model.form} />}
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
