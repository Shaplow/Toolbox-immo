---
mode: agent
agent: code-reviewer
description: Lance une revue de code sur les fichiers touchés par la dernière feature ou modification. Liste les fichiers à reviewer après ce prompt.
---

Fais une revue de code sur les fichiers suivants.

**Contexte :** Ces fichiers ont été modifiés dans le cadre d'une feature récente. Concentre-toi sur :
- La cohérence avec le reste du module (pas de nouvelles conventions isolées)
- Les patterns Prisma risqués (N+1, transactions manquantes, champs non validés)
- Les erreurs async silencieuses
- Le respect des boundaries builder/HTML preview/render-engine si applicable
- La régression potentielle sur des features existantes

**Fichiers à reviewer :**

[LISTE LES FICHIERS ICI]

**Contexte additionnel (optionnel) :**

[DÉCRIS CE QUE LA FEATURE FAIT SI UTILE]
