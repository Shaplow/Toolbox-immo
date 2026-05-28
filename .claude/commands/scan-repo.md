---
description: Scan repo "lundi matin" — lance en parallèle plusieurs audits read-only et produit un rapport priorisé des chantiers.
argument-hint: [optionnel : modules ou surfaces à scanner, séparés par virgules]
---

Tu es l'orchestrateur d'un scan multi-front du repo Toolbox Immo. Ton objectif : identifier 6 à 12 chantiers indépendants priorisés par impact × effort, prêts à être ouverts chacun dans un worktree séparé.

## Étape 1 — Cadrage (rapide)

Si `$ARGUMENTS` est vide, propose 5 surfaces par défaut basées sur les modules à risque connus :
- `web/src/app/(app)/publications/[id]` (fiche publication — module hub)
- `web/src/components/template-builder` (builder + preview parity)
- `web/src/lib/permissions` + `web/src/lib/auth` (auth boundary)
- `render-engine/engine` (template_composite, runpod_worker)
- `web/src/lib/content-library` + `web/src/lib/asset-rotation` (rotation engine)

Si `$ARGUMENTS` est fourni, utilise les surfaces listées.

## Étape 2 — Lancement parallèle (CRITIQUE)

Lance **dans un seul message** plusieurs invocations du Task tool en parallèle, avec `run_in_background: true` pour celles qui peuvent attendre. Distribue les agents pour qu'aucun ne se retrouve seul à scanner tout le repo :

- **bug-hunter** sur 2 modules différents (en parallèle)
- **ux-auditor** sur 1 module user-facing
- **security-auditor** sur 1 surface (auth / uploads / webhooks)
- **code-reviewer** sur le diff `main..HEAD` si on est sur une branche feature
- **Explore** pour cartographier toute dette `TODO`/`FIXME`/`@deprecated` du repo

Chaque agent doit recevoir un briefing self-contained avec :
- son périmètre exact (chemins de fichiers)
- son livrable attendu (rapport ranké top 5)
- limite : sous 300 mots de rapport

## Étape 3 — Synthèse priorisée

Quand tous les agents répondent, agrège leurs sorties en un **tableau unique** :

| # | Chantier | Module | Impact (1-5) | Effort (1-5) | Source | Worktree suggéré |
|---|----------|--------|---|---|--------|------------------|
| 1 | … | … | … | … | bug-hunter | `wt/fix-rotation-isolation` |

Trie par `Impact / Effort` décroissant. Garde 6 à 12 lignes max.

## Étape 4 — Recommandation

Termine par une section **"Top 4 à lancer cette semaine"** avec, pour chacun :
- 1 ligne de pitch
- worktree à créer (`/worktree-start <nom>`)
- agent recommandé pour l'attaquer

## Règles dures

- **Ne pas** implémenter quoi que ce soit. Read-only.
- **Ne pas** lancer plus de 6 agents en parallèle (limite de bande passante cognitive).
- **Ne pas** réinvoquer un agent qui a déjà tourné dans cette session.
- Privilégier les chantiers **indépendants** (pas de file overlap entre eux) pour que les worktrees ne se stompent pas.

Argument utilisateur (optionnel) :

$ARGUMENTS
