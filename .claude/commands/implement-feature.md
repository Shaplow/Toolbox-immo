---
description: Démarre l'implémentation d'une feature à partir d'un plan existant. Colle le plan en argument.
argument-hint: [plan produit par feature-planner]
---

Lance l'agent `toolbox-generalist` via le Task tool avec ce briefing pour qu'il implémente la feature selon le plan ci-dessous.

**Règles d'exécution :**
- Implémente phase par phase dans l'ordre du plan.
- Avant chaque phase, lance `git status` pour vérifier qu'aucune autre session n'est en cours sur les mêmes fichiers.
- Après chaque phase, liste les fichiers créés ou modifiés et attends une confirmation avant de passer à la phase suivante.
- Si une phase touche le schéma Prisma, rappelle de lancer `cd web && npm run db:push` (prototype) ou `cd web && npm run db:migrate` (création de migration) avant de continuer.
- Si une phase touche le render-engine, précise si un redémarrage local est nécessaire.
- Ne refactorise pas le code existant au-delà de ce qui est strictement nécessaire pour la feature.
- Respecte la Git Discipline de `.claude/CLAUDE.md` (commit atomique, pas d'amend, etc.).

**Plan à implémenter :**

$ARGUMENTS
