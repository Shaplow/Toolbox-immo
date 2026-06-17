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
  // DA v3 (15/06) — Anti-drift Coastal Studio : interdit la réintroduction
  // des classes pastel `bg-(peach|sage)-XX` qui n'ont plus de tokens définis
  // depuis le passage flat shadcn. `sky` et `rose` restent autorisés (Tailwind
  // natifs) mais à utiliser avec parcimonie — préférer info / danger semantic.
  //
  // Override ponctuel pour un cas hors `ui/` : `// eslint-disable-next-line no-restricted-syntax`.
  {
    files: ["src/**/*.{ts,tsx}"],
    ignores: [
      "src/components/ui/**",
      "src/app/(dev)/playground/**",
      "**/__tests__/**",
    ],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          selector:
            "Literal[value=/\\b(bg|text|border|ring|from|to|via)-(peach|sage)-/]",
          message:
            "Palette Coastal Studio jetée en DA v3. Utilise warning-* (peach) ou success-* (sage) à la place. Voir src/app/globals.css.",
        },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
