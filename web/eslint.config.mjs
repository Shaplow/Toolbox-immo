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
  // Chantier date FR (18/08) — même logique anti-drift pour le formatage de
  // date : `lib/date/formatFr.ts` existait déjà mais était dupliqué en
  // toLocaleDateString ad hoc dans ~25 fichiers. Nouveaux appels → utiliser/
  // étendre les helpers de `lib/date/formatFr.ts`.
  //
  // IMPORTANT : les deux règles ci-dessous doivent rester dans le MÊME bloc
  // `no-restricted-syntax` — deux blocs distincts qui matchent les mêmes
  // fichiers et configurent la même règle s'écrasent l'un l'autre en flat
  // config (le dernier gagne intégralement, pas de merge d'array).
  //
  // Override ponctuel : `// eslint-disable-next-line no-restricted-syntax`.
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
        {
          selector:
            "CallExpression[callee.type='MemberExpression'][callee.property.name='toLocaleDateString']",
          message:
            "toLocaleDateString direct interdit hors lib/date/formatFr.ts (fuseau Europe/Paris non garanti, drift de format). Utilise dateFr/dateFrLong/shortDateFr/... ou ajoute un helper dédié dans lib/date/formatFr.ts.",
        },
      ],
    },
  },
  // lib/date/formatFr.ts est le seul fichier autorisé à appeler
  // toLocaleDateString — hors du scope de l'ignore ci-dessus (qui ne couvre
  // que components/ui, playground, tests).
  {
    files: ["src/lib/date/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": "off",
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
