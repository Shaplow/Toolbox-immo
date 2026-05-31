---
description: Onboarding rapide sur un workflow mappé — lit la map dans `.claude/workflows/<slug>.md` et résume le contexte clé en moins de 200 mots.
argument-hint: <slug du workflow, ex. "publication-captions-auto">
---

Lis le fichier `.claude/workflows/$ARGUMENTS.md` puis fournis un résumé pragmatique en moins de 200 mots :

1. **Pitch** (1 phrase) — ce que le user accomplit
2. **Points d'entrée** (3-5 lignes) — fichiers où démarrer pour modifier ce workflow
3. **Pièges courants** (puces) — invariants à respecter, gardes à ne pas casser
4. **Tests existants** — où sont les tests unitaires et E2E pour ce workflow
5. **Skills/agents à invoquer** si l'utilisateur veut implémenter quelque chose dans ce workflow

Pas de copie verbatim du Markdown — fais un vrai résumé actionnable pour qu'un dev (ou un sub-agent) puisse attaquer une tâche dans ce workflow sans avoir à lire 200 lignes.

Si le fichier n'existe pas dans `.claude/workflows/`, dis-le et propose : "Lance `/map-workflow <description>` pour le créer."

## Cible

$ARGUMENTS
