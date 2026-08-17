# Toolbox

> Pipeline éditorial pour la production et la publication de contenus social media.

Plateforme orientée équipe (admin, monteur, community manager, client validateur) qui orchestre la chaîne de production complète d'une publication : génération automatique de visuels et vidéos à partir de templates et de bibliothèques de médias, transcription et sous-titrage, génération de descriptions par IA, choix de cover, validation client, planification éditoriale multi-comptes, et publication.

## ✨ Vue d'ensemble

L'app remplace une stack hétérogène (Notion + WhatsApp + outils standalone) par un hub unique où chaque publication suit un parcours visible de bout en bout :

1. **Configuration** — Templates, recettes de contenu, bibliothèques (médias, données, typographies, prompts), comptes clients
2. **Planification** — Calendrier multi-comptes, plans récurrents par offre, slots auto-générés ou manuels
3. **Production** — Génération auto (rendu vidéo, cover, sous-titres, description) **ou** workflow manuel monteur (upload de rushes, versionning)
4. **Validation & publication** — Validation client (via lien magic-link, sans compte requis), publication sur Instagram, archivage

Chaque rôle a sa **worklist dédiée** sur la home : le monteur voit ses publications à monter cette semaine, le CM ses publications à préparer/publier, l'admin un dashboard d'alertes.

## 🏗️ Architecture

Monorepo avec deux couches :

| Dossier | Stack | Rôle |
|---|---|---|
| `web/` | Next.js 16, React 19, Prisma, PostgreSQL, NextAuth, Tailwind, Puppeteer | Product UI, builder template, génération HTML/PNG, orchestration jobs, calendrier, fiche publication |
| `render-engine/` | Python 3, FastAPI, FFmpeg, RunPod | Compositing vidéo, captions burn-in, encoding, traitement lourd asynchrone |

Stockage : **Cloudflare R2** pour les médias et exports.
Auth : **NextAuth v5** (credentials + bcrypt).
IA générative : Claude (Anthropic) + GPT (OpenAI) pour les descriptions et le post-processing des sous-titres.

```
Toolbox/
├── web/                        # Application Next.js
│   ├── src/app/                #   pages, routes API, App Router
│   ├── src/components/         #   composants UI (primitives, panels admin, builder, fiche publication...)
│   ├── src/lib/                #   helpers métier (permissions, captions, render, publications)
│   ├── prisma/                 #   schéma + migrations
│   └── scripts/                #   db:backup, deploy-app, deploy-remote, seed-*
├── render-engine/              # FastAPI + worker RunPod (Python)
│   ├── api.py                  #   FastAPI local
│   ├── runpod_worker.py        #   handler RunPod serverless
│   └── engine/                 #   FFmpeg builders, template compositing, probes
├── .claude/                    # Configuration Claude Code (agents, skills, commands, CLAUDE.md)
├── .github/                    # PR template, CODEOWNERS, copilot-instructions
└── deploy.sh                   # Orchestrateur déploiement (web + Docker RunPod)
```

## 🚀 Quick start

### Prérequis

- Node.js 20+
- Docker (pour PostgreSQL local)
- `pg_dump` (pour `npm run db:backup`) : `brew install postgresql`
- Python 3.11+ (uniquement si tu touches `render-engine/` en local)

### Lancement

```bash
cd web
cp .env.local.example .env.local       # remplir DATABASE_URL, NEXTAUTH_*, R2_*, etc.
docker compose -f docker-compose.dev.yml up -d   # PostgreSQL local
npm install
npx prisma migrate dev                  # applique le schéma
npm run dev
```

App sur [http://localhost:3000](http://localhost:3000).

Premier admin :
```bash
cd web && npx tsx scripts/create-admin.ts
```

Seed minimal (presets sous-titres builtin) :
```bash
cd web && npx tsx scripts/seed-presets.ts
```

## 👥 Rôles utilisateurs

| Rôle | Accès |
|---|---|
| **ADMIN** | Tout : configuration (recettes, plans, bibliothèques, utilisateurs), calendrier global, supervision |
| **VIDEASTE** | Sa worklist (missions de tournage), upload des rushes, fiche publication assignée |
| **MONTEUR** | Sa worklist (publications à monter), captions, transcription, fiche publication assignée |
| **CM** | Sa worklist (publications à préparer/publier), description, cover, captions, transcription, fiche publication assignée |
| **EXTERNAL_GENERATOR** | Client externe : accès limité (templates + covers) selon permissions individuelles |
| **Client** *(non-User)* | Validation via magic link sans compte (Phase 2) |

Filtrage backend strict : un monteur ne voit que les publications où `assigneeMonteurId = lui`, un CM idem avec `assigneeCmId`.

## 📚 Documentation

- **`web/README.md`** : déploiement, scripts, infra (Hetzner VPS, Nginx, PM2, SSL)
- **`render-engine/README.md`** : architecture render engine, FFmpeg pipelines, RunPod
- **`.claude/CLAUDE.md`** : conventions repo, patterns admin, primitives UI, discipline git pour sessions parallèles
- **`.github/copilot-instructions.md`** : repo overview pour Copilot
- **`.github/instructions/`** : conventions par dossier (web, render-engine)

## 🧪 Commandes utiles

```bash
# Web — dev & build
cd web
npm run dev               # dev server
npm run build             # build production
npm run lint              # ESLint

# Base de données
npm run db:generate       # régénère le client Prisma
npm run db:migrate        # crée + applique migration (local interactif)
npm run db:backup         # pg_dump dans web/backups/ (rotation auto à 20)

# Tests automatisés
npm run test:unit         # Vitest — helpers purs (permissions, scoping)
npm run test:db:setup     # crée la DB de test (toolbox_test) + migrations
npm run test:db:seed      # seed admin/monteur/cm/user + 1 client + 1 slot
npm run test:e2e          # Playwright — 21 scénarios (auth + nav + worklist + security)
npm run test:e2e:ui       # Playwright UI mode (debugger interactif)

# Production
bash deploy.sh            # menu interactif (web / docker / les deux)
bash deploy.sh --dry-run  # voir ce qui serait fait
```

### Workflow tests recommandé

Avant tout commit qui touche permissions, helpers de scoping, ou navigation admin :

```bash
cd web && npm run test:unit && npm run test:e2e
```

Première fois sur une machine :

```bash
cd web
cp .env.test.example .env.test           # ajuster si besoin
npm run test:db:setup && npm run test:db:seed
npx playwright install chromium          # télécharge le browser headless (~150MB)
npm run test:unit                        # 50 tests, ~100ms
npm run test:e2e                         # 21 tests, ~20s
```

## 🔒 Sécurité

- Auth NextAuth avec bcrypt
- Filtrage backend par rôle sur toutes les routes calendar / listings / publications (404 anti-énumération)
- Validation URL stricte sur `mark-published` (allowlist Instagram)
- Validation cross-rôle des assignees (un MONTEUR ne peut pas être assigné comme CM)
- Backup PostgreSQL automatique avant chaque `migrate deploy` prod

## 🤝 Contribuer

1. Branche de feature : `feat/<topic>` ou `fix/<topic>` ou `chore/<topic>`
2. Commits atomiques, message clair (préférence commits conventionnels : `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`)
3. PR vers `main` avec le template (`.github/PULL_REQUEST_TEMPLATE.md`)
4. CI : `npm run lint` + `npm run build` doivent passer
5. Pour les changements Prisma : `db:backup` automatique en déploiement, mais vérifier la migration en review

Voir aussi `.claude/CLAUDE.md` pour la discipline git en sessions parallèles (workflow privilégié par les contributeurs utilisant Claude Code).

## 📦 Stack résumé

| Couche | Technos |
|---|---|
| Frontend | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS, Lucide |
| Backend Web | Next.js API routes, Prisma ORM, NextAuth v5, Zustand |
| Database | PostgreSQL (Docker local, managed en prod) |
| Render | Python 3, FastAPI, FFmpeg (NVENC/libx264), Puppeteer (HTML→PNG) |
| Compute lourd | RunPod serverless (transcription Whisper, captions burn-in, video render NVENC) |
| Storage | Cloudflare R2 |
| IA | Claude (Anthropic), GPT (OpenAI), Whisper |
| Auth | NextAuth credentials + bcrypt |
| Déploiement | Hetzner VPS (Ubuntu ARM64), PM2, Nginx + Certbot |

## 📝 License

Privé — propriété du mainteneur principal.
