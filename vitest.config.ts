import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    conditions: ["development"]
  },
  esbuild: {
    jsx: "automatic"
  },
  test: {
    include: [
      "labs/**/*.test.ts",
      "packages/**/*.test.ts",
      "packages/**/*.test.tsx",
      "plugins/**/*.test.ts",
      "plugins/**/*.test.tsx",
      "apps/**/*.test.ts",
      "apps/**/*.test.tsx"
    ]
  }
});
