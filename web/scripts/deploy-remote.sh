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
  --exclude='./web/node_modules' \
  --exclude='./web/.next' \
  --exclude='._*' \
  --exclude='./**/._*' \
  --exclude='.DS_Store' \
  --exclude='./**/.DS_Store' \
  --exclude='./**/__pycache__' \
  --exclude='./**/*.pyc' \
  --exclude='./.env' \
  --exclude='./.env.local' \
  --exclude='./web/.env' \
  --exclude='./web/.env.local' \
  --exclude='./web/public/uploads' \
  --exclude='./web/public/renders' \
  --exclude='./render-engine/outputs' \
  --exclude='./venv' \
  --exclude='./render-engine/venv' \
  .

echo "▶ Envoi de l'archive vers le serveur..."
scp $SSH_OPTS "${TMP_ARCHIVE}" "${SSH_TARGET}:/tmp/toolbox-deploy.tar.gz"

echo "▶ Extraction sur le serveur..."
ssh $SSH_OPTS "${SSH_TARGET}" "cd /var/www/toolbox && tar xzf /tmp/toolbox-deploy.tar.gz && rm /tmp/toolbox-deploy.tar.gz"

rm -f "${TMP_ARCHIVE}"

echo ""
echo "▶ Lancement deploy-app.sh..."
ssh $SSH_OPTS "${SSH_TARGET}" "cd /var/www/toolbox/web && bash scripts/deploy-app.sh"

echo ""
echo "======================================================"
echo "  ✅ Mise à jour déployée !"
echo "======================================================"
