#!/usr/bin/env bash
# Scope guard du chantier UI boost.
#
# Active UNIQUEMENT si le fichier `.ui-boost-active` existe à la racine
# du repo (toggle manuel). Sans ce toggle, le hook est transparent et
# n'interfère pas avec les commits normaux.
#
# Workflow :
#   touch .ui-boost-active    # début de session chantier UI
#   git commit ...            # protégé : seul le scope présentation passe
#   rm .ui-boost-active       # fin de session (ou tu veux toucher lib/api)
#
# Quand actif, échoue le commit si un fichier hors scope est touché. Le
# scope autorisé couvre uniquement la couche présentation (components,
# pages, layouts, styles, tailwind config et la doc design system).
#
# Override ponctuel : `git commit --no-verify`. À éviter — supprime
# plutôt le toggle puis re-commit.

set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

# Inactif si pas de toggle — laisse passer tous les commits.
[[ -f "$REPO_ROOT/.ui-boost-active" ]] || exit 0

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
  echo "❌ ui-boost scope-guard : ces fichiers sont hors scope du chantier UI :" >&2
  printf "   - %s\n" "${OFFENDERS[@]}" >&2
  echo >&2
  echo "Scope autorisé : web/src/components/, pages app/admin/dev, styles, tailwind config, docs/design-system.md." >&2
  echo "Pour commit hors scope : 'rm .ui-boost-active' puis re-commit." >&2
  echo "Ou ponctuellement : 'git commit --no-verify'." >&2
  exit 1
fi

exit 0
