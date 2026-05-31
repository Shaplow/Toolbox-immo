---
description: Audit UX visuel — capture les surfaces clés de l'app puis analyse les screenshots.
argument-hint: [optionnel : surface(s) précise(s) à cibler, ex. "fiche publication"]
---

Lance un audit UX visuel en deux temps : **capture** puis **analyse**.

## Étape 1 — Capture des screenshots

Exécute le script de capture (génère un dossier timestampé dans `.claude/ux-audit/`) :

```bash
cd web && npm run ux:capture
```

Pré-requis :
- Docker Postgres up : `cd web && npm run infra:up`
- DB de test seedée :
  ```bash
  cd web && npm run test:db:setup && npm run test:db:seed
  ```

Le script :
1. Démarre `next dev` sur le port 3100 (avec DATABASE_URL → toolbox_test) si pas déjà up
2. Login admin via NextAuth credentials (test_admin/testpass)
3. Capture full-page de chaque surface listée dans `scripts/capture-ux-screenshots.ts` (variable `SURFACES`)
4. Output : `.claude/ux-audit/<YYYY-MM-DD_HH-mm>/<surface>.png`
5. Coupe le serveur s'il l'a démarré lui-même

## Étape 2 — Analyse des screenshots

Une fois la capture terminée, lis chaque PNG du dossier output avec le **Read tool** (oui, tu peux ouvrir des images comme tu lirais un fichier — elles arrivent visuellement dans ton contexte multimodal).

Pour chaque surface, rapporte :

### Format de rapport

Pour chaque surface, classe les problèmes en 3 catégories :

- 🔴 **Critique** — Bug logique, incohérence sémantique, info trompeuse, action bloquée. L'utilisateur va se planter.
- 🟡 **Moyen** — Friction UX, redondance, hint manquant, copy ambigu, contraste limite. L'utilisateur est freiné mais s'en sort.
- 🟢 **OK** — Surface propre, rien à signaler.

Pour chaque problème, sois précis :
- Cite la zone (titre de section, label de bouton)
- Décris ce qui cloche en une phrase
- Propose le fix en une phrase

### Ce qu'il faut chercher

**Cohérence sémantique** : un step "Fait" alors qu'aucune ressource n'existe, "En attente" alors que rien ne bloque, etc.

**Doublons & redondance** : breadcrumb + bouton retour, label répété, badge dupliqué.

**Langage Liquid Glass v2** : fond `bg-gray-50` ou `bg-white` plein au lieu de gradient page-shell / cards glass. Cherche les zones qui "cassent" l'unité visuelle.

**Empty states** : sont-ils guidants ou juste un message neutre ?

**Loading / pending** : un spinner qui reste alors que rien ne tourne ?

**Erreurs / blockers** : message jargon technique (RunPod/R2/FK) vs message user-friendly.

**Hierarchie** : titre/subtitle alignés, espacement cohérent entre sections, primary action clairement identifiable.

**Boutons primary** : un seul par surface, le bon (ex. "Enregistrer" et pas "Effacer").

## Sortie attendue

Un rapport markdown structuré par surface, classé par gravité, terminé par une recommandation **"Si je devais fixer une seule chose, ce serait X"**.

Ne propose pas d'implémentation — c'est un audit, pas un sprint. Le user décidera quoi fixer.

## Cible (si fournie)

$ARGUMENTS

Si aucune cible n'est précisée, audite TOUTES les surfaces capturées.
