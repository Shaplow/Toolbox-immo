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
echo "▶ 1/4  npm install..."
PKG_HASH_FILE=".deploy-pkg-hash"
PKG_HASH_CURRENT=$(md5sum package.json package-lock.json 2>/dev/null | md5sum | cut -d' ' -f1)
PKG_HASH_PREV=$(cat "$PKG_HASH_FILE" 2>/dev/null || echo "")
if [ "$PKG_HASH_CURRENT" = "$PKG_HASH_PREV" ] && [ -d "node_modules" ]; then
  echo "   ⏭  package.json inchangé — npm ci skippé"
else
  npm ci --legacy-peer-deps
  echo "$PKG_HASH_CURRENT" > "$PKG_HASH_FILE"
fi

# ── 2a. Backup PostgreSQL (filet de sécurité avant migration) ──────────────
echo ""
echo "▶ 2/4  PostgreSQL — backup avant migration..."
npm run db:backup

# ── 2b. Prisma (sans seed auto) ────────────────────────────────────────────
echo ""
echo "▶ 2/4  Prisma — migrations PostgreSQL (sans seed)..."
# Re-stamp les checksums des 2 migrations historiques drifty avant deploy.
# Idempotent : si déjà OK, le script no-op et enchaîne sur migrate deploy.
bash scripts/repair-prisma-drift.sh
./node_modules/.bin/prisma generate

# ── 3. Import des données (si demandé) ─────────────────────────────────────
if [ "$IMPORT_DATA" = true ]; then
  if [ -f "scripts/data-export.json" ]; then
    echo ""
    echo "▶ 3/4  Import données SQLite → PostgreSQL..."
    ./node_modules/.bin/tsx scripts/import-postgres.mjs
  else
    echo "⚠️  --import-data spécifié mais scripts/data-export.json introuvable."
  fi
else
  echo ""
  echo "▶ 3/4  (Pas d'import de données — ajoutez --import-data pour importer)"
fi

# ── 4. Build Next.js + PM2 ─────────────────────────────────────────────────
echo ""
echo "▶ 4/4  Build Next.js..."
rm -rf .next
npm run build

echo ""
echo "▶ 4/4  Démarrage/redémarrage PM2..."
pm2 delete toolbox-web 2>/dev/null || true
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
echo "  Render-engine : RunPod serverless (pas de process local)."
echo "  Pour configurer Nginx (reverse proxy), lancez :"
echo "    bash scripts/setup-nginx.sh votre-domaine.fr"
echo ""
