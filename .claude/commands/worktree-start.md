---
description: Crée un worktree git dédié pour un chantier parallèle + branche + checklist d'isolation.
argument-hint: <nom-du-chantier> (ex: fix-rotation-isolation, harden-uploads)
---

Tu vas créer un worktree git isolé pour le chantier décrit en argument. Objectif : permettre à l'utilisateur de lancer une session Claude Code parallèle sans stomper la session courante.

## Validation préalable (obligatoire)

1. Vérifie le nom du chantier : kebab-case, pas de slash, pas d'espace. Si `$ARGUMENTS` est vide ou invalide, refuse et redemande.
2. Lance `git status` dans le repo courant. Si des changes uncommitted touchent des fichiers que le chantier va probablement modifier, **stop et demande confirmation**.
3. Lance `git worktree list` pour vérifier que le chantier n'a pas déjà un worktree.
4. Vérifie que la branche `feature/$ARGUMENTS` n'existe pas déjà via `git branch --list "feature/$ARGUMENTS"`.

## Création

Si tout est ok, exécute :

```bash
git worktree add ../Toolbox-immo-$ARGUMENTS -b feature/$ARGUMENTS main
```

(Toujours partir de `main`, pas de la branche courante — sinon le chantier hérite des changes en cours.)

## Bootstrap minimal

Dans le nouveau worktree :

1. Vérifie que `web/.env.local` existe (les worktrees ne copient pas les fichiers gitignored). Si absent, indique à l'utilisateur de le copier depuis le repo principal :
   ```bash
   cp /Users/mathis/Dev/Projets/Toolbox-immo/web/.env.local ../Toolbox-immo-$ARGUMENTS/web/.env.local
   ```
2. Liste les `node_modules` à éventuellement réinstaller si la branche `main` a divergé sur les dépendances :
   ```bash
   cd ../Toolbox-immo-$ARGUMENTS && npm run install:web
   ```
   (Ne le lance pas automatiquement — laisse le user décider, c'est long.)

## Sortie attendue

Termine par un récap :

```
✓ Worktree créé : /Users/mathis/Dev/Projets/Toolbox-immo-$ARGUMENTS
✓ Branche : feature/$ARGUMENTS (à partir de main)

Pour lancer une session Claude Code dessus :
  cd /Users/mathis/Dev/Projets/Toolbox-immo-$ARGUMENTS
  claude

À surveiller :
- web/.env.local copié ? [oui/non]
- node_modules à reinstaller ? [oui/non]
- branche main à jour ? (git fetch origin avant de bosser)
```

## Règles dures

- **Ne jamais** créer le worktree à partir d'une branche autre que `main` sans confirmation explicite.
- **Ne jamais** lancer `git worktree remove --force`.
- Si la branche existe déjà : refuser et proposer un nom incrémenté (`feature/$ARGUMENTS-2`).

Chantier à créer :

$ARGUMENTS
