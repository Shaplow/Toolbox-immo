#!/usr/bin/env bash
# Repair Prisma migration drift (idempotent).
#
# Use case : `npx prisma migrate deploy` refuse de tourner avec un message
# du type "migration was modified after it was applied". Cause habituelle :
# un fichier de migration a été édité (ou stubbé) après que la base ait été
# scaffold avec l'ancien contenu. Le checksum stocké dans `_prisma_migrations`
# ne matche plus le fichier sur disque.
#
# Ce script :
#   1. Cible 2 migrations historiques connues comme drifty (no-op SELECT 1).
#   2. Pour chacune : roll-back logique → re-mark applied (re-stamp checksum
#      avec le contenu actuel du fichier). Aucune écriture SQL DDL (les SQL
#      sont SELECT 1, donc rien ne change en base).
#   3. Lance `migrate deploy` pour appliquer les vraies migrations pendantes.
#
# Idempotent : si la drift n'existe pas (checksum déjà à jour), les commandes
# resolve sont silencieuses et migrate deploy tourne directement.
#
# Usage prod (depuis web/) :
#   bash scripts/repair-prisma-drift.sh
#
# Exit 0 si tout OK, exit non-zero sinon.

set -euo pipefail

DRIFTY_MIGRATIONS=(
  "20260527001418_add_slot_links_description_transcription"
  "20260527004317_add_description_prompt_recipe"
)

echo "[repair-prisma-drift] Vérification de l'état des migrations…"

# On utilise `migrate resolve --rolled-back` puis `--applied` pour re-stamp
# le checksum. Si la migration n'est pas en drift, ces commandes échouent
# silencieusement (Prisma refuse de rouler back ce qui est sain) — on tolère
# l'erreur via `|| true` car le but final est juste un état cohérent.

for mig in "${DRIFTY_MIGRATIONS[@]}"; do
  echo "[repair-prisma-drift] → $mig : re-stamp checksum (idempotent)"
  # roll-back échoue si la migration est en bon état → on tolère
  npx prisma migrate resolve --rolled-back "$mig" 2>/dev/null || true
  # applied échoue P3008 si déjà appliqué et checksum déjà à jour → on tolère
  npx prisma migrate resolve --applied    "$mig" 2>/dev/null || \
    echo "    (déjà appliqué et checksum à jour — rien à faire)"
done

echo "[repair-prisma-drift] Application des migrations pendantes…"
npx prisma migrate deploy

echo "[repair-prisma-drift] ✓ Migrations synchronisées."
