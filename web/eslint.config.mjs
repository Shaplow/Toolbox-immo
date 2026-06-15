import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // V7.1 — Playground = showcase dev pas user-facing. Désactive la règle
  // `react/no-unescaped-entities` qui produit beaucoup de bruit lint sur du
  // texte démo français (apostrophes naturelles). Aucun impact runtime.
  {
    files: ["src/app/(dev)/playground/**/*.tsx"],
    rules: {
      "react/no-unescaped-entities": "off",
    },
  },
  // V2 (15/06) — Anti-drift "glass inline" : interdit de copier-coller le
  // pattern `bg-(white|black)/XX backdrop-blur` hors de `src/components/ui/`.
  // L'audit Explore avant V2 a recensé ~90 instances de ce drift ; les
  // primitives `GlassBanner` (sections contextuelles), `KPIPill` (indicateurs
  // chiffrés), `PageShell` (wrapper page) et `Banner` (signaux système)
  // couvrent les 3 usages dominants. Toute nouvelle inline = bypass d'une
  // primitive existante (ou besoin de créer une 5e).
  //
  // Heuristique simple : on flag les literals contenant `backdrop-blur` ET
  // une opacité Tailwind blanc/noir (5x..89). Faux négatifs acceptés sur les
  // template strings concaténées ; on prend le top du gain. Override ponctuel
  // pour un cas légitime hors `ui/` : `// eslint-disable-next-line no-restricted-syntax`.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/components/ui/**",
      "src/components/layout/**",
      "src/app/(dev)/playground/**",
      "**/__tests__/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "Literal[value=/bg-(white|black)\\/(5[0-9]|[6-8][0-9]).*backdrop-blur/]",
          message:
            "Utilise <GlassBanner>, <KPIPill>, <PageShell> ou <Banner> au lieu d'une glass inline. Voir src/components/ui/{GlassBanner,PageShell,Banner}.tsx + molecules/KPIPill.tsx.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
