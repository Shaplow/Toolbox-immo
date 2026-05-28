import type { Page } from "@playwright/test";

/**
 * Helpers d'authentification pour les tests E2E.
 *
 * Les credentials proviennent du seed test-db (cf scripts/seed-test-db.ts).
 * Tous les comptes ont le password "testpass".
 */

export const TEST_USERS = {
  admin: {
    email: "admin@test.local",
    username: "test_admin",
    password: "testpass",
    role: "ADMIN" as const,
  },
  monteur: {
    email: "monteur@test.local",
    username: "test_monteur",
    password: "testpass",
    role: "MONTEUR" as const,
  },
  cm: {
    email: "cm@test.local",
    username: "test_cm",
    password: "testpass",
    role: "CM" as const,
  },
  videaste: {
    email: "videaste@test.local",
    username: "test_videaste",
    password: "testpass",
    role: "VIDEASTE" as const,
  },
  user: {
    email: "user@test.local",
    username: "test_user",
    password: "testpass",
    role: "EXTERNAL_GENERATOR" as const,
  },
} as const;

export type TestUserKey = keyof typeof TEST_USERS;

/**
 * Connecte un utilisateur via la page de login (credentials NextAuth).
 * Attend la redirection vers `/home` ou autre page post-login.
 */
export async function loginAs(page: Page, userKey: TestUserKey): Promise<void> {
  const user = TEST_USERS[userKey];

  await page.goto("/login");

  // Les inputs login sont typiquement <input name="username"> et <input name="password">.
  // À ajuster si le markup diffère.
  await page.fill('input[name="username"], input[type="text"]', user.username);
  await page.fill('input[name="password"], input[type="password"]', user.password);
  await page.click('button[type="submit"]');

  // Attente de la redirection post-login (NextAuth → /home par défaut)
  await page.waitForURL(/\/home/, { timeout: 10_000 });
}

/**
 * Déconnecte l'utilisateur courant (appel à l'endpoint NextAuth signout).
 */
export async function logout(page: Page): Promise<void> {
  await page.goto("/api/auth/signout");
  // Bouton "Sign out" sur la page NextAuth — submit
  const signOutButton = page.locator('button:has-text("Sign out"), button:has-text("Se déconnecter")');
  if (await signOutButton.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await signOutButton.click();
  }
}
