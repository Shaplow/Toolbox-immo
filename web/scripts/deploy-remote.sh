#!/bin/bash
# =============================================================================
# deploy-remote.sh — Déployer une mise à jour sur le serveur (depuis ta machine)
# Lancer depuis ta machine locale (Git Bash / WSL)
#
# Usage :
#   bash scripts/deploy-remote.sh <IP_SERVEUR> [UTILISATEUR] [CLE_SSH]
#
# Exemples :
#   bash scripts/deploy-remote.sh 141.145.200.100
#   bash scripts/deploy-remote.sh 141.145.200.100 root ~/.ssh/hetzner_key
# =============================================================================
set -e

# Empêche tar sur macOS d'inclure les fichiers AppleDouble (._*) et métadonnées Finder.
export COPYFILE_DISABLE=1

SERVER_IP="${1}"
SSH_USER="${2:-root}"
SSH_KEY="${3:-}"

# Chemin racine du projet (parent du dossier web/)
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# ── Validation ───────────────────────────────────────────────────────────────
if [ -z "$SERVER_IP" ]; then
  echo "Usage : bash scripts/deploy-remote.sh <IP_SERVEUR> [UTILISATEUR] [CLE_SSH]"
  echo "Ex    : bash scripts/deploy-remote.sh 141.145.200.100"
  exit 1
fi

SSH_OPTS="-o StrictHostKeyChecking=accept-new"
if [ -n "$SSH_KEY" ]; then
  SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
fi

SSH_TARGET="${SSH_USER}@${SERVER_IP}"

echo "======================================================"
echo "  Toolbox Immo — Déploiement distant"
echo "  Serveur : $SSH_TARGET"
echo "======================================================"
echo ""

# ── Archive + scp + deploy ───────────────────────────────────────────────────
echo "▶ Création de l'archive du projet..."
TMP_ARCHIVE="/tmp/toolbox-deploy.tar.gz"
cd "${PROJECT_ROOT}"
tar czf "${TMP_ARCHIVE}" \
  --exclude='./.git' \
  --exclude='./web/node_modules' \
  --exclude='./web/.next' \
  --exclude='./web/public/fonts' \
  --exclude='._*' \
  --exclude='./**/._*' \
  --exclude='.DS_Store' \
  --exclude='./**/.DS_Store' \
  --exclude='./**/__pycache__' \
  --exclude='./**/*.pyc' \
  --exclude='./.env' \
  --exclude='./.env.*' \
  --exclude='./web/.env' \
  --exclude='./web/.env.local' \
  --exclude='./web/public/uploads' \
  --exclude='./web/public/renders' \
  --exclude='./web/public/transcription' \
  --exclude='./render-engine' \
  .

echo "▶ Envoi de l'archive vers le serveur..."
scp $SSH_OPTS "${TMP_ARCHIVE}" "${SSH_TARGET}:/tmp/toolbox-deploy.tar.gz"

# Envoi du fichier d'environnement prod (local uniquement, jamais dans l'archive)
ENV_PROD="${PROJECT_ROOT}/.env.prod"
if [ ! -f "${ENV_PROD}" ]; then
  echo "❌ Fichier .env.prod introuvable à la racine du projet !"
  echo "   Crée ce fichier avec les secrets de production avant de déployer."
  rm -f "${TMP_ARCHIVE}"
  exit 1
fi
echo "▶ Envoi de .env.prod..."
scp $SSH_OPTS "${ENV_PROD}" "${SSH_TARGET}:/tmp/toolbox-env-prod"

echo "▶ Extraction sur le serveur..."
ssh $SSH_OPTS "${SSH_TARGET}" "
  cd /var/www/toolbox
  rm -rf web/src web/scripts web/prisma/migrations
  tar xzf /tmp/toolbox-deploy.tar.gz && rm /tmp/toolbox-deploy.tar.gz
  mv /tmp/toolbox-env-prod /var/www/toolbox/web/.env.local
"

rm -f "${TMP_ARCHIVE}"

echo ""
echo "▶ Lancement deploy-app.sh..."
ssh $SSH_OPTS "${SSH_TARGET}" "cd /var/www/toolbox/web && bash scripts/deploy-app.sh"

echo ""
echo "======================================================"
echo "  ✅ Mise à jour déployée !"
echo "======================================================"
