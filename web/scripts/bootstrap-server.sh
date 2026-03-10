#!/bin/bash
# =============================================================================
# bootstrap-server.sh — Initialisation complète d'un nouveau serveur (1 fois)
# Lancer depuis ta machine locale (Git Bash / WSL)
#
# Usage :
#   bash scripts/bootstrap-server.sh <IP_SERVEUR> [UTILISATEUR] [CLE_SSH]
#
# Exemples :
#   bash scripts/bootstrap-server.sh 141.145.200.100
#   bash scripts/bootstrap-server.sh 141.145.200.100 root ~/.ssh/hetzner_key
#
# Utilisateur par défaut : root (Hetzner)
# =============================================================================
set -e

SERVER_IP="${1}"
SSH_USER="${2:-root}"
SSH_KEY="${3:-}"

# Chemin racine du projet (parent du dossier web/)
PROJECT_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

# ── Validation ───────────────────────────────────────────────────────────────
if [ -z "$SERVER_IP" ]; then
  echo "Usage : bash scripts/bootstrap-server.sh <IP_SERVEUR> [UTILISATEUR] [CLE_SSH]"
  echo "Ex    : bash scripts/bootstrap-server.sh 141.145.200.100"
  exit 1
fi

# Options SSH
SSH_OPTS="-o StrictHostKeyChecking=accept-new"
SCP_OPTS="-o StrictHostKeyChecking=accept-new"
if [ -n "$SSH_KEY" ]; then
  SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
  SCP_OPTS="$SCP_OPTS -i $SSH_KEY"
fi

SSH_TARGET="${SSH_USER}@${SERVER_IP}"

echo "======================================================"
echo "  Toolbox Immo — Bootstrap serveur (Hetzner)"
echo "  Serveur : $SSH_TARGET"
echo "  Source  : $PROJECT_ROOT"
echo "======================================================"
echo ""
echo "Appuie sur ENTRÉE pour continuer ou Ctrl+C pour annuler..."
read -r

# ── Étape 1 : Copier setup-server.sh sur le serveur ──────────────────────────
echo "▶ Copie setup-server.sh sur le serveur..."
scp $SCP_OPTS scripts/setup-server.sh "${SSH_TARGET}:/tmp/setup-server.sh"

# ── Étape 2 : Lancer setup-server.sh en remote (installe tout) ───────────────
echo ""
echo "▶ Installation du serveur (Node, Python, PostgreSQL, Nginx, Certbot)..."
echo "  Cela peut prendre 3-5 minutes..."
echo ""
ssh $SSH_OPTS "${SSH_TARGET}" "chmod +x /tmp/setup-server.sh && bash /tmp/setup-server.sh 2>&1 | tee /tmp/setup-server.log"

# ── Étape 3 : Créer une archive et l'envoyer via scp ────────────────────────
echo ""
echo "▶ Création de l'archive du projet..."
TMP_ARCHIVE="/tmp/toolbox-deploy.tar.gz"
cd "${PROJECT_ROOT}"
tar czf "${TMP_ARCHIVE}" \
  --exclude='./web/node_modules' \
  --exclude='./web/.next' \
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
scp $SCP_OPTS "${TMP_ARCHIVE}" "${SSH_TARGET}:/tmp/toolbox-deploy.tar.gz"

echo "▶ Extraction sur le serveur..."
ssh $SSH_OPTS "${SSH_TARGET}" "mkdir -p /var/www/toolbox && cd /var/www/toolbox && tar xzf /tmp/toolbox-deploy.tar.gz && rm /tmp/toolbox-deploy.tar.gz"

rm -f "${TMP_ARCHIVE}"

# ── Résumé ───────────────────────────────────────────────────────────────────
echo ""
echo "======================================================"
echo "  ✅ Serveur initialisé !"
echo "======================================================"
echo ""
echo "  Prochaines étapes :"
echo ""
echo "  1. Connecte-toi au serveur :"
echo "       ssh $SSH_OPTS ${SSH_TARGET}"
echo ""
echo "  2. Crée le fichier .env.local avec tes variables :"
echo "       nano /var/www/toolbox/web/.env.local"
echo ""
echo "  3. Lance le déploiement depuis ta machine locale :"
echo "       bash scripts/deploy-remote.sh ${SERVER_IP} ${SSH_USER} ${SSH_KEY}"
echo ""
