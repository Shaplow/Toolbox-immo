---
mode: agent
agent: toolbox-generalist
description: Démarre l'implémentation d'une feature à partir d'un plan existant. Colle le plan produit par @feature-planner après ce prompt.
---

Implémente la feature selon le plan ci-dessous.

**Règles d'exécution :**
- Implémente phase par phase dans l'ordre du plan.
- Après chaque phase, liste les fichiers créés ou modifiés et attends une confirmation avant de passer à la phase suivante.
- Si une phase touche le schéma Prisma, rappelle-moi de lancer `cd web && npm run db:push` avant de continuer.
- Si une phase touche le render-engine, précise si un redémarrage local est nécessaire.
- Ne refactorise pas le code existant au-delà de ce qui est strictement nécessaire pour la feature.

**Plan à implémenter :**

[COLLE LE PLAN ICI]
