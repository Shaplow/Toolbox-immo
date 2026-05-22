---
description: Lance une revue de code sur les fichiers touchés par une feature récente.
argument-hint: [liste des fichiers à reviewer]
---

Lance l'agent `code-reviewer` via le Task tool avec ce briefing.

**Contexte :** Ces fichiers ont été modifiés dans le cadre d'une feature récente. Concentre la revue sur :
- La cohérence avec le reste du module (pas de nouvelles conventions isolées)
- Les patterns Prisma risqués (N+1, transactions manquantes, champs non validés)
- Les erreurs async silencieuses (missing await, catch qui swallow)
- Le respect des boundaries builder / HTML preview / render-engine si applicable
- La régression potentielle sur des features existantes

**Fichiers à reviewer :**

$ARGUMENTS
