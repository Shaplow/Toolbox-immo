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

---

## Cron jobs

### R2 Cleanup — nettoyage des objets orphelins

**Route** : `POST /api/cron/r2-cleanup`

Supprime les objets R2 orphelins : créés il y a plus de 24 h et dont la clé n'est
référencée par aucune ligne de la base. Utile pour nettoyer les uploads
interrompus et les sources jamais soumises. Le même appel abandonne aussi les
uploads multipart inachevés depuis plus de 48 h (invisibles pour le listing
d'objets, mais facturés par R2).

**Dry-run par défaut.** Sans paramètre, la route compte et détaille les orphelins
sans rien supprimer (`deleted: 0`). La suppression se demande explicitement :

| Appel | Effet |
|---|---|
| `POST /api/cron/r2-cleanup` | Dry-run : rien n'est supprimé (ni objet, ni multipart) |
| `…?apply=1` | Passage réel : supprime les orphelins et abandonne les multipart inachevés |
| `…?apply=1&maxDeletes=N` | Disjoncteur : au-delà de N orphelins (500 par défaut), aucun objet n'est supprimé et la route répond **409** |
| `…?dryRun=true` | Ancienne forme : reste un dry-run, même combinée à `apply=1` |

**Préfixes scannés** : `publications/`, `content-library/`, `transcription/`,
`inputs/captions/`. Un objet n'est supprimé que si sa clé est absente de TOUTES
les sources ci-dessous (`collectReferencedKeys` dans `src/lib/r2Cleanup.ts`) :

- `PublicationRush`, `PublicationVersion`, `PublicationBriefAttachment` : `r2Key`
- `CoverFramePack.finalCoverKey` : covers monteur
- `MediaAsset` : le fichier (`r2Key`) **et la vignette**, c'est-à-dire
  `content-library/posters/<id>.jpg` par convention, plus la clé lue dans `posterUrl`
- `TranscriptionJob` : `inputKey` et `outputJsonKey` (les `segments.json` sont
  persistants et vivent sous le même préfixe que les sources)
- `CaptionJob` : `inputKey` et `outputKey`

**Attention** : ajouter un préfixe à scanner sans ajouter sa source de références
ferait supprimer des objets vivants. Toujours la source d'abord.

**Variable d'environnement requise** :

```
CRON_SECRET=<secret aléatoire fort — min 32 chars>
```

**Réponse** :

```json
{
  "scanned": 1204,
  "orphans": 3,
  "deleted": 0,
  "dryRun": true,
  "refused": null,
  "byClass": {
    "publications/*/rushes/": { "orphans": 2, "bytes": 52428800, "samples": ["publications/<slot>/rushes/…"] },
    "content-library/audio/": { "orphans": 1, "bytes": 4194304, "samples": ["content-library/audio/…"] }
  },
  "multipart": { "found": 0, "aborted": 0, "bytesFreed": 0, "dryRun": true }
}
```

`byClass` ventile les orphelins par type de fichier (`publications/*/rushes/`,
`versions`, `brief`, `cover-monteur`, `content-library/audio/`, `posters`,
`videos`, `transcription/`, `inputs/captions/`) avec, pour chacun, le nombre,
le volume en octets et au plus 20 clés d'exemple. Seules les classes qui ont
des orphelins apparaissent.

| Statut | Sens |
|---|---|
| 200 | Dry-run, ou passage réel effectué |
| 409 | **Passage réel refusé par le disjoncteur** : plus de `maxDeletes` orphelins, rien n'a été supprimé. Même corps que le 200, avec `refused: { "reason": "too_many_orphans", "maxDeletes": N }`. Volontairement un échec HTTP : sinon cron-job.org ou la crontab y voient un succès et la fuite de stockage se répète chaque nuit sans alerte. Le nettoyage des multipart, indépendant, a eu lieu. |
| 401 / 503 | Secret absent ou invalide / `CRON_SECRET` non configuré |
| 500 | Erreur interne (R2 non configuré, base indisponible…) |

**Avant de câbler `apply=1` — relire un dry-run en prod** :

1. Lancer un dry-run à la main (commande ci-dessous), puis relire les `samples`
   de chaque classe de `byClass` : chaque clé doit être un vrai abandon (upload
   interrompu, source jamais soumise…). Une clé qui ressemble à un fichier vivant
   (vignette, sortie de transcription, cover…) trahit une source de références
   manquante : ne pas câbler `apply=1`.
2. Faire le premier passage réel à la main, avec un `maxDeletes` assumé : il
   balaie des mois d'orphelins, bien au-delà des 500 par défaut.
3. Seulement ensuite, câbler la tâche planifiée avec `?apply=1` et le plafond par
   défaut. Un passage nocturne qui dépasse 500 orphelins répond alors 409 :
   activer l'alerte sur les statuts non 2xx côté planificateur.

**Câblage (cron-job.org, systemd timer, crontab, etc.)** :

```bash
# Dry-run manuel (ne supprime rien, retourne le détail par classe)
curl -X POST "https://<votre-domaine>/api/cron/r2-cleanup" \
     -H "x-cron-secret: $CRON_SECRET"

# Premier passage réel, à la main, plafond relevé après relecture du dry-run
curl -X POST "https://<votre-domaine>/api/cron/r2-cleanup?apply=1&maxDeletes=5000" \
     -H "x-cron-secret: $CRON_SECRET"

# Planifié chaque nuit à 4h00 UTC — à câbler APRÈS la relecture d'un dry-run
curl -X POST "https://<votre-domaine>/api/cron/r2-cleanup?apply=1" \
     -H "x-cron-secret: $CRON_SECRET"
```

**Schedule recommandé** : `0 4 * * *` (04:00 UTC tous les jours)
