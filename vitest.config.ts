import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    passWithNoTests: true,
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx", "scripts/tests/**/*.test.ts"],
    globals: true
  }
});
