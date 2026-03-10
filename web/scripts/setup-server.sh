#!/bin/bash
# =============================================================================
# setup-server.sh — À lancer UNE SEULE FOIS sur le serveur (Ubuntu 22.04)
# En root ou avec sudo : bash setup-server.sh
# =============================================================================
set -e

APP_DIR="/var/www/toolbox"
PG_USER="toolbox"
PG_DB="toolbox"
PG_PASS=$(openssl rand -base64 16 | tr -dc 'a-zA-Z0-9' | head -c 20)

echo "======================================================"
echo "  Toolbox Immo — Setup serveur Ubuntu 22.04"
echo "======================================================"

# ── 1. Mise à jour système ──────────────────────────────────────────────────
echo ""
echo "▶ 1/8  Mise à jour système..."
apt-get update -qq && apt-get upgrade -y -qq

# ── 2. Node.js 20 via NodeSource ────────────────────────────────────────────
echo ""
echo "▶ 2/8  Installation Node.js 20..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt-get install -y nodejs

# ── 3. Python 3 + FFmpeg + Chromium (render-engine) ─────────────────────────
echo ""
echo "▶ 3/8  Installation Python 3 + FFmpeg + Chromium..."
apt-get install -y python3 python3-venv python3-pip ffmpeg
# Chromium : Ubuntu 22.04/24.04 n'a plus de vrai deb — on utilise le PPA xtradeb
# qui fournit un vrai binaire ARM64/x86_64 (pas un stub snap)
add-apt-repository ppa:xtradeb/apps -y
apt-get update -qq
apt-get install -y chromium

# ── 4. PostgreSQL 16 ────────────────────────────────────────────────────────
echo ""
echo "▶ 4/8  Installation PostgreSQL..."
apt-get install -y postgresql postgresql-contrib

systemctl enable postgresql
systemctl start postgresql

# Créer user et DB
sudo -u postgres psql -c "CREATE USER ${PG_USER} WITH PASSWORD '${PG_PASS}';" 2>/dev/null || true
sudo -u postgres psql -c "CREATE DATABASE ${PG_DB} OWNER ${PG_USER};" 2>/dev/null || true
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE ${PG_DB} TO ${PG_USER};" 2>/dev/null || true

echo ""
echo "  ✅ PostgreSQL configuré :"
echo "     DATABASE_URL=postgresql://${PG_USER}:${PG_PASS}@localhost:5432/${PG_DB}"
PG_URL="postgresql://${PG_USER}:${PG_PASS}@localhost:5432/${PG_DB}"

# ── 5. PM2 ─────────────────────────────────────────────────────────────────
echo ""
echo "▶ 5/8  Installation PM2..."
npm install -g pm2
pm2 startup systemd -u root --hp /root 2>/dev/null | tail -1 | bash || true

# ── 6. Nginx ────────────────────────────────────────────────────────────────
echo ""
echo "▶ 6/8  Installation Nginx..."
apt-get install -y nginx
systemctl enable nginx

# ── 7. Certbot (SSL Let's Encrypt) ──────────────────────────────────────────
echo ""
echo "▶ 7/8  Installation Certbot..."
apt-get install -y certbot python3-certbot-nginx

# ── 8. Dossiers app ─────────────────────────────────────────────────────────
echo ""
echo "▶ 8/8  Création des dossiers app ${APP_DIR}..."
mkdir -p ${APP_DIR}/web/public/uploads
mkdir -p ${APP_DIR}/web/public/renders
mkdir -p ${APP_DIR}/render-engine/outputs

# ── Résumé ──────────────────────────────────────────────────────────────────
echo ""
echo "======================================================"
echo "  ✅ Serveur prêt !"
echo "======================================================"
echo ""
echo "  ⚠️  IMPORTANT — Copiez ces informations :"
echo ""
echo "  DATABASE_URL=${PG_URL}"
echo "  DIRECT_URL=${PG_URL}"
echo ""
echo "  Prochaines étapes :"
echo "  1. Clonez le repo dans ${APP_DIR}/"
echo "       git clone <repo> ${APP_DIR}"
echo "  2. Créez ${APP_DIR}/web/.env.local avec les bonnes valeurs"
echo "  3. Lancez : cd ${APP_DIR}/web && bash scripts/deploy-app.sh"
echo "  4. Configurez Nginx : bash ${APP_DIR}/web/scripts/setup-nginx.sh votre-domaine.fr"
echo "  5. SSL : certbot --nginx -d votre-domaine.fr"
echo ""
