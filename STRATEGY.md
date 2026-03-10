# Toolbox Immo — Stratégie d'architecture

## Vue d'ensemble

Monorepo regroupant les outils métier immobilier sous une interface unifiée avec auth centralisée.

```
toolbox-immo/
  web/             → Next.js (shell auth + TemplateGen + Captions UI)
  render-engine/    → Python FastAPI (microservice Captions / FFmpeg)
  docker-compose.yml
  STRATEGY.md
```

---

## Outils intégrés

| Outil | Source | Tech |
|---|---|---|
| **Template Generator** | `TemplateGenImmo/app/` | Next.js intégré |
| **Captions** | `Add_subtitle/` | React (migré dans Next.js) + Python FastAPI microservice |

---

## Architecture technique

### Couche web — `web/`  (base : TemplateGenImmo)

- **Next.js 16** App Router
- **NextAuth v5** pour l'authentification
- **Prisma** + **PostgreSQL** (prod) / SQLite (dev)
- Routes :
  - `/` → landing toolbox (choix de l'outil)
  - `/tools/templates` → Template Generator (code existant déplacé)
  - `/tools/captions` → Captions (composants Vite migrés ici)
  - `/admin` → déjà existant

### Microservice Python — `render-engine/`  (base : Add_subtitle)

- **FastAPI** + **Uvicorn**
- **FFmpeg** via subprocess
- Appelé exclusivement via Next.js (pas exposé publiquement)
- Sécurisé par **API key interne** partagée entre Next.js et Python
- Port : `8000`

### Routage Nginx (VPS)

```nginx
toolbox.domain.com/*              → Next.js :3000
toolbox.domain.com/api/captions/* → Python FastAPI :8000  (internal only)
```

---

## Auth & Permissions

Base : système existant de TemplateGenImmo (NextAuth + Prisma).

- Roles : `USER` / `ADMIN` (déjà en place)
- Extension : champ `tools: String[]` sur `User` pour restreindre l'accès par outil si besoin
- Le microservice Python n'est **jamais appelé directement par le client** :
  - Next.js reçoit la requête → valide la session → proxy vers Python avec `X-Internal-Key`
  - Python vérifie `X-Internal-Key` correspondant à `INTERNAL_API_KEY` en env

---

## Compute lourd — RunPod Serverless

Pour éviter de saturer le petit VPS lors des encodages vidéo/rendu image.

| Endpoint RunPod | Déclenché par | Contenu Docker |
|---|---|---|
| `runpod-ffmpeg` | render-engine | Python + FFmpeg |
| `runpod-puppeteer` *(phase 2)* | web (TemplateGen) | Node + Chromium |

**Flow Captions avec RunPod :**
```
User → Next.js → render-engine (Python) → RunPod Serverless (FFmpeg) → R2 → URL retournée → User
```

**Coût RunPod :** ~$0.0002/s CPU. Encoding 2 min ≈ $0.024.

---

## Stockage fichiers — Cloudflare R2

Remplace les dossiers locaux `/outputs` et `/public/uploads`.

- Gratuit jusqu'à 10 GB
- Pas d'egress fees (contrairement à S3)
- SDK compatible S3 (`boto3` côté Python, `@aws-sdk/client-s3` côté Next.js)

---

## Base de données

PostgreSQL existant sur VPS — rien à changer.  
Ajout d'une table `CaptionJob` pour tracker les jobs d'encodage Captions (comme `Render` dans TemplateGen).

```prisma
model CaptionJob {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id])
  status    String   // pending | processing | done | error
  inputUrl  String
  outputUrl String?
  config    Json
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

---

## Plan de migration — Étapes

### Étape 1 — Monorepo + shell Next.js ✅ terminé
- [x] Copier TemplateGen → `web/`
- [x] Copier Python Add_subtitle → `render-engine/`
- [x] Page d'accueil toolbox `/home` avec cards outils
- [x] AppNav mis à jour (branding + Captions link)
- [x] Route placeholder `/tools/captions`
- [x] docker-compose.yml racine
- [x] .env.example pour les deux services

### Étape 2 — Intégrer Captions dans Next.js
- [ ] Migrer composants React Vite → `web/src/app/tools/captions/`
- [ ] Créer route proxy Next.js `/api/captions/*` → Python :8000
- [ ] Adapter les appels `localhost:8000` en chemins relatifs `/api/captions/`

### Étape 3 — Auth unifiée
- [ ] Protéger `/tools/captions` avec le middleware NextAuth existant
- [ ] Ajouter `X-Internal-Key` entre Next.js et Python
- [ ] Vérification de la clé côté Python (middleware FastAPI)

### Étape 4 — RunPod compute
- [ ] Dockeriser le rendering FFmpeg (`render-engine/Dockerfile`)
- [ ] Créer handler RunPod Serverless (`render-engine/runpod_handler.py`)
- [ ] Python API délègue à RunPod au lieu d'appeler FFmpeg localement
- [ ] Variables d'env : `RUNPOD_API_KEY`, `RUNPOD_ENDPOINT_ID`

### Étape 5 — Stockage objet (R2)
- [ ] Remplacer `outputs/` par upload R2 dans `render-engine`
- [ ] Remplacer `public/uploads` et `public/renders` par R2 dans `web`
- [ ] Variables : `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`

---

## Coûts estimés (prod)

| Service | Coût mensuel |
|---|---|
| VPS (Next.js + Python + Nginx + Postgres) | ~$10–20 |
| RunPod Serverless (pay-per-use) | ~$5–20 selon usage |
| Cloudflare R2 | Gratuit < 10 GB |
| **Total** | **~$15–40/mois** |

---

## Variables d'environnement requises

### `web/.env.local`
```env
# Auth
NEXTAUTH_SECRET=...
NEXTAUTH_URL=http://localhost:3000

# DB
DATABASE_URL=postgresql://...

# Internal
INTERNAL_API_KEY=...          # clé partagée avec render-engine
CAPTIONS_API_URL=http://localhost:8000

# R2 (étape 5)
R2_ACCOUNT_ID=...
R2_ACCESS_KEY_ID=...
R2_SECRET_ACCESS_KEY=...
R2_BUCKET=toolbox-immo
```

### `render-engine/.env`
```env
INTERNAL_API_KEY=...          # même clé que ci-dessus
RUNPOD_API_KEY=...            # étape 4
RUNPOD_ENDPOINT_ID=...        # étape 4
R2_ACCESS_KEY_ID=...          # étape 5
R2_SECRET_ACCESS_KEY=...      # étape 5
R2_BUCKET=toolbox-immo
```
