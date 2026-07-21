import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  resolve: {
    // Mirror tsconfig's "@/*" alias.
    alias: { "@": path.resolve(__dirname) },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
