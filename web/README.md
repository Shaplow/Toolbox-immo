# Toolbox Immo

Interface de création de visuels immobiliers et sous-titres. Stack : Next.js 15 + Python FastAPI (render-engine) + PostgreSQL.

---

## Dev local

### Prérequis

- Node.js 20+, Docker (pour PostgreSQL)
- Copier `.env.local.example` → `.env.local` et remplir les valeurs

```bash
cd web
docker compose -f docker-compose.dev.yml up -d   # démarre PostgreSQL
npm install
npx prisma migrate dev
npm run dev
```

App disponible sur [http://localhost:3000](http://localhost:3000).

---

## Production (Hetzner VPS)

### Infrastructure

| Élément | Valeur |
|---|---|
| Serveur | Hetzner VPS — Ubuntu 24.04 ARM64 |
| IP | `37.27.246.85` |
| Utilisateur SSH | `root` |
| Clé SSH | `~/.ssh/toolbox-immo.key` |
| App path | `/var/www/toolbox/` |
| Processus | PM2 : `toolbox-web` (port 3000) + `toolbox-render` (port 8000 interne) |

---

### 1. Initialiser un nouveau serveur (une seule fois)

Depuis la racine du projet, en **Git Bash** :

```bash
bash web/scripts/bootstrap-server.sh 37.27.246.85 root
```

Ce script :
- Installe Node.js 20, Python 3, FFmpeg, PostgreSQL, Nginx, Certbot sur le serveur
- Envoie le code source complet par SCP

Ensuite, **sur le serveur** :

```bash
ssh -i ~/.ssh/toolbox-immo.key root@37.27.246.85

# 1. Copier le fichier d'env (depuis ta machine)
# scp -i ~/.ssh/toolbox-immo.key .env.prod root@37.27.246.85:/var/www/toolbox/web/.env.local

# 2. Configurer Nginx
cd /var/www/toolbox/web
bash scripts/setup-nginx.sh 37.27.246.85   # ou ton domaine

# 3. Déployer l'app
bash scripts/deploy-app.sh

# 4. Créer le compte admin
npx tsx scripts/create-admin.ts   # voir section ci-dessous

# 5. Seed : presets captions + template Vitrine
npx tsx scripts/seed-presets.ts
```

---

### 2. Déployer une mise à jour

Depuis la racine du projet, en **Git Bash** :

```bash
bash web/scripts/deploy-remote.sh 37.27.246.85 root
```

Ce script :
- Crée une archive tar du projet (exclut `node_modules`, `.next`, `venv`, `.env*`, `uploads`, `renders`)
- L'envoie via SCP
- Lance `deploy-app.sh` sur le serveur (npm ci si besoin, migrations Prisma, build Next.js, restart PM2)

> **Note :** `npm ci` et `pip install` sont skippés automatiquement si `package.json` / `requirements.txt` n'ont pas changé depuis le dernier déploiement.
>
> **Note infra :** si une mise à jour touche `scripts/setup-nginx.sh`, il faut aussi relancer ce script sur le serveur pour recharger la config Nginx.

---

### 3. Créer un compte admin manuellement

Sur le serveur :

```bash
cd /var/www/toolbox/web
node -e "
const {PrismaClient} = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();
p.user.create({ data: {
  name: 'Mathis Barbet',
  email: 'mathis.barbet@gmail.com',
  username: 'Mathis',
  passwordHash: bcrypt.hashSync('TON_MOT_DE_PASSE', 10),
  role: 'ADMIN',
  permissions: '[]'
}}).then(u => console.log('Créé :', u.email)).finally(() => p.\$disconnect());
"
```

---

### 4. Initialiser les données (presets + template)

```bash
cd /var/www/toolbox/web
npx tsx scripts/seed-presets.ts
```

Crée :
- Preset captions **Bonjour Oscar** (builtin)
- Preset captions **S de la Grandiere** (builtin)
- Template **Vitrine** assigné au compte `Mathis`

---

### 5. Reset complet de la base (⚠️ destructif)

```bash
cd /var/www/toolbox/web
npx tsx scripts/reset-db.ts
```

Supprime tout et recrée : compte admin Mathis, template Vitrine, 2 presets. À n'utiliser qu'en dev ou lors d'une réinitialisation complète.

---

### 6. SSL / HTTPS (quand le domaine est prêt)

Sur le serveur :

```bash
certbot --nginx -d ton-domaine.fr
```

Puis mettre à jour `NEXTAUTH_URL` dans `.env.local` sur le serveur et redéployer :

```bash
cd /var/www/toolbox/web && bash scripts/deploy-app.sh
```

---

### 7. Commandes utiles sur le serveur

```bash
# Voir les logs en temps réel
pm2 logs toolbox-web
pm2 logs toolbox-render

# Statut des processus
pm2 status

# Redémarrer
pm2 restart toolbox-web
pm2 restart toolbox-render

# Voir les erreurs Nginx
tail -f /var/log/nginx/error.log
```

---

### Fichiers de déploiement

| Fichier | Rôle |
|---|---|
| `scripts/bootstrap-server.sh` | Init serveur (1 fois, depuis local) |
| `scripts/deploy-remote.sh` | Déploiement récurrent (depuis local) |
| `scripts/deploy-app.sh` | Build + migrations + PM2 (exécuté sur serveur) |
| `scripts/setup-nginx.sh` | Configure Nginx reverse proxy (exécuté sur serveur) |
| `scripts/setup-server.sh` | Installe les dépendances système (exécuté par bootstrap) |
| `scripts/seed-presets.ts` | Crée les presets captions + template Vitrine |
| `scripts/reset-db.ts` | Reset complet de la base + seed admin |
| `ecosystem.config.js` | Config PM2 (2 processus : web + render-engine) |
