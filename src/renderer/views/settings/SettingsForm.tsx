import { cloneElement, useEffect, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type ReactElement } from "react";
import { getSettingsSelectNavigationIndex } from "./settings-model";
import type {
  SettingsFieldViewModel,
  SettingsFormViewModel,
  SettingsSelectFieldViewModel,
  SettingsTextFieldViewModel
} from "./settings-model";

export interface SettingsFormActions {
  onChange: (fieldId: string, value: string | boolean) => void;
  onAction: (fieldId: string) => void;
  onCommit?: (fieldId: string, value: string) => void;
}

export interface SettingsFormProps {
  model: SettingsFormViewModel;
  actions: SettingsFormActions;
}

function FieldHelp({ field }: { field: SettingsFieldViewModel }): ReactElement | null {
  return field.help ? <span className="settings-field-help" id={`${field.id}-help`}>{field.help}</span> : null;
}

function TextControl({ field, actions }: { field: SettingsTextFieldViewModel; actions: SettingsFormActions }): ReactElement {
  const describedBy = field.help ? `${field.id}-help` : undefined;
  const onChange = (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    actions.onChange(field.id, event.target.value);
  };
  const control = field.kind === "textarea" ? (
    <textarea
      aria-describedby={describedBy}
      className="settings-control settings-textarea"
      disabled={field.disabled}
      id={field.id}
      onChange={onChange}
      onBlur={field.commitOnBlur ? (event) => actions.onCommit?.(field.id, event.target.value) : undefined}
      placeholder={field.placeholder}
      rows={4}
      value={field.value}
    />
  ) : (
    <input
      aria-describedby={describedBy}
      className={`settings-control${field.kind === "path" ? " settings-copyable" : ""}`}
      disabled={field.disabled}
      id={field.id}
      inputMode={field.inputMode}
      max={field.max}
      min={field.min}
      onChange={onChange}
      onBlur={field.commitOnBlur ? (event) => actions.onCommit?.(field.id, event.target.value) : undefined}
      placeholder={field.placeholder}
      step={field.step}
      type={field.kind === "number" ? "number" : "text"}
      value={field.value}
    />
  );
  return (
    <div className="settings-field">
      <label htmlFor={field.id}>{field.label}</label>
      {field.actionLabel ? (
        <div className="settings-control-row">
          {control}
          <button
            className="settings-button settings-button-secondary"
            disabled={field.disabled}
            onClick={() => actions.onAction(field.id)}
            type="button"
          >{field.actionLabel}</button>
        </div>
      ) : control}
      <FieldHelp field={field} />
    </div>
  );
}

function SelectControl({ field, actions }: { field: SettingsSelectFieldViewModel; actions: SettingsFormActions }): ReactElement {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const selected = field.options.find((option) => option.value === field.value) ?? field.options[0];
  const selectedIndex = Math.max(0, field.options.findIndex((option) => option.value === selected?.value));

  const focusOption = (nextIndex: number): void => {
    requestAnimationFrame(() => optionRefs.current[nextIndex]?.focus());
  };

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event: globalThis.KeyboardEvent): void => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const nextIndex = getSettingsSelectNavigationIndex(selectedIndex, field.options.length, event.key);
      setOpen(true);
      focusOption(nextIndex);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((current) => !current);
      if (!open) focusOption(selectedIndex);
    }
  };

  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home" || event.key === "End") {
      event.preventDefault();
      const nextIndex = getSettingsSelectNavigationIndex(index, field.options.length, event.key);
      focusOption(nextIndex);
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    }
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  };

  return (
    <div className="settings-field">
      <label id={`${field.id}-label`}>{field.label}</label>
      <div className={`settings-select${open ? " is-open" : ""}${field.disabled ? " is-disabled" : ""}`} onBlur={onBlur} ref={rootRef}>
        <button
          aria-controls={`${field.id}-options`}
          aria-expanded={open}
          aria-haspopup="listbox"
          aria-labelledby={`${field.id}-label`}
          className="settings-select-trigger"
          disabled={field.disabled}
          id={field.id}
          onClick={() => setOpen((current) => !current)}
          onKeyDown={onKeyDown}
          ref={triggerRef}
          role="combobox"
          type="button"
        >
          <span>{selected?.label ?? ""}</span>
          <span aria-hidden="true" className="settings-select-chevron">⌄</span>
        </button>
        <div aria-hidden={!open} className="settings-select-options" id={`${field.id}-options`} role="listbox">
          {field.options.map((option, index) => (
            <button
              aria-selected={field.value === option.value}
              className={`settings-select-option${field.value === option.value ? " is-selected" : ""}`}
              key={option.value}
              onClick={() => {
                actions.onChange(field.id, option.value);
                setOpen(false);
              }}
              onKeyDown={(event) => onOptionKeyDown(event, index)}
              ref={(element) => { optionRefs.current[index] = element; }}
              role="option"
              type="button"
            >{option.label}</button>
          ))}
        </div>
      </div>
      <FieldHelp field={field} />
    </div>
  );
}

function SettingsField({ field, actions }: { field: SettingsFieldViewModel; actions: SettingsFormActions }): ReactElement {
  if (field.kind === "text" || field.kind === "path" || field.kind === "number" || field.kind === "textarea") {
    return <TextControl actions={actions} field={field} />;
  }
  if (field.kind === "select") {
    return <SelectControl actions={actions} field={field} />;
  }
  if (field.kind === "theme") {
    return (
      <fieldset className="settings-field settings-theme-field" disabled={field.disabled}>
        <legend>{field.label}</legend>
        <div aria-describedby={field.help ? `${field.id}-help` : undefined} className="settings-theme-options" role="radiogroup">
          {field.options.map((option) => (
            <button
              aria-checked={field.value === option.value}
              className={`settings-theme-option${field.value === option.value ? " is-active" : ""}`}
              key={option.value}
              onClick={() => actions.onChange(field.id, option.value)}
              role="radio"
              type="button"
            >
              <span aria-hidden="true" className={`settings-theme-preview is-${option.value}`} />
              <span>{option.label}</span>
            </button>
          ))}
        </div>
        <FieldHelp field={field} />
      </fieldset>
    );
  }
  if (field.kind === "switch") {
    return (
      <div className="settings-field settings-switch-field">
        <div>
          <span className="settings-switch-label" id={`${field.id}-label`}>{field.label}</span>
          <FieldHelp field={field} />
        </div>
        <button
          aria-checked={field.value}
          aria-describedby={field.help ? `${field.id}-help` : undefined}
          aria-labelledby={`${field.id}-label`}
          className={`settings-switch${field.value ? " is-on" : ""}`}
          disabled={field.disabled}
          onClick={() => actions.onChange(field.id, !field.value)}
          role="switch"
          type="button"
        ><span /></button>
      </div>
    );
  }
  return (
    <div className="settings-field settings-action-field">
      <div>
        <span className="settings-switch-label">{field.label}</span>
        <FieldHelp field={field} />
      </div>
      <button
        className="settings-button settings-button-secondary"
        disabled={field.disabled}
        onClick={() => actions.onAction(field.id)}
        type="button"
      >{field.actionLabel}</button>
    </div>
  );
}

export function SettingsForm({ model, actions }: SettingsFormProps): ReactElement {
  return (
    <div className="settings-form-column">
      <header className="settings-form-heading">
        <h2>{model.title}</h2>
        <p>{model.description}</p>
      </header>
      {model.groups.map((group) => (
        <section className="settings-form-group" key={group.id}>
          <header>
            <h3>{group.title}</h3>
            {group.description ? <p>{group.description}</p> : null}
          </header>
          <div className="settings-form-fields">
            {group.fields.map((field) => cloneElement(SettingsField({ actions, field }), { key: field.id }))}
          </div>
        </section>
      ))}
    </div>
  );
}
