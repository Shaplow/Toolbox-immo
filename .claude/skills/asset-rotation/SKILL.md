---
name: asset-rotation
description: >
  Understand, debug, and implement the folder-draw asset selection engine in
  Toolbox Immo. Use when a task involves the theme_sequence selection rule
  (folder draw), MediaAsset.setTag folders, per-account isolation
  (MediaAssetUsage), selectMediaAssetFromFolder internals, usage claims at
  submit (advanceMediaUsageOnSubmit), usage revert on render failure, shared
  vs per_account scope, burn-once (maxUsageCount), or selection bugs (wrong
  ordering, repeated folders, wrong account isolation).
---

# Folder-Draw Selection Engine

**Plan simplification Phase 3 (2026-08)** : l'ancien moteur de rotation
(curseurs `AccountLibraryCursor`, catégories/exclusion famille, mode
`override`/`setSequence`, anti-répétition multi-niveaux, simulation admin) est
**décommissionné**. Le modèle actuel : « dossiers simples + tirage
least-recently-used », **zéro état de curseur**.

**Entry point:** `web/src/lib/contentLibraryResolver.ts`
**Usage recording:** `web/src/lib/recordLibraryUsage.ts`
**Mode:** `web/src/lib/rotation/rotationMode.ts` (`"auto" | "none"`)
**Sentinels/pack_:** `web/src/lib/rotation/sentinels.ts`
**Tests:** `web/src/lib/__tests__/folderDraw.media.test.ts`

---

## Core Concepts

| Concept | Model/Field | Description |
|---------|-------------|-------------|
| **Dossier** (UI) | `MediaAsset.setTag` | Assets filmés ensemble (intro + outro). L'unité de tirage. `setTag IS NULL` = dossier virtuel « (sans dossier) », traité normalement. |
| **Mode** | `MediaLibrary.rotationMode` | `"auto"` (tirage par dossier) \| `"none"` (sélection metadata/manuelle). Les valeurs legacy `null`/`"override"` sont lues comme `auto` (normalisées en DB par migration `20260816200000`). |
| **Scope** | `MediaLibrary.rotationScope` | `per_account` : ancienneté par compte (clé `MediaAssetUsage.accountId`) ; `shared` : clé sentinelle `__shared__`. |
| **Burn-once** | `MediaLibrary.maxUsageCount` | N usages max par asset (per-account ou global selon scope) avant sortie du pool. |
| **Réservé** | préfixe `pack_` | Dossiers auto-générés historiques (feature supprimée) — masqués en UI, refusés en écriture. Test unique : `isReservedSetTag()`. |

## L'algo (selectMediaAssetFromFolder)

1. `rotationMode === "none"` → null (le générateur passe par metadata/manuel).
2. `pinnedSetTag` fourni (2ᵉ+ bloc de la même lib dans une génération) →
   pioche directe dans ce dossier. **C'est ce qui garantit qu'une paire
   intro/outro sort du même dossier.**
3. Sinon : `buildFolderDiscoveryQuery` liste les dossiers ayant ≥1 asset
   éligible (accès compte + burn + tagConditions + minDuration), triés :
   `MAX(lastUsedAt) ASC NULLS FIRST` (le moins récemment servi d'abord),
   puis `MIN(createdAt)`, puis `setTag` (LPAD numérique).
4. Dans le dossier : asset au `lastUsedAt` le plus ancien NULLS FIRST,
   tie `createdAt ASC` (`pickFromFolder`).

L'anti-répétition **émerge du tri** : servir un dossier rafraîchit son
`MAX(lastUsedAt)` → il redescend dans la pile. Aucun état à gérer, rien à
reverter côté « curseur ».

## Cycle de vie d'une génération

```
SSR prefill (resolveLibraryPrefill)    → READ-ONLY, aucune écriture.
POST /api/renders                      → advanceMediaUsageOnSubmit :
                                         stamp MediaAssetUsage.lastUsedAt=now
                                         (clé = accountId réel ou __shared__),
                                         snapshot prevMediaUsageStates.
render DONE (recordLibraryUsage)       → increment usageCount.
render ERROR (revertLibraryCursors)    → CAS revert des stamps lastUsedAt
kickoff failure (revertAdvancesOnFailure route.ts) → idem, en mémoire.
```

Les autres stratégies (`least_used`, `oldest_used`, `random`, metadata) vivent
dans `selectMediaAsset` / `selectAndClaimMediaAsset` (claim atomique
FOR UPDATE SKIP LOCKED au render) — inchangées.

## Pièges

- **Ne jamais réintroduire d'état de curseur.** Si un besoin d'ordre strict
  revient, c'est une feature produit à re-discuter, pas un fix.
- `buildAccessFilter` utilise TOUJOURS le compte réel (visibilité), même quand
  la clé d'usage est `__shared__`.
- Renders en vol pré-Phase 3 : leurs `usedAssets` contiennent encore des
  `prevCursorStateByLibrary` — les chemins de revert les tolèrent (no-op après
  le drop de la table). À purger au drop N+1.
- La partie **DataEntry** (`selectDataEntry`) est encore sur l'ancien modèle
  (campagnes/policies) — réalignement prévu en Phase 4 du plan simplification.
