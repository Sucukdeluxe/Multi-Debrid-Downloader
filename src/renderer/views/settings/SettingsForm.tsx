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

export type SettingsSelectKeyboardAction =
  | { type: "close" }
  | { type: "focus"; index: number }
  | null;

export function getSettingsSelectKeyboardAction(
  key: string,
  currentIndex: number,
  optionCount: number
): SettingsSelectKeyboardAction {
  if (key === "Escape") {
    return { type: "close" };
  }
  if (key === "ArrowDown" || key === "ArrowUp" || key === "Home" || key === "End") {
    return { type: "focus", index: getSettingsSelectNavigationIndex(currentIndex, optionCount, key) };
  }
  return null;
}

export function closeSettingsSelectAndRestoreFocus(
  close: () => void,
  trigger: Pick<HTMLButtonElement, "focus"> | null
): void {
  close();
  trigger?.focus();
}

function getThemeNavigationIndex(currentIndex: number, optionCount: number, key: string): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") {
    return getSettingsSelectNavigationIndex(currentIndex, optionCount, "ArrowDown");
  }
  if (key === "ArrowLeft" || key === "ArrowUp") {
    return getSettingsSelectNavigationIndex(currentIndex, optionCount, "ArrowUp");
  }
  if (key === "Home" || key === "End") {
    return getSettingsSelectNavigationIndex(currentIndex, optionCount, key);
  }
  return null;
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

  const closeAndRestoreFocus = (): void => {
    closeSettingsSelectAndRestoreFocus(() => setOpen(false), triggerRef.current);
  };

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) setOpen(false);
    };
    window.addEventListener("mousedown", close);
    return () => {
      window.removeEventListener("mousedown", close);
    };
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>): void => {
    const action = getSettingsSelectKeyboardAction(event.key, selectedIndex, field.options.length);
    if (action?.type === "focus") {
      event.preventDefault();
      setOpen(true);
      focusOption(action.index);
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      setOpen((current) => !current);
      if (!open) focusOption(selectedIndex);
    }
  };

  const onOptionKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    const action = getSettingsSelectKeyboardAction(event.key, index, field.options.length);
    if (action?.type === "focus") {
      event.preventDefault();
      focusOption(action.index);
    }
  };

  const onSelectKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (!open || getSettingsSelectKeyboardAction(event.key, selectedIndex, field.options.length)?.type !== "close") {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    closeAndRestoreFocus();
  };

  const onBlur = (event: FocusEvent<HTMLDivElement>): void => {
    if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false);
  };

  return (
    <div className="settings-field">
      <label id={`${field.id}-label`}>{field.label}</label>
      <div className={`settings-select${open ? " is-open" : ""}${field.disabled ? " is-disabled" : ""}`} onBlur={onBlur} onKeyDown={onSelectKeyDown} ref={rootRef}>
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
                closeAndRestoreFocus();
              }}
              onKeyDown={(event) => onOptionKeyDown(event, index)}
              ref={(element) => { optionRefs.current[index] = element; }}
              role="option"
              tabIndex={-1}
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
    const selectedIndex = Math.max(0, field.options.findIndex((option) => option.value === field.value));
    return (
      <fieldset className="settings-field settings-theme-field" disabled={field.disabled}>
        <legend id={`${field.id}-label`}>{field.label}</legend>
        <div aria-describedby={field.help ? `${field.id}-help` : undefined} aria-labelledby={`${field.id}-label`} className="settings-theme-options" role="radiogroup">
          {field.options.map((option, index) => (
            <button
              aria-checked={field.value === option.value}
              className={`settings-theme-option${field.value === option.value ? " is-active" : ""}`}
              key={option.value}
              onClick={() => actions.onChange(field.id, option.value)}
              onKeyDown={(event) => {
                const nextIndex = getThemeNavigationIndex(index, field.options.length, event.key);
                if (nextIndex === null) {
                  return;
                }
                event.preventDefault();
                const group = event.currentTarget.closest('[role="radiogroup"]');
                const radios = group?.querySelectorAll<HTMLElement>('[role="radio"]');
                radios?.[nextIndex]?.focus();
                actions.onChange(field.id, field.options[nextIndex].value);
              }}
              role="radio"
              tabIndex={index === selectedIndex ? 0 : -1}
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
