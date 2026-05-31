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
