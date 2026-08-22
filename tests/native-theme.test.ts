import { describe, expect, it } from "vitest";
import { forceDarkNativeTheme } from "../src/main/native-theme";

describe("native window theme", () => {
  it("forces the native Windows title bar to use the dark theme", () => {
    const theme = { themeSource: "system" };

    forceDarkNativeTheme(theme);

    expect(theme.themeSource).toBe("dark");
  });
});
