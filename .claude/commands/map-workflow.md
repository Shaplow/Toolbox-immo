---
description: Map d'un workflow user — scanne le code et produit un Markdown structuré (entry points UI, routes API, modèles Prisma, jobs, side effects + schéma Mermaid).
argument-hint: <nom du workflow en FR, ex. "publication captions auto" ou "génération vidéo template">
---

Mappe le workflow décrit dans `$ARGUMENTS` en scannant le code et produit un fichier Markdown structuré dans `.claude/workflows/<slug>.md`.

## Pourquoi

Le repo Toolbox Immo est gros — ouvrir un workflow user sans contexte demande 30+ minutes de grep / read. Cette commande :
1. Lance un agent `Explore` qui scanne le code en thorough
2. Structure les findings en un Markdown navigable
3. Régénère le dashboard HTML pour browser tous les workflows mappés

## Procédure

### Étape 1 — Identifier le slug

Slug = nom du workflow en kebab-case ASCII (ex. `publication-captions-auto`, `generation-video-template`). Sers-t'en comme nom de fichier.

### Étape 2 — Lancer un agent Explore pour scanner

Invoque le sous-agent `Explore` avec ce briefing :

> Scanne le code de Toolbox Immo pour cartographier le workflow `<nom>`. Identifie :
> - **Entry points UI** : composants React et pages qui déclenchent le workflow (input user)
> - **Routes API** touchées : path + méthode + auth + side effects (DB writes, jobs créés, webhooks invoqués)
> - **Helpers / triggers** appelés : fichiers `lib/triggerXxx.ts`, `lib/services/slot/*.ts`, `lib/publications/*.ts`, etc.
> - **Modèles Prisma** lus / écrits : citer schema.prisma:ligne pour chaque modèle
> - **Jobs créés / consommés** : Render, CaptionJob, CoverFramePack, TranscriptionJob, DescriptionJob, etc.
> - **Webhooks** : routes `/api/webhooks/runpod/*` qui terminent le job
> - **SSE / events** : `notifyUser`, `useJobEvent`, `useAllJobEvents`
> - **Side effects** : `logActivity`, `promoteXxx` (jobLifecycle), cascades de stale
> - **Variants par rôle** : ce qui change pour ADMIN vs MONTEUR vs CM vs VIDEASTE
> - **Pré-conditions et invariants** : pattern requis, status slot autorisé, garde-fous métier
>
> Sors une liste plate avec chemin `file.ts:line` pour chaque référence.

### Étape 3 — Structurer en Markdown

À partir des findings, écris `.claude/workflows/<slug>.md` avec ce format :

```markdown
---
slug: <slug>
name: <nom complet du workflow>
generatedAt: <ISO timestamp>
---

# <Nom du workflow>

## Pitch
Une phrase qui décrit ce que le user accomplit.

## Schéma Mermaid

```mermaid
flowchart LR
  UI[Entry point UI] --> API[/api/...]
  API --> Job[Job créé]
  Job --> Worker[RunPod / local]
  Worker --> Webhook[/api/webhooks/...]
  Webhook --> SSE[notifyUser]
  SSE --> UI
```

## Entry points UI

| Composant | Fichier:Ligne | Rôle |
|---|---|---|
| ... | `src/components/...:42` | ... |

## Routes API touchées

| Méthode | Path | Fichier | Auth | Effets |
|---|---|---|---|---|
| POST | `/api/xxx` | `route.ts:NN` | getUserContext | Crée XJob, écrit Y |

## Helpers / triggers

- `lib/triggerXxx.ts:NN` — déclenche...
- `lib/services/slot/yyy.ts:NN` — ...

## Modèles Prisma touchés

- `XJob` (`schema.prisma:NN`) — lu/écrit par...
- `PublicationSlot` (`schema.prisma:NN`) — promote via `activeXJobId`...

## Jobs et leur lifecycle

```
Created → QUEUED → PROCESSING → COMPLETED | FAILED
                                    ↓
                          promoteXxx → slot.activeXxxJobId
```

## Webhooks et callbacks

- `/api/webhooks/runpod/xxx` (`route.ts:NN`) — termine le job, ...

## SSE / events

- `notifyUser(jobType: "xxx", status: ...)` — émis par...
- `useJobEvent(jobId)` — consommé par...

## Side effects

- `logActivity` type `XXX` — appelé après...
- Cascade stale via `markJobsStaleForSlot` quand...

## Variants par rôle

| Rôle | Ce qui change |
|---|---|
| ADMIN | Voit X, peut Y |
| MONTEUR | ... |

## Pré-conditions / invariants

- Pattern doit avoir...
- Slot status doit être...
- Garde-fou : ...

## Skills/agents pertinents

- `.claude/skills/<area>/SKILL.md`
- Agent `<name>` si tâche d'implémentation

## Liens vers code (raccourcis)

- Tests : `web/src/lib/.../__tests__/...`
- E2E : `web/e2e/...`
```

### Étape 4 — Régénérer le dashboard

Lance :

```bash
cd web && npm run workflows:dashboard
```

→ regénère `.claude/workflows/index.html` qui liste tous les workflows mappés avec lien vers chaque fichier `.md`.

### Étape 5 — Confirmer

Dis au user :
- Le fichier a été créé : `.claude/workflows/<slug>.md`
- Le dashboard est à jour : `.claude/workflows/index.html`
- Pour re-utiliser ce contexte rapidement plus tard : `/onboard <slug>`

## Cible

$ARGUMENTS
