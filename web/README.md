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

### Rétention des vidéos sous-titrées de l'Atelier

**Route** : `POST /api/cron/caption-retention`

Supprime de R2 la vidéo d'un sous-titrage de l'Atelier (outil « Sous-titres »,
`CaptionJob` sans publication) restée **60 jours sans activité**. La ligne reste en
historique avec un badge « Expirée » (`outputExpiredAt`) et ses sous-titres
(`srtContent`) sont gardés : relancer la génération, en renvoyant la vidéo d'origine,
suffit à récupérer la vidéo.

**Activité** : la génération (`createdAt`), ou un téléchargement **depuis l'app**. Le
bouton « MP4 » (file de la page de génération, « Mes générations ») passe par
`GET /api/render/captions/<id>/download`, qui pose `lastAccessedAt` puis redirige vers une
URL R2 pré-signée de 15 minutes : chaque clic repousse la suppression de 60 jours, celui
d'un admin compris. Le reste **ne compte pas** : regarder la vidéo dans le lecteur, la
télécharger par le menu du lecteur, ouvrir ou copier son URL publique (CDN). C'est pour
cela que les textes de l'app parlent d'un téléchargement « depuis l'app ».

**Jamais purgé** (règles : `src/lib/captions/outputRetention.ts`) :

- un job lié à une publication (`slotId`), ou sous-titre actif d'une publication ;
- un job du pipeline auto : `srtFilename` `auto-<id>.json` ou `auto-transcription-<id>.json`,
  ou clé `…/auto.mp4`. Le filtre SQL exclut volontairement un peu plus (tout `auto-….json`,
  casse ignorée) ; un fichier importé par l'utilisateur, comme `automne.srt`, est un
  sous-titrage de l'Atelier ordinaire ;
- un job non terminé (seuls `COMPLETED` et `FAILED` sont purgeables) ;
- toute clé qui n'a pas la forme exacte
  `outputs/captions/<user>/<horodatage>/{full|preview}.mp4`. Les jobs d'avant le
  20/04/2026 n'ont pas le segment `<user>` (`outputs/captions/<horodatage>/full.mp4`) :
  cette forme est reconnue aussi.

Les générations de templates (`renders/`, `overlays/`) sont hors périmètre.

**Les `FAILED` sont réclamés** : la clé de sortie est posée à la création du job, mais un
rendu en échec n'a le plus souvent produit aucun fichier. Ces lignes suivent le même chemin que
les autres (`outputExpiredAt` posé, `outputKey` effacé ; supprimer un objet R2 absent n'est
pas une erreur). Elles comptent dans `candidates`, donc face à `maxDeletes`, apparaissent
dans `byStatus.failed` et, faute de fichier, dans `bytes.missingInR2`.

**Dry-run par défaut**, mêmes paramètres que `r2-cleanup` :

| Appel | Effet |
|---|---|
| `POST /api/cron/caption-retention` | Dry-run : rapport seul, aucune écriture (ni base, ni R2) |
| `…?apply=1` | Passage réel : supprime les vidéos expirées |
| `…?apply=1&maxDeletes=N` | Disjoncteur : au-delà de N vidéos à supprimer (`candidates`, `FAILED` compris ; 500 par défaut), rien n'est réclamé et la route répond **409** |
| `…?dryRun=true` | Ancienne forme : reste un dry-run, même combinée à `apply=1` |

**Déroulé d'un passage réel**, pour chaque vidéo :

1. la ligne est **réclamée** (`outputExpiredAt` posé, `outputUrl` vidé) par un seul
   `UPDATE … WHERE` qui relit la règle des 60 jours : un téléchargement arrivé entre la
   lecture et l'écriture gagne, et la vidéo reste ;
2. l'objet R2 est supprimé ;
3. `outputKey` est effacé, seulement une fois R2 confirmé.

Si R2 échoue entre 2 et 3, la ligne reste « en attente » (`pendingLeft`) : la vidéo n'est
déjà plus téléchargeable depuis l'app (410) et le passage suivant reprend la suppression.
Ce n'est pas une erreur HTTP. Chaque ligne lue repasse en plus par les règles en JS
avant toute suppression, et une clé portée par plusieurs lignes n'est jamais touchée.

**Variable d'environnement requise** : `CRON_SECRET`, la même que pour `r2-cleanup`.

**Réponse** :

```json
{
  "dryRun": true,
  "retentionDays": 60,
  "cutoff": "2026-08-08T04:00:00.000Z",
  "candidates": 3,
  "claimed": 0,
  "deleted": 0,
  "pendingRetried": 0,
  "pendingLeft": 0,
  "skipped": { "sharedKey": 0, "unsafeKey": 0, "race": 0 },
  "errors": 0,
  "nonTerminalStale": 0,
  "bytes": { "candidates": 219152384, "missingInR2": 1 },
  "byKind": { "full": 2, "preview": 1 },
  "byStatus": { "completed": 2, "failed": 1 },
  "byUser": { "<userId>": { "count": 3, "bytes": 219152384 } },
  "samples": ["outputs/captions/<userId>/1754000000000/full.mp4"],
  "refused": null
}
```

- `candidates` : vidéos qu'un passage réel réclamerait. `skipped` compte les autres :
  `sharedKey` (clé portée par plusieurs lignes), `unsafeKey` (refusée par la
  re-vérification) et `race` (un téléchargement a gagné entre la lecture et la
  réclamation). `sharedKey` et `unsafeKey` doivent rester à 0.
- `skipped.unsafeKey` à 0 : les clés sans segment `<user>` (jobs d'avant le 20/04/2026) sont
  acceptées, il ne reste donc que des clés de forme inconnue sous `outputs/captions/`. Si le
  compteur n'est pas nul, ces lignes sont ignorées : ni leur fichier ni leur clé ne sont
  touchés, et chaque passage les compte et les journalise de nouveau. Relever leur clé dans
  les logs (`[captions/retention] ligne remontée par le SQL mais refusée…`, ou
  `suppression en attente sur une clé hors forme` pour une suppression en attente), puis
  soit élargir `ATELIER_OUTPUT_KEY_RE` (`src/lib/captions/outputRetention.ts`) si c'est bien
  une vidéo de l'Atelier, soit laisser ces fichiers en place.
- `claimed` / `deleted` : lignes réclamées / réclamées **et** supprimées de R2.
  `pendingRetried` : suppressions en attente d'un passage précédent, terminées par
  celui-ci ; `pendingLeft` : encore en attente à la fin du passage.
- `errors` : échecs rencontrés (réclamation, R2, effacement de la clé), détail dans les
  logs `[captions/retention]`.
- `nonTerminalStale` : sous-titrages de l'Atelier encore `QUEUED`/`PROCESSING` depuis plus
  de 60 jours. Un statut non terminal n'est jamais purgé : les passer en `FAILED` avec le
  sweep admin les rend purgeables.
- `byStatus` : statut des candidats (`completed` / `failed`), même population que
  `candidates`. Les `failed` n'ont le plus souvent pas de fichier : voir plus haut.
- `bytes` : volumes d'après le listing R2 de `outputs/captions/` (`null` s'il a échoué,
  la purge continue) ; `missingInR2` : candidats dont le fichier n'existe pas sur R2,
  surtout des `failed`.
- `samples` : au plus 20 clés candidates, de quoi relire un dry-run à l'œil.

| Statut | Sens |
|---|---|
| 200 | Dry-run, ou passage réel effectué (même avec des suppressions R2 en attente) |
| 409 | **Passage réel refusé par le disjoncteur** : plus de `maxDeletes` vidéos à supprimer, rien n'a été réclamé. Même corps que le 200, avec `refused: { "reason": "too_many_candidates", "maxDeletes": N }`. Volontairement un échec HTTP, pour la même raison que `r2-cleanup`. |
| 401 / 503 | Secret absent ou invalide / `CRON_SECRET` non configuré |
| 500 | Erreur interne (R2 non configuré, base indisponible…) |

**Avant de câbler `apply=1` — relire un dry-run en prod** :

1. Vérifier qu'aucune table ne référence de clé ou d'URL `outputs/captions/` en dehors
   des lignes `CaptionJob` (sinon la suppression casserait cette référence).
2. Lancer un dry-run à la main, puis relire `samples` (uniquement des clés `full` ou
   `preview`), `byUser`, `bytes`, `byStatus` et `skipped`, qui doit rester à 0 pour
   `sharedKey` et `unsafeKey`. `bytes.missingInR2` doit s'expliquer en grande partie par
   `byStatus.failed` (rendus en échec, sans fichier) ; un grand nombre de `completed` sans
   fichier mérite d'être compris avant d'appliquer.
3. Faire le premier passage réel à la main : il supprime d'un coup tout ce qui a plus de
   60 jours, bien au-delà des 500 par défaut. `maxDeletes` doit dépasser `candidates`
   (`FAILED` compris), sinon la route répond 409 et ne réclame rien : prendre `candidates`
   plus une marge. Le passage peut durer plusieurs minutes (suppressions R2, 4 en
   parallèle) ; s'il est interrompu, le suivant reprend ce qui reste.
4. Relancer un dry-run : `candidates` et `pendingLeft` doivent être à 0.
5. Seulement ensuite, ajouter un second `POST ?apply=1` au script nocturne du serveur
   (`/usr/local/bin/toolbox-r2-cleanup`), à la suite du nettoyage des orphelins, avec le
   plafond par défaut, et relire son journal le lendemain. Un passage nocturne qui
   dépasse 500 vidéos répond 409 : activer l'alerte sur les statuts non 2xx.

```bash
# Dry-run manuel (ne supprime rien, rapporte candidats, volumes et échantillons)
curl -X POST "https://<votre-domaine>/api/cron/caption-retention" \
     -H "x-cron-secret: $CRON_SECRET"

# Premier passage réel, à la main, plafond relevé après relecture du dry-run
curl -X POST "https://<votre-domaine>/api/cron/caption-retention?apply=1&maxDeletes=<candidates + marge>" \
     -H "x-cron-secret: $CRON_SECRET"

# Chaque nuit, à la suite de r2-cleanup — à câbler APRÈS la relecture d'un dry-run
curl -X POST "https://<votre-domaine>/api/cron/caption-retention?apply=1" \
     -H "x-cron-secret: $CRON_SECRET"
```

Le sweep admin (`POST /api/admin/jobs/sweep`) ne compte plus, dans `orphans.captions`, les
lignes dont la vidéo a déjà été purgée.
