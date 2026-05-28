---
description: Lance un cycle de hardening sur un module — détection des fragilités puis fixes ciblés (idéal en worktree dédié).
argument-hint: <module ou surface> (ex: api/calendar/slots, captionsEngine, asset-rotation)
---

Tu vas durcir un module précis du repo Toolbox Immo. Hardening = améliorer la résilience opérationnelle (validation, retries, error handling, état stale, race conditions, guards) **sans changer le scope produit**.

## Étape 1 — Inventaire des fragilités (read-only)

Lance l'agent `bug-hunter` via le Task tool sur le module `$ARGUMENTS` avec ce briefing :

> Liste toutes les fragilités opérationnelles du module : missing await, catch silencieux, état stale jamais nettoyé, race conditions entre webhooks et job updates, inputs non validés aux boundaries, transitions d'état autorisées qui ne devraient pas l'être, retries absents, idempotence cassée. Produire un rapport ranké par criticité (1-5). Pas de fix.

Charge également la skill `app-hardening` pour avoir les patterns du repo (validation, retries, transitions, etc.).

## Étape 2 — Confirmation utilisateur

Présente le rapport `bug-hunter` à l'utilisateur et demande :
- Quels items il veut fixer (top 3 par défaut)
- Si c'est ok de tout faire en un seul commit ou en plusieurs commits atomiques

**Ne commence pas à implémenter sans cette confirmation.**

## Étape 3 — Implémentation

Pour les items validés, invoque l'agent `toolbox-generalist` avec un briefing explicite :

> Fix exactement ces N items du rapport hardening sur $ARGUMENTS :
> 1. [item 1 — chemin de fichier + ligne si connue]
> 2. [item 2 — ...]
>
> Règles :
> - **Pas de scope creep.** Ne refactorise pas le module au-delà des fixes.
> - Respecte les patterns existants du module (ne pas introduire de nouvelle convention isolée).
> - Si un fix nécessite un schéma Prisma changement, **stop et signale-le** — ne pas migrer automatiquement.
> - Garde chaque fix dans une commit atomique avec message `harden(<module>): <fix court>`.

## Étape 4 — Validation

Après chaque fix, lance :
- `cd web && npm run lint -- <fichier modifié>` (si TS/TSX dans web/)
- `cd web && npm run test:unit` (si helpers permissions ou lib/ modifiée)

Si rouge → demande à `toolbox-generalist` de corriger avant de passer à l'item suivant.

## Étape 5 — Récap final

Liste :
- ✓ Items fixés (avec hash de commit)
- ⚠ Items skippés (et pourquoi)
- 🔍 Items qui nécessitent une décision produit (à renvoyer au user)

## Règles dures

- **Pas de** nouveaux features. Pas d'ergonomie UI nouvelle. Pas de refactor préventif.
- **Pas de** suppression de code sans logging d'avant/après, même si "ça a l'air mort".
- Si tu hésites sur la portée d'un fix → demande à l'utilisateur plutôt que d'élargir.

Module à durcir :

$ARGUMENTS
