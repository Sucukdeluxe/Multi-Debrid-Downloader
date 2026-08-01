import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts", "scripts/tests/**/*.test.ts"],
    globals: true
  }
});
