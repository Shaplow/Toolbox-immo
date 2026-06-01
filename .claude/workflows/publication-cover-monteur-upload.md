---
slug: publication-cover-monteur-upload
name: Publication — cover monteurUpload (le monteur dépose la cover finale)
generatedAt: 2026-06-01T00:00:00Z
---

# Publication — cover monteur upload (Phase 2.5)

## Pitch
Pour un slot dont le pattern `coverMode = "monteurUpload"`, c'est le monteur qui upload directement la cover en image (PNG/JPG/WEBP) — pas d'extraction de frames, pas de sélection CM. La cover est rattachée à la version courante (PublicationVersion). Step ProductionChain → "Cover (monteur)".

## Schéma Mermaid

```mermaid
flowchart LR
  Fiche[CoverSection branche monteurUpload] --> Drop[Dropzone monteur]
  Drop --> Validate[Validation MIME / 20Mo max]
  Validate --> Upload["POST /api/publications/[id]/upload-cover"]
  Upload --> R2[Upload R2 publications/{slotId}/cover-monteur/]
  R2 --> Pack[CoverFramePack SELECTED + finalCoverUrl]
  Pack --> Promote[promoteCoverPack → slot.activeCoverPackId]
  Promote --> Activity[logActivity COVER_COMPLETED uploadedBy: monteur]
```

## Entry points UI

| Composant | Fichier:Ligne | Rôle |
|---|---|---|
| CoverSection branche monteurUpload | `web/src/components/publications/sections/CoverSection.tsx:180` | Dropzone monteur (mode=monteurUpload) |
| Handler upload | `CoverSection.tsx:149` | POST `/api/publications/[id]/upload-cover` |
| Bouton "Remplacer" | `CoverSection.tsx:202` | Si cover existe et `canMonteurUpload` |
| PublicationFiche | `PublicationFiche.tsx:88,180,807` | PRIMARY_SECTIONS_BY_ROLE.MONTEUR inclut "cover" si mode=monteurUpload + canMonteurUpload résolu (ADMIN OU MONTEUR assigné) |

## Routes API

| Méthode | Path | Fichier | Effets |
|---|---|---|---|
| POST | `/api/publications/[id]/upload-cover` | `upload-cover/route.ts` | Multipart upload (20 Mo max) + crée/update CoverFramePack SELECTED |

Gates :
- `effectiveCoverMode === "monteurUpload"` obligatoire (`route.ts:61`)
- Rôle : ADMIN OR (MONTEUR && `assigneeMonteurId === userId`) (`route.ts:68`)
- MIME whitelist : `image/png`, `image/jpeg`, `image/webp` (`route.ts:80`)
- R2 key : `publications/{slotId}/cover-monteur/{timestamp}.{ext}` (`route.ts:96`)

## Helpers / triggers

- `web/src/lib/publications/jobLifecycle.ts:200` — `promoteCoverPack()` (idem autoPack/manualSelect)
- `web/src/lib/publications/jobLifecycle.ts:62` — `resolveActiveCoverPack()` (SELECTED non-stale, fallback latest COMPLETED)
- Logique route upload-cover :
  - Cherche pack existant via `publicationVersionId` (linked au currentVersion)
  - Si existe : update `status=SELECTED, finalCoverUrl, errorMsg=null` (`route.ts:129`)
  - Sinon : create avec `config = '{"mode":"monteurUpload"}'` (`route.ts:149`)
  - Fallback orphelin si pas currentVersion : `config = '{"mode":"monteurUpload", "orphan":true}'` (`route.ts:159`)

## Modèles Prisma touchés

- `CoverFramePack` (`schema.prisma:295-335`) :
  - `status: "SELECTED"` direct (skip QUEUED/PROCESSING)
  - `finalCoverUrl` = URL R2 publique
  - `finalCoverKey` = clé R2 dédiée
  - `config = '{"mode":"monteurUpload"}'`
  - `frameCount = 0` (pas de candidates)
  - `publicationVersionId` = currentVersion (ou null si orphelin)
- `AccountPattern.coverMode = "monteurUpload"`

## Validation cohérence (C6)

`web/src/lib/publications/patternValidation.ts:94` — règle **C6 `MONTEUR_UPLOAD_REQUIRES_MANUAL_RUSHES`** :
- `coverMode === "monteurUpload"` exige `source === "manual_rushes"`
- Sinon erreur "Le mode « Upload par le monteur » nécessite une source manual_rushes"

## Steps & roles

`web/src/lib/publications/steps.ts:432,457` :
- Label dynamique : `pattern?.coverMode === "monteurUpload" ? "Cover (monteur)" : "Cover"` (V8.7)
- Roles ajustés : `monteurUpload` → `["MONTEUR", "CM"]` (vs `["CM"]` par défaut)
- Step `cover` ignore `needsClientValidation` pour ne pas bloquer (monteur upload avant validation)

## Side effects

- `logActivity` type `COVER_COMPLETED` avec payload `{ coverFramePackId, finalCoverUrl, uploadedBy: "monteur" }`
- Pas d'extraction RunPod (skip toute la chaîne autoPack)

## Diff vs autoPack vs manualSelect

| Aspect | autoPack | manualSelect | monteurUpload |
|---|---|---|---|
| Extraction frames | RunPod automatique | Tirage libre côté front | **Pas d'extraction** |
| Sélection | CM choisit candidate | CM choisit frame | Monteur uploade direct |
| Étape | Après render/validation client | Indépendant | Pendant la phase montage |
| `frameCount` | N candidates | 0 | 0 |
| `config` mode | (preset settings) | `{mode:"manual"}` | `{mode:"monteurUpload"}` |

## Pré-conditions / invariants

- `pattern.coverMode === "monteurUpload"` + `source === "manual_rushes"` (C6)
- ADMIN OR (MONTEUR && assigné)
- MIME image valide (PNG/JPG/WEBP)
- Taille ≤ 20 Mo
- currentVersion idéal (sinon flag `orphan: true`)

## Variants par rôle

| Rôle | Ce qui change |
|---|---|
| MONTEUR (assigné) | Dropzone visible, peut uploader/remplacer |
| ADMIN | Idem MONTEUR + voit tout |
| CM | Visualise le résultat (cover en aval) |
| Autres | N'a pas accès |

## Skills/agents pertinents

- `.claude/skills/admin-permissions/SKILL.md` (permissions par rôle)
- `.claude/skills/ui-design/SKILL.md` (dropzone)
- Agent `toolbox-generalist`

## Liens vers code

- Test cohérence : `pattern-coherence.test.ts:243-265` (P6 cover monteur)
- E2E : audit-ux pattern fixture P6
