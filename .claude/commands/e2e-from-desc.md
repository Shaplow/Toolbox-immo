---
description: Génère un scenario Playwright dans le script d'audit UX depuis une description FR du workflow user. Annonce le diff avant d'écrire, on itère si nécessaire.
argument-hint: <description du workflow en FR, ex. "admin crée un slot manual_rushes depuis le calendrier, upload un rush, et promote la version">
---

Convertit la description user dans `$ARGUMENTS` en un nouveau scenario dans `web/scripts/capture-ux-screenshots.ts` (const `SCENARIOS`). Le scenario est ajouté à la suite des existants, testé immédiatement, et itéré jusqu'à ce qu'il passe.

## Pré-requis avant de coder

1. **Vérifier l'état des fixtures** : la description mentionne-t-elle un slot/pattern/compte qui n'existe pas dans le seed ? Si oui, étendre `seedAdminFixtures` ou `seedPatternFixtures` en parallèle.
2. **Identifier les sélecteurs disponibles** : grep pour `data-testid=` dans les composants concernés. Si manquant sur un bouton clé du flow, ajouter `data-testid` en parallèle (suit la convention `<area>-<action>` ex. `slot-create-button`).

## Procédure

### Étape 1 — Décomposer la description en étapes

Convertis la phrase en une suite d'étapes atomiques. Pour chaque étape, type d'action :

- **goto** : navigation directe (path)
- **click** : action sur un bouton/lien (selector, idéalement `data-testid`)
- **fill** : remplir un input/textarea (selector, valeur)
- **upload** : poser un fichier dans `input[type=file]` (selector, filePath depuis `e2e/fixtures/`)
- **api** : POST/PATCH direct sur une route API (skip ce qui demande RunPod)
- **wait** : pause explicite (ms)

Chaque étape produit une capture full-page nommée `<NN>-<label-kebab>.png` dans `.claude/ux-audit/<ts>/scenarios/<scenario-name>/`.

### Étape 2 — Définir le slug du scenario

Slug kebab-case ASCII, prefix par le domaine si pertinent (ex. `calendar-create-slot-rush`, `medialib-upload-video`, `pattern-toggle-captions-manual`).

### Étape 3 — Vérifier les selectors

Pour chaque step `click` / `fill` / `upload`, vérifie que le selector cible bien un élément unique. Préférence stricte :

1. `[data-testid="..."]` — si présent
2. `[role="..."]:has-text("...")` — pour les rôles ARIA (tab, button, link)
3. `button:has-text("Texte exact")` — fallback texte
4. CSS direct uniquement si rien d'autre n'est possible

Si le sélecteur cible un composant `Chip` custom (rendu en `<span role="button">`), exige un `data-testid` — sinon Playwright timeout.

### Étape 4 — Écrire le scenario

Ajoute l'objet dans la const `SCENARIOS` du fichier `web/scripts/capture-ux-screenshots.ts`, en respectant la structure existante (cf. les scenarios déjà présents pour le format exact). Tu peux passer `settleMs` après chaque action pour laisser le SSR/SSE se stabiliser avant la capture.

### Étape 5 — Tester en isolation

```bash
cd web
pkill -f "next dev -p 3100" 2>/dev/null; sleep 1
npm run ux:capture -- --only=<slug>
```

Le filter substring matche le `name`. Lance avec `--headed --slow` si un step échoue pour voir ce qui se passe.

### Étape 6 — Itérer si échec

Si une étape timeout :
- Vérifie le sélecteur (peut-être un rendu différent que prévu)
- Ajoute `data-testid` au composant cible si nécessaire (commit `feat(ux): data-testid sur X`)
- Augmente `settleMs` si l'élément apparaît après une transition

Si une étape passe mais le screenshot suivant montre un état inattendu :
- Le scenario reflète probablement un bug du workflow réel → reporte-le au user avant de "fixer" le scenario

### Étape 7 — Confirmer au user

Quand le scenario passe 100% :
- Liste les fichiers touchés (capture-ux-screenshots.ts + tout `data-testid` ajouté + extensions seed)
- Propose : "Lance `/audit-ux <slug>` pour rapport sur la cohérence des captures"
- Ne commit pas automatiquement — laisse le user vérifier visuellement les screenshots d'abord

## Constraints importantes

- **Idempotence** : le scenario doit pouvoir être relancé sans cleanup manuel. Si l'état après le scenario empêche la relance (ex. CaptionJob COMPLETED reste dans la DB et fait échouer le step "écrire les sous-titres" à la 2e exécution), **étends `resetSlotState`** pour purger les artefacts générés.

- **Pas de RunPod** : tout ce qui demande RunPod (transcription Whisper, render template, cover frame extraction) doit être skip via une action `api` qui crée directement la ressource résultat (ex. POST cover/manual-select au lieu d'attendre une extraction de frames RunPod).

- **Pas de mocks fictifs** : si tu as besoin d'une PublicationVersion / d'un Render / d'un CaptionJob comme pré-condition, étends le seed (`seedAdminFixtures` ou `seedPatternFixtures`) avec un slug fixture clair (`fixture-<scenario>-<entity>`).

## Cible

$ARGUMENTS
