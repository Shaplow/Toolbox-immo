#!/bin/bash
# =============================================================================
# deploy-app.sh — Déployer ou mettre à jour Toolbox Immo sur le serveur
# Usage : cd /var/www/toolbox/web && bash scripts/deploy-app.sh [--import-data]
#   --import-data : importer les données depuis scripts/data-export.json
# =============================================================================
set -e

IMPORT_DATA=false
for arg in "$@"; do
  [[ "$arg" == "--import-data" ]] && IMPORT_DATA=true
done

echo "======================================================"
echo "  Toolbox Immo — Déploiement"
echo "======================================================"

# Vérifier .env.local
if [ ! -f ".env.local" ]; then
  echo "❌ Fichier .env.local manquant !"
  echo "   Copiez .env.production.example en .env.local et remplissez les valeurs."
  exit 1
fi

# Prisma ne lit que .env — on le synchronise depuis .env.local
cp .env.local .env

# ── 1. Dépendances Node ─────────────────────────────────────────────────────
echo ""
echo "▶ 1/6  npm install..."
PKG_HASH_FILE=".deploy-pkg-hash"
PKG_HASH_CURRENT=$(md5sum package.json package-lock.json 2>/dev/null | md5sum | cut -d' ' -f1)
PKG_HASH_PREV=$(cat "$PKG_HASH_FILE" 2>/dev/null || echo "")
if [ "$PKG_HASH_CURRENT" = "$PKG_HASH_PREV" ] && [ -d "node_modules" ]; then
  echo "   ⏭  package.json inchangé — npm ci skippé"
else
  npm ci --legacy-peer-deps
  echo "$PKG_HASH_CURRENT" > "$PKG_HASH_FILE"
fi

# ── 2. Render-engine Python ────────────────────────────────────────────────
echo ""
echo "▶ 2/6  Render-engine — venv + pip install..."
RENDER_DIR="$(dirname "$(pwd)")/render-engine"
if [ ! -d "${RENDER_DIR}/venv" ]; then
  python3 -m venv "${RENDER_DIR}/venv"
fi
PIP_HASH_FILE="${RENDER_DIR}/.deploy-pip-hash"
PIP_HASH_CURRENT=$(md5sum "${RENDER_DIR}/requirements.txt" 2>/dev/null | cut -d' ' -f1)
PIP_HASH_PREV=$(cat "$PIP_HASH_FILE" 2>/dev/null || echo "")
if [ "$PIP_HASH_CURRENT" = "$PIP_HASH_PREV" ]; then
  echo "   ⏭  requirements.txt inchangé — pip install skippé"
else
  "${RENDER_DIR}/venv/bin/pip" install --quiet --upgrade pip
  "${RENDER_DIR}/venv/bin/pip" install --quiet -r "${RENDER_DIR}/requirements.txt"
  echo "$PIP_HASH_CURRENT" > "$PIP_HASH_FILE"
fi

# ── 3. Prisma (sans seed auto) ─────────────────────────────────────────────
echo ""
echo "▶ 3/6  Prisma — migrations PostgreSQL (sans seed)..."
./node_modules/.bin/prisma migrate deploy
./node_modules/.bin/prisma generate

# ── 4. Import des données (si demandé) ─────────────────────────────────────
if [ "$IMPORT_DATA" = true ]; then
  if [ -f "scripts/data-export.json" ]; then
    echo ""
    echo "▶ 4/6  Import données SQLite → PostgreSQL..."
    ./node_modules/.bin/tsx scripts/import-postgres.mjs
  else
    echo "⚠️  --import-data spécifié mais scripts/data-export.json introuvable."
  fi
else
  echo ""
  echo "▶ 4/6  (Pas d'import de données — ajoutez --import-data pour importer)"
fi

# ── 5. Build Next.js ────────────────────────────────────────────────────────
echo ""
echo "▶ 5/6  Build Next.js..."
npm run build

# ── 6. PM2 ─────────────────────────────────────────────────────────────────
echo ""
echo "▶ 6/6  Démarrage/redémarrage PM2..."
pm2 delete toolbox-web 2>/dev/null || true
pm2 delete toolbox-render 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save

echo ""
echo "======================================================"
echo "  ✅ Déploiement terminé !"
echo "======================================================"
echo ""
pm2 status
echo ""
echo "  Next.js tourne sur le port 3000."
echo "  Render-engine tourne sur le port 8000 (interne uniquement)."
echo "  Pour configurer Nginx (reverse proxy), lancez :"
echo "    bash scripts/setup-nginx.sh votre-domaine.fr"
echo ""
