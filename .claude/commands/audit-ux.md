---
description: Audit UX visuel — capture surfaces isolées + workflows multi-pages puis analyse la cohérence d'ensemble.
argument-hint: [optionnel : nom de scenario à cibler, ex. "captions-manual-workflow"]
---

Lance un audit UX visuel en **trois temps** : capture → analyse par surface → analyse de cohérence inter-pages.

## Étape 1 — Capture

```bash
cd web && npm run ux:capture
```

Pré-requis : Docker up + DB de test seedée (`cd web && npm run test:db:setup && npm run test:db:seed`).

Le script génère :
- `.claude/ux-audit/<timestamp>/surfaces/*.png` — pages isolées (snapshot d'état)
- `.claude/ux-audit/<timestamp>/scenarios/<name>/<NN>-<step>.png` — workflows multi-étapes

## Étape 2 — Analyse par surface

Pour chaque PNG du dossier `surfaces/`, lis-le avec le **Read tool** (les images arrivent visuellement dans ton contexte multimodal). Rapporte par surface, classé :

- 🔴 **Critique** — Bug logique, info trompeuse, action bloquée. L'utilisateur va se planter.
- 🟡 **Moyen** — Friction, redondance, hint manquant, copy ambigu. L'utilisateur freiné mais s'en sort.
- 🟢 **OK** — Surface propre.

Pour chaque problème : zone (titre/label), une phrase de description, une phrase de fix proposé.

## Étape 3 — Analyse de cohérence (scenarios)

Pour chaque scenario, lis **toutes les captures de la séquence dans l'ordre numéroté** (01, 02, 03…). Évalue la cohérence d'**ensemble**, pas juste chaque écran isolément :

### Questions à se poser entre les étapes

- **Transition** : le clic mène-t-il où l'utilisateur s'attendait ? Le titre/breadcrumb de la page d'arrivée correspond-il à l'action déclenchée ?
- **Langage** : le mot "Sous-titres" est-il appelé pareil sur la fiche que sur l'éditeur ? Pas de glissement de vocabulaire ?
- **Retour** : depuis chaque écran intermédiaire, le retour est-il clair et cohérent (1 chemin évident, pas 2 boutons redondants) ?
- **État après action** : après "Enregistrer" / "Promouvoir" / etc., la fiche source reflète-t-elle la nouvelle réalité ? (statut changé, badge mis à jour, banner différent).
- **Continuité visuelle** : même shell Liquid Glass v2 partout, mêmes couleurs d'accent par rôle, pas de fond gris en plein milieu d'un workflow glass.
- **Charge mentale** : trop d'étapes pour une action simple ? Confirmation de trop ? Champ pré-rempli manqué ?

### Format de rapport scenario

Pour chaque scenario :

```
## Scenario : <nom>

**Pitch** : ce que le user essaie de faire en 1 phrase.

**Étapes capturées** : N PNG dans l'ordre.

**Cohérence d'ensemble** :
- 🔴 / 🟡 / 🟢 — sur les transitions, le langage, le retour, l'état final.

**Verdict workflow** : "L'utilisateur arrive à but" / "Bloque à l'étape X" / "Friction principale entre étape A et B".
```

## Étape 4 — Conclusion

Termine par une recommandation **"Si je devais fixer une seule chose pour rendre la chaîne fluide, ce serait X"**.

Ne propose pas d'implémentation — c'est un audit. Le user choisit ensuite quoi fixer.

## Cible (si fournie)

$ARGUMENTS

Si un nom de scenario est passé, focus dessus uniquement. Sinon, audite TOUT.

## Ajouter / modifier des scenarios

Édite la const `SCENARIOS` dans `web/scripts/capture-ux-screenshots.ts`. Format :

```ts
{
  name: "mon-workflow",
  description: "Ce que le user essaie de faire",
  steps: [
    { label: "01-depart", action: { type: "goto", path: "/foo" }, settleMs: 500 },
    { label: "02-clic-X", action: { type: "click", selector: 'button:has-text("X")' } },
    { label: "03-fill-Y", action: { type: "fill", selector: 'input[name="y"]', value: "bla" } },
    { label: "04-arrivee", action: { type: "wait", ms: 800 } },
  ],
}
```

Actions supportées : `goto`, `click`, `fill`, `wait`. Capture full-page après chaque étape (sauf si `capture: false`).
