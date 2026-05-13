# Plan : Atelier RVA4 Autocut

**Date de rédaction :** 11 mai 2026  
**Status :** À implémenter — plan validé après revue

## Contexte

On a une centaine de rushes bruts d'intro/outro RVA4 (~20s chacun) dans une `MediaLibrary` de type vidéo. Ces fichiers doivent être polis avant d'être utilisables en rotation : trouver automatiquement le bon point de départ/fin (autocut via Whisper), corriger l'audio (mix to mono, normalisation, volume), et valider les résultats avant d'écraser les originaux.

L'outil d'édition individuel (`MediaAssetEditModal`) et le pipeline `media_edit` RunPod existent déjà et fonctionnent. Ce plan construit **par-dessus** cet existant sans le modifier.

---

## Objectif final

Un **"Atelier"** accessible depuis le panel d'assets d'une MediaLibrary vidéo, qui permet de :

1. **Sélectionner** N assets d'une lib
2. **Envoyer des packs Whisper** à RunPod (1 RunPod job = 1 pack de 20 assets max) pour obtenir les timings proposés
3. **Valider asset par asset** dans une file de review : preview vidéo aux timings proposés, texte transcript, champs ajustables manuellement
4. **Appliquer** les cuts validés en batch (1 RunPod `media_edit` job par asset, soumis en parallèle)
5. Les fichiers **écrasent les originaux** sur R2 via le webhook `media-edit` existant

---

## Stack existant réutilisé (ne pas modifier)

| Composant | Fichier(s) |
|-----------|-----------|
| Edit individuel UI | `web/src/components/admin/libraries/MediaAssetEditModal.tsx` |
| API edit | `web/src/app/api/admin/libraries/media/assets/[assetId]/edit/route.ts` |
| Worker media_edit | `render-engine/engine/media_edit.py` + `runpod_worker.py` handler |
| Webhook media-edit | `web/src/app/api/webhooks/runpod/media-edit/route.ts` |
| Transcription WhisperX | `render-engine/engine/transcribe.py` → `transcribe_with_word_timestamps()` |
| SSE store | `web/src/lib/sseStore.ts` (jobType "media-edit" déjà présent) |

---

## Nouveaux modèles Prisma

### `MediaAutocutBatch`

Représente un **pack RunPod** : un seul job RunPod traite N assets en série (Whisper chargé une seule fois).

```prisma
model MediaAutocutBatch {
  id         String              @id @default(cuid())
  libraryId  String
  library    MediaLibrary        @relation(fields: [libraryId], references: [id], onDelete: Cascade)
  /// "pending" | "processing" | "done" | "partial" | "failed"
  status     String              @default("pending")
  totalCount Int                 @default(0)
  doneCount  Int                 @default(0)
  failCount  Int                 @default(0)
  runpodId   String?             @unique
  errorMsg   String?
  createdAt  DateTime            @default(now())
  updatedAt  DateTime            @updatedAt
  jobs       MediaAutocutJob[]
}
```

### `MediaAutocutJob`

Représente l'analyse Whisper d'**un seul asset**. Lié optionnellement à un batch.

```prisma
model MediaAutocutJob {
  id            String             @id @default(cuid())
  assetId       String
  asset         MediaAsset         @relation(fields: [assetId], references: [id], onDelete: Cascade)
  libraryId     String
  library       MediaLibrary       @relation(fields: [libraryId], references: [id], onDelete: Cascade)
  batchId       String?
  batch         MediaAutocutBatch? @relation(fields: [batchId], references: [id], onDelete: SetNull)
  /// "pending" | "processing" | "done" | "failed"
  status        String             @default("pending")
  /// Détecté par Whisper (en secondes, avec padding 0.15s)
  proposedStart Float?
  proposedEnd   Float?
  /// JSON [{ text, start, end }] — segments niveau phrase uniquement (pas les mots)
  transcriptJson String?
  language      String?
  /// "pending_review" | "accepted" | "skipped" | "applied"
  reviewStatus  String             @default("pending_review")
  /// Timings confirmés par l'admin (peut différer de proposed si ajustement manuel)
  confirmedStart Float?
  confirmedEnd   Float?
  /// FK vers le MediaEditJob créé lors de l'apply (pour suivre l'état de l'écriture)
  editJobId     String?            @unique
  editJob       MediaEditJob?      @relation(fields: [editJobId], references: [id], onDelete: SetNull)
  errorMsg      String?
  createdAt     DateTime           @default(now())
  updatedAt     DateTime           @updatedAt
}
```

### Modifications sur les modèles existants

- `MediaLibrary` : ajouter `autocutBatches MediaAutocutBatch[]` et `autocutJobs MediaAutocutJob[]`
- `MediaAsset` : ajouter `autocutJobs MediaAutocutJob[]`
- `MediaEditJob` : ajouter `autocutJob MediaAutocutJob?` (relation inverse)

---

## Paramètres MediaEditParams — ajouts

Le modèle `params` du `MediaEditJob` existant est un JSON libre. Ajouter le support de `gainDb` dans `media_edit.py` sans toucher les jobs existants (champ optionnel, nullable).

```python
@dataclass
class MediaEditParams:
    trim_start: float | None = None
    trim_end: float | None = None
    mix_to_mono: bool = False
    normalize: bool = False
    gain_db: float | None = None    # NOUVEAU — ex: +3.0 ou -6.0
```

FFmpeg filter chain : `volume=3dB` inséré avant `loudnorm` si les deux sont activés. Plage autorisée : `-24` à `+24` dB.

---

## Phases d'implémentation

---

### Phase 1 — Prisma : nouveaux modèles

**Layer :** web  
**Fichier :** `web/prisma/schema.prisma`  
**Migration :** `cd web && npm run db:migrate` (nom suggéré : `add_autocut_module`)

Changements :
- Ajouter `MediaAutocutBatch` et `MediaAutocutJob` comme décrit ci-dessus
- Ajouter les relations inverses sur `MediaLibrary`, `MediaAsset`, `MediaEditJob`

**Validation :** `cd web && npm run db:generate` puis `npx prisma migrate status`  
**Commit :** `feat(prisma): add MediaAutocutBatch and MediaAutocutJob models`  
**Risque :** faible — nouveaux modèles, aucun changement sur l'existant

---

### Phase 2 — Render-engine : job_type `media_autocut_batch`

**Layer :** render-engine  
**Fichiers nouveaux :** `render-engine/engine/autocut.py`  
**Fichiers modifiés :** `render-engine/runpod_worker.py`

#### `autocut.py`

Fonction principale :

```python
def analyze_autocut(
    audio_path: Path,
    model_size: str = "large-v3-turbo",
    language: str = "fr",
    padding_start: float = 0.15,   # secondes de marge avant le 1er mot
    padding_end: float = 0.20,     # secondes de marge après le dernier mot
) -> dict:
    """
    Analyse un fichier audio/vidéo et retourne les timings de coupe proposés.
    Utilise transcribe_with_word_timestamps() existant (avec cache Whisper).

    Retourne :
    {
        "proposed_start": float,    # max(0, first_word.start - padding_start)
        "proposed_end": float,      # min(duration, last_word.end + padding_end)
        "transcript_json": [...],   # [{ "text", "start", "end" }] — niveau segment
        "language": str
    }

    En cas d'échec de l'alignement mot par mot, fallback sur les bornes
    des segments Whisper (moins précis mais non-bloquant).
    """
```

Logique interne :
1. Appel `transcribe_with_word_timestamps()` (cache réutilisé entre les assets du pack)
2. Parcourir tous les segments pour trouver le premier et dernier mot avec timestamp
3. Appliquer padding + clamp aux bornes de la durée réelle du fichier
4. Fallback si alignement échoue : `segments[0]["start"]` / `segments[-1]["end"]`
5. `transcript_json` = liste de segments niveau phrase uniquement (pas les mots individuels)

#### Worker — handler `media_autocut_batch`

```
Input RunPod :
{
  "job_type": "media_autocut_batch",
  "batch_id": "clxxx",           ← MediaAutocutBatch.id (pour logs)
  "language": "fr",
  "model_size": "large-v3-turbo",
  "assets": [
    { "job_id": "clyyy", "asset_url": "https://..." },
    { "job_id": "clzzz", "asset_url": "https://..." },
    ...  max 20 items
  ]
}

Output webhook :
{
  "batch_id": "clxxx",
  "results": [
    {
      "job_id": "clyyy",
      "proposed_start": 0.45,
      "proposed_end": 18.72,
      "transcript_json": [...],
      "language": "fr"
    },
    {
      "job_id": "clzzz",
      "error": "download failed: 404"
    }
  ]
}
```

Le worker :
1. Télécharge chaque asset dans un tempdir
2. Appelle `analyze_autocut()` pour chaque fichier
3. Capture les exceptions par fichier (erreur d'un asset n'arrête pas le pack)
4. Retourne le tableau `results` complet

**Validation :** test local via `render-engine/api.py` (FastAPI) avant RunPod  
**Commit :** `feat(render-engine): media_autocut_batch job type via WhisperX`  
**Risque :** moyen — dépend de la disponibilité du modèle d'alignement WhisperX sur le worker RunPod. Tester en priorité sur l'endpoint RVA4 avec 2-3 assets.

---

### Phase 3 — Web : API routes + webhooks

**Layer :** web

#### Routes nouvelles

| Route | Méthode | Description |
|-------|---------|-------------|
| `/api/admin/libraries/media/[libraryId]/autocut-packs` | POST | Crée un ou plusieurs `MediaAutocutBatch` + leurs jobs, soumet à RunPod |
| `/api/admin/libraries/media/[libraryId]/autocut-queue` | GET | Liste les `MediaAutocutJob` de la lib pour la review (filtrables par reviewStatus) |
| `/api/admin/libraries/media/autocut/[jobId]` | PATCH | Valide / skip / ajuste un job individuel |
| `/api/admin/libraries/media/[libraryId]/batch-apply` | POST | Applique tous les jobs `accepted` en soumettant des MediaEditJobs RunPod |
| `/api/webhooks/runpod/media-autocut` | POST | Reçoit le résultat du batch Whisper, résout les jobs individuels |

---

#### `POST /autocut-packs`

```
Body : { assetIds: string[], language?: string, modelSize?: string }

Sécurité :
- Vérifie que TOUS les assetIds appartiennent à libraryId (sinon 403) :
    await prisma.mediaAsset.findMany({
      where: { id: { in: assetIds }, libraryId }
    })
    if (assets.length !== assetIds.length) → 403
- Admin only
- Ignore les assets ayant déjà un autocutJob en pending/processing

Logique :
1. Filtrer les assetIds avec job actif (éviter double-submit)
2. Découper en packs de 20 max
3. Pour chaque pack :
   a. Créer MediaAutocutBatch en DB (status: "pending", totalCount: N)
   b. Créer N MediaAutocutJob en DB (status: "pending", batchId)
   c. Soumettre RunPod job_type "media_autocut_batch"
   d. Mettre à jour batch.runpodId + status "processing"
4. Retourner { batches: [{ batchId, assetCount, status }], skipped: string[] }
```

---

#### `GET /autocut-queue`

```
Query params : ?reviewStatus=pending_review|accepted|skipped|applied&page=1&pageSize=20

Retourne :
{
  jobs: [{
    id, assetId, status, reviewStatus,
    proposedStart, proposedEnd, confirmedStart, confirmedEnd,
    transcriptJson, language, errorMsg,
    asset: { id, filename, url, duration },
    editJob: { id, status } | null   ← pour afficher l'état de l'apply
  }],
  total, page, pageSize
}

Tri par défaut : pending_review d'abord, puis createdAt ASC
```

---

#### `PATCH /autocut/[jobId]`

```
Body : {
  reviewStatus: "accepted" | "skipped",
  confirmedStart?: number,
  confirmedEnd?: number
}

- Admin only
- Vérifie que le job appartient à une lib de l'admin (via libraryId)
- Met à jour reviewStatus, confirmedStart, confirmedEnd
- Ne peut pas passer à "applied" ici — c'est réservé à batch-apply
```

---

#### `POST /batch-apply`

```
Body : { jobIds?: string[] }
Si jobIds omis → applique tous les jobs "accepted" de la lib

Pour chaque job :
1. Vérifier reviewStatus === "accepted" ET confirmedStart/confirmedEnd présents
2. Créer MediaEditJob avec params :
   { trimStart: confirmedStart, trimEnd: confirmedEnd, mixToMono, normalize, gainDb }
   (mixToMono/normalize/gainDb fournis dans le body ou défaut false/null)
3. Soumettre RunPod media_edit (pipeline existant, webhook existant)
4. Mettre à jour autocutJob.editJobId + reviewStatus → "applied"

Retourne : { submitted: number, failed: [{ jobId, error }] }

Note : les soumissions RunPod sont faites en parallèle (Promise.allSettled)
— pas séquentielles depuis le client.
```

---

#### `POST /api/webhooks/runpod/media-autocut`

```
Même pattern que /webhooks/runpod/media-edit (verifyRunpodWebhook).

Output du worker :
{ batch_id, results: [{ job_id, proposed_start?, proposed_end?, transcript_json?, language?, error? }] }

Traitement :
1. Trouver le MediaAutocutBatch via runpodId ou batch_id (race condition fallback identique à media-edit)
2. Pour chaque résultat :
   a. Si succès : update MediaAutocutJob(
        status: "done", reviewStatus: "pending_review",
        proposedStart, proposedEnd, transcriptJson, language
      )
   b. Si erreur : update MediaAutocutJob(status: "failed", errorMsg)
3. Update MediaAutocutBatch :
   doneCount, failCount, status → "done" | "partial" | "failed"
4. SSE push (jobType: "media-autocut", batchId, doneCount, failCount)
   — pour que l'UI se rafraîchisse sans polling

Idempotence : si batch déjà "done" ou "failed", répondre 200 sans retraiter.
```

**Validation :** lint sur les nouveaux fichiers, test curl sur autocut-packs + webhook mock  
**Commit :** `feat(web): MediaAutocutJob API routes and RunPod webhook`  
**Risque :** moyen — vérifier la gestion de la race condition webhook (même pattern que media-edit, bien documenté)

---

### Phase 4 — Web UI : Atelier batch

**Layer :** web  
**Fichiers nouveaux :**
- `web/src/components/admin/libraries/MediaBatchAutocutPanel.tsx`
- `web/src/components/admin/libraries/AutocutReviewCard.tsx`

**Fichiers modifiés :**
- `web/src/components/admin/libraries/MediaAssetsPanel.tsx` — ajout bouton "Atelier" (conditionnel `library.type === "video"` uniquement)

---

#### Structure du panel

**Vue 1 — Sélection & Analyse**

```
┌─ Atelier Autocut ─────────────────────────────────────────────────────┐
│  [← Retour]                                  [Analyser la sélection (N)]│
│                                                                          │
│  ☑ Tout sélectionner   Filtre : [ À analyser ▾ ]                        │
│                                                                          │
│  ☑  rush_001.mp4   20.3s   ○ En attente                                 │
│  ☑  rush_002.mp4   19.8s   ◌ En cours...                                │
│  ☐  rush_003.mp4   21.1s   ✓ Analysé → À valider                        │
│  ☐  rush_004.mp4   18.7s   ✗ Erreur   [Réessayer]                       │
│  ...                                                                     │
└──────────────────────────────────────────────────────────────────────────┘
```

- La sélection ignore les assets ayant déjà un job pending/processing
- Bouton "Analyser" désactivé si 0 assets sélectionnés
- Le statut par asset est mis à jour via SSE ou polling 5s
- Un badge "N à valider" incite à passer en Vue 2

**Vue 2 — File de review**

```
┌─ Review — 47 à valider ──────────────────────────────────────────────┐
│  [← Vue sélection]         [Appliquer tous les validés (12) →]       │
│  Validés: 12 | Passés: 3 | Restants: 32                              │
│─────────────────────────────────────────────────────────────────────│
│  rush_001.mp4                                                         │
│  ┌────────────────────────────────┐                                   │
│  │  [VIDEO PREVIEW avec seek]     │  "Bonjour, aujourd'hui on est    │
│  │  ▶ 0:00 / 0:07                 │   dans un appartement..."        │
│  └────────────────────────────────┘                                   │
│  Début  [< 0.45 >]   Fin  [< 18.72 >]   Durée : 18.27s              │
│                                                                       │
│  Audio : [☐ Mix mono]  [☐ Normaliser]  Volume : [──●── +0 dB]        │
│                                                                       │
│  [✗ Passer]                              [✓ Valider]                 │
│─────────────────────────────────────────────────────────────────────│
│  rush_002.mp4   ...                                                   │
└──────────────────────────────────────────────────────────────────────┘
```

Comportement des cards :
- La vidéo est seekée automatiquement à `confirmedStart` (ou `proposedStart`) au montage
- Les champs début/fin sont des inputs numériques (identique à `MediaAssetEditModal`)
- Le slider volume affiche `gainDb` de -12 à +12 dB, valeur par défaut 0
- "Valider" → PATCH reviewStatus=accepted + confirmedStart/End
- "Passer" → PATCH reviewStatus=skipped (l'asset n'est pas touché)
- La card disparaît de la vue après validation/skip (ou collapse animé)

Bouton "Appliquer tous les validés (N)" :
- Appelle `POST /batch-apply`
- Affiche une barre de progression pendant les soumissions RunPod
- Les cards correspondantes passent en état "En cours d'application..."
- Quand le webhook media-edit arrive (SSE), la card passe à "✓ Appliqué"

---

**Commit :** `feat(web): MediaBatchAutocutPanel and AutocutReviewCard UI`  
**Risque :** moyen — le seek vidéo HTML5 peut être imprécis sur des MP4 sans `moov` atom en tête (rushes bruts). Fallback : afficher les timecodes en texte si `video.fastSeek` n'est pas supporté ou si le seek dépasse la durée chargée.

---

## Ordre de commit complet

| # | Commit | Migration ? |
|---|--------|-------------|
| 1 | `feat(prisma): add MediaAutocutBatch and MediaAutocutJob models` | **oui** |
| 2 | `feat(render-engine): media_autocut_batch job type via WhisperX` | non |
| 3 | `feat(render-engine): add gainDb support to MediaEditParams` | non |
| 4 | `feat(web): MediaAutocutJob API routes, webhook, batch-apply` | non |
| 5 | `feat(web): MediaBatchAutocutPanel and AutocutReviewCard UI` | non |

---

## Zones de risque

### Risque 1 — Modèle d'alignement WhisperX (HAUT)

`transcribe_with_word_timestamps()` charge un modèle d'alignement par langue via pyannote. Ce modèle peut ne pas être disponible sur certains endpoints RunPod, ou échouer si la langue détectée n'est pas `fr`.

**Mitigation :**
- Dans `autocut.py`, wrapper l'alignement dans un try/except
- Fallback : utiliser `segments[0]["start"]` et `segments[-1]["end"]` des segments bruts Whisper
- Logger explicitement le fallback pour que l'admin sache que les timings sont moins précis

### Risque 2 — Taille des packs et cold start (MOYEN)

100 assets → 5 packs de 20 soumis en parallèle. Si l'endpoint RunPod est en cold start, les 5 workers chargent chacun WhisperX. Sur `large-v3-turbo`, le chargement prend ~30-60s. Le premier pack d'un batch froid sera lent ; les suivants bénéficient du cache worker si le même process reste chaud.

**Mitigation :** Cap dur à 20 assets par pack. Documenter dans l'UI que l'analyse peut prendre 2-5 minutes pour 100 assets selon la disponibilité GPU.

### Risque 3 — Seek vidéo imprécis sur rushes bruts (MOYEN)

Les fichiers sortis caméra n'ont pas forcément le `moov` atom en tête du fichier MP4. Le seek HTML5 peut être imprécis ou ne pas fonctionner du tout.

**Mitigation :** Fallback texte si seek échoue. Long terme : envisager de passer les assets uploadés par un `ffmpeg -movflags +faststart` au moment de l'upload (hors scope de ce plan).

### Risque 4 — Race condition webhook (FAIBLE)

Le webhook RunPod peut arriver avant que `MediaAutocutBatch.runpodId` soit écrit en DB (identique au problème connu sur media-edit). Utiliser le même pattern : fallback sur `batch_id` dans l'output du worker (backfill `runpodId` si absent).

### Risque 5 — Sécurité : assetIds libres dans le body (FAIBLE après mitigation)

Le body de `POST /autocut-packs` accepte une liste d'assetIds. Sans vérification, un admin pourrait cibler des assets d'une autre lib.

**Mitigation :** Vérification obligatoire en Phase 3 (décrite dans la route ci-dessus).

---

## Ce que ce plan ne fait PAS (hors scope délibéré)

- Modification du pipeline d'upload (faststart, probe)
- Modification de la rotation ou des usages des assets
- Accès depuis les comptes non-admin (c'est un outil admin uniquement)
- Export ou download des fichiers polis (déjà disponible via le bouton download existant)
- Interface mobile ou optimisation tactile

---

## Agents recommandés après implémentation

- `@code-reviewer` — sur `MediaBatchAutocutPanel.tsx`, `autocut-packs/route.ts`, `batch-apply/route.ts`
- `@bug-hunter` — sur le module complet (double-submit, webhook replay, race conditions batch)
- `@security-auditor` — sur les routes qui acceptent des `assetIds` libres dans le body
