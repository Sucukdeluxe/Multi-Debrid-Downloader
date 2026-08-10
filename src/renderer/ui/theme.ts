export type UiTheme = "dark" | "light";

export const UI_THEME_VARIABLES = [
  "--ui-canvas",
  "--ui-surface",
  "--ui-input",
  "--ui-table-header",
  "--ui-active",
  "--ui-hover",
  "--ui-tooltip",
  "--ui-border",
  "--ui-text",
  "--ui-text-secondary",
  "--ui-text-muted",
  "--ui-primary",
  "--ui-primary-hover",
  "--ui-accent",
  "--ui-warning",
  "--ui-danger",
  "--ui-modal-secondary",
  "--ui-overlay"
] as const;

export type UiThemeVariable = (typeof UI_THEME_VARIABLES)[number];

export const UI_FOCUS_RING_VARIABLE: UiThemeVariable = "--ui-accent";

type UiThemeVariables = Readonly<Record<UiThemeVariable, string>>;

const darkThemeVariables: UiThemeVariables = Object.freeze({
  "--ui-canvas": "#0F0F0F",
  "--ui-surface": "#232323",
  "--ui-input": "#2B2B2B",
  "--ui-table-header": "#313131",
  "--ui-active": "#333436",
  "--ui-hover": "#373535",
  "--ui-tooltip": "#4F4D4D",
  "--ui-border": "#3D3D3D",
  "--ui-text": "#FFFFFF",
  "--ui-text-secondary": "#EAEDF3",
  "--ui-text-muted": "#919191",
  "--ui-primary": "#BAD0FC",
  "--ui-primary-hover": "#8AA5DC",
  "--ui-accent": "#3886FF",
  "--ui-warning": "#F1C786",
  "--ui-danger": "#F06464",
  "--ui-modal-secondary": "#35383D",
  "--ui-overlay": "rgba(0, 0, 0, 0.60)"
});

const lightThemeVariables: UiThemeVariables = Object.freeze({
  "--ui-canvas": "#F3F4F6",
  "--ui-surface": "#FFFFFF",
  "--ui-input": "#F7F8FA",
  "--ui-table-header": "#E7E9ED",
  "--ui-active": "#DEE6F5",
  "--ui-hover": "#E8ECF3",
  "--ui-tooltip": "#35383D",
  "--ui-border": "#D0D4DB",
  "--ui-text": "#181A1F",
  "--ui-text-secondary": "#343842",
  "--ui-text-muted": "#667085",
  "--ui-primary": "#A9C2F3",
  "--ui-primary-hover": "#8AA5DC",
  "--ui-accent": "#256FDB",
  "--ui-warning": "#E8B85D",
  "--ui-danger": "#D94747",
  "--ui-modal-secondary": "#E7E9ED",
  "--ui-overlay": "rgba(0, 0, 0, 0.45)"
});

const themes: Readonly<Record<UiTheme, UiThemeVariables>> = Object.freeze({
  dark: darkThemeVariables,
  light: lightThemeVariables
});

export function getThemeVariables(theme: UiTheme): Readonly<Record<string, string>> {
  return themes[theme];
}
