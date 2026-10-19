export interface NativeThemeTarget {
  themeSource: string;
}

export function forceDarkNativeTheme(theme: NativeThemeTarget): void {
  theme.themeSource = "dark";
}
