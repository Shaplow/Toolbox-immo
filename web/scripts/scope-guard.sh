#!/usr/bin/env bash
# Scope guard du chantier feature/ui-boost.
#
# Échoue le commit si un fichier hors scope est touché. Le scope autorisé
# couvre uniquement la couche présentation (components, pages, layouts,
# styles, tailwind config et la doc design system). Toute autre zone du
# repo doit être laissée intacte pendant ce chantier (cf. plan).
#
# Override ponctuel justifié : commit avec `--no-verify`. Eviter sauf cas
# tordu (typo dans un commentaire de lib/ par ex) — sinon merge le hotfix
# sur main et rebase la branche.
#
# Installation : symlink ou copie en .git/hooks/pre-commit dans le worktree.

set -euo pipefail

STAGED_FILES="$(git diff --cached --name-only --diff-filter=ACMR)"
OFFENDERS=()

while IFS= read -r file; do
  [[ -z "$file" ]] && continue
  case "$file" in
    web/src/components/*|\
    web/src/app/\(app\)/*/page.tsx|\
    web/src/app/\(app\)/*/layout.tsx|\
    web/src/app/\(app\)/layout.tsx|\
    web/src/app/\(admin\)/**|\
    web/src/app/\(dev\)/**|\
    web/src/app/layout.tsx|\
    web/src/app/globals.css|\
    web/src/styles/*|\
    web/tailwind.config.*|\
    web/postcss.config.*|\
    web/docs/design-system.md|\
    web/package.json|\
    web/package-lock.json|\
    web/scripts/scope-guard.sh|\
    .gitignore|\
    .env.example)
      ;;
    *)
      OFFENDERS+=("$file")
      ;;
  esac
done <<< "$STAGED_FILES"

if [[ ${#OFFENDERS[@]} -gt 0 ]]; then
  echo "❌ feature/ui-boost scope-guard : ces fichiers sont hors scope du chantier UI :" >&2
  printf "   - %s\n" "${OFFENDERS[@]}" >&2
  echo >&2
  echo "Scope autorisé : web/src/components/, pages app/admin/dev, styles, tailwind config, docs/design-system.md." >&2
  echo "Si justifié : 'git commit --no-verify' (ou merge en hotfix sur main puis rebase)." >&2
  exit 1
fi

exit 0
