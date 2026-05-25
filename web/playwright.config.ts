import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright config pour les tests E2E Toolbox.
 *
 * Prérequis : la DB de test doit exister + être seedée
 *   npm run test:db:setup && npm run test:db:seed
 *
 * Playwright démarre automatiquement un serveur Next.js sur le port 3100
 * avec DATABASE_URL pointant vers toolbox_test (override de .env.local).
 * Le serveur est réutilisé entre runs (reuseExistingServer: true en local).
 */

const TEST_PORT = 3100;
const TEST_DB_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://toolbox:toolbox@localhost:5433/toolbox_test";

export default defineConfig({
  testDir: "./e2e",
  // Timeout par test (login + nav + assertions)
  timeout: 30_000,
  expect: { timeout: 5_000 },
  // Lance les tests en série par défaut (la DB est partagée + on simule
  // login/logout). Activer `fullyParallel` quand chaque test reset sa DB.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: process.env.CI ? "github" : "list",

  use: {
    baseURL: `http://localhost:${TEST_PORT}`,
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  webServer: {
    // Lance next dev avec DATABASE_URL pointant vers la DB de test.
    // `-p 3100` évite la collision avec un éventuel dev server sur 3000.
    command: `DATABASE_URL="${TEST_DB_URL}" NEXTAUTH_URL="http://localhost:${TEST_PORT}" next dev -p ${TEST_PORT}`,
    url: `http://localhost:${TEST_PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "pipe",
    stderr: "pipe",
  },
});
