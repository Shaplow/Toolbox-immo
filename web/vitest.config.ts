/// <reference types="vitest" />
import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  test: {
    // Tests unit (helpers purs, pas d'env browser, pas de DB).
    // Pour les tests E2E avec browser, on utilise Playwright (cf web/e2e/).
    environment: "node",
    include: ["src/**/__tests__/**/*.test.ts", "src/**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/e2e/**", "**/.next/**"],
    reporters: ["default"],
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["src/lib/**"],
      exclude: ["src/lib/**/__tests__/**", "src/lib/prisma.ts"],
    },
  },
  resolve: {
    alias: {
      "@": resolve(__dirname, "./src"),
    },
  },
});
