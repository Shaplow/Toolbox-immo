#!/bin/bash
# =============================================================================
# setup-nginx.sh — Configure Nginx comme reverse proxy pour Toolbox Immo
# Usage : bash scripts/setup-nginx.sh VOTRE_DOMAINE
# Exemple : bash scripts/setup-nginx.sh toolbox.mondomaine.fr
# =============================================================================
set -e

SERVER_NAME="${1:-_}"
WEB_DIR="/var/www/toolbox/web"

cat > /etc/nginx/sites-available/toolbox << EOF
server {
    listen 80;
    server_name ${SERVER_NAME};

    # Upload max size (vidéos jusqu'à 500 MB)
    client_max_body_size 500M;

    # Fichiers statiques Next.js
    location /_next/static/ {
        alias ${WEB_DIR}/.next/static/;
        expires 1y;
        add_header Cache-Control "public, immutable";
    }

    # Uploads (images)
    location /uploads/ {
        alias ${WEB_DIR}/public/uploads/;
        expires 7d;
    }

    # Renders (vidéos générées)
    location /renders/ {
        alias ${WEB_DIR}/public/renders/;
        expires 7d;
    }

    # Tout le reste → Next.js
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 300s;
    }
}
EOF

# Activer le site
ln -sf /etc/nginx/sites-available/toolbox /etc/nginx/sites-enabled/toolbox
rm -f /etc/nginx/sites-enabled/default

# Tester et recharger
nginx -t && systemctl reload nginx

echo "✅ Nginx configuré pour ${SERVER_NAME}"
echo "   L'app est accessible sur : http://${SERVER_NAME}"
echo ""
echo "   Pour activer HTTPS :"
echo "     certbot --nginx -d ${SERVER_NAME}"
