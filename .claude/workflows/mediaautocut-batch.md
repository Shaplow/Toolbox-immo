---
slug: mediaautocut-batch
name: MediaAutocut — batch découpe rushes vidéo via Whisper STT + apply
generatedAt: 2026-06-01T00:00:00Z
---

# MediaAutocut batch

## Pitch
Admin sélectionne N assets vidéo dans une MediaLibrary, lance un batch Whisper qui détecte les coupures (silence, prises multiples, transcript). UI review propose les cuts, admin valide/skip, batch-apply crée N MediaEditJob via RunPod media_edit (trim), résultats remplacent l'asset original ou créent variant.

## Schéma Mermaid

```mermaid
flowchart LR
  Panel[MediaBatchAutocutPanel] --> Submit[Sélection assets + Submit]
  Submit --> CreateBatch[MediaAutocutBatch + N MediaAutocutJob pending]
  CreateBatch --> Runpod["RunPod /autocut (Whisper)"]
  Runpod --> Webhook["POST /api/webhooks/runpod/media-autocut"]
  Webhook --> Done[Jobs status=done + proposedStart/End + transcript]
  Done --> ReviewUI[AutocutReviewCard]
  ReviewUI --> Accept[PATCH /autocut/[jobId] reviewStatus=accepted]
  ReviewUI --> Apply[POST /batch-apply]
  Apply --> EditJobs[N MediaEditJob → RunPod media_edit]
  EditJobs --> WebhookEdit["/api/webhooks/runpod/media-edit"]
  WebhookEdit --> Final[Asset updated avec trim final]
```

## Entry points UI

| Composant | Fichier:Ligne | Rôle |
|---|---|---|
| MediaBatchAutocutPanel | `components/admin/libraries/MediaBatchAutocutPanel.tsx:49` | Modal 2 vues (sélection + review) |
| Button "Analyser" | `MediaBatchAutocutPanel.tsx:258` | POST `/autocut-packs` |
| Button "Valider" | `MediaBatchAutocutPanel.tsx:292` | PATCH `/autocut/[jobId]` + POST `/batch-apply` |
| Button "Réinitialiser" | `MediaBatchAutocutPanel.tsx:233` | DELETE `/autocut-jobs` (non-appliqués) |
| AutocutReviewCard | `components/admin/libraries/AutocutReviewCard.tsx:28` | Card review avec éditeur timings/transcript + take detection |
| Button "Analyse auto" | `mediaAssets/MediaAssetsToolbar.tsx:75` | Conditionnel `library.type=video` |
| Trigger | `MediaAssetsPanel.tsx:61` | useState showAtelier → Modal |

## Routes API

| Méthode | Path | Effets |
|---|---|---|
| POST | `/.../[id]/autocut-packs:22` | Crée MediaAutocutBatch + N MediaAutocutJob, submit RunPod (max 20 assets/pack) |
| GET | `/.../[id]/autocut-queue:17` | Jobs filtrés (reviewStatus, page, lean mode) |
| PATCH | `/.../autocut/[jobId]:18` | accepted/skipped + confirmedStart/End |
| POST | `/.../[id]/batch-apply:26` | Crée MediaEditJob pour chaque accepted, submit RunPod media_edit (Promise.allSettled) |
| DELETE | `/.../[id]/autocut-jobs:18` | Cleanup non-applied (orphelin batch) |

## Webhooks — Callbacks RunPod

| Path | Effets |
|---|---|
| `/api/webhooks/runpod/media-autocut:30` | Reçoit batch Whisper (`results=[{job_id, proposed_start, proposed_end, transcript_json, language, error}]`) |
| `/api/webhooks/runpod/media-autocut:44` | **Race condition fallback** : utilise `output.batch_id` si runpodId introuvable (backfill runpodId) |
| `/api/webhooks/runpod/media-autocut:85` | SSE notifyAll : broadcast media-autocut status |
| `/api/webhooks/runpod/media-edit:24` | Reçoit cut appliqué (duration, r2_key/video_url, cache-bust `?v=jobId`) |

## Modèles Prisma

- **`MediaAutocutBatch`** — `id, libraryId→CASCADE, status (pending|processing|done|partial|failed), totalCount, doneCount, failCount, runpodId @unique?, errorMsg?, createdAt, updatedAt, jobs[]`
- **`MediaAutocutJob`** — `id, assetId→CASCADE, libraryId, batchId?, status (pending|processing|done|failed), proposedStart/End, transcriptJson, language, reviewStatus (pending_review|accepted|skipped|applied), confirmedStart/End, editJobId @unique?, errorMsg?, @@index [assetId, status]`
- `MediaLibrary` — relations `autocutBatches[], autocutJobs[]`
- `MediaAsset` — relation `autocutJobs[]`
- `MediaEditJob` — relation `autocutJob` inverse de `editJobId`

## Helpers & Services

- `lib/runpod.ts` — `submitRunpodJob()` générique (utilisé par autocut-packs + batch-apply)
- `lib/sseStore.ts:9` — JobEventPayload avec jobType `"media-autocut"`
- `components/admin/libraries/AutocutReviewCard.tsx:110` — **`detectTakes()`** : détection prises multiples via gaps mots Whisper + scoring (confidence, hesitation, rate, length, completeness)

## Validations & Schémas

- `lib/validation/apiSchemas.ts` — JobType enum inclut `"autocut"` (audit trails)

## Pré-conditions & Sécurité

- **Admin only** : `userContext.canAdminBypass` (403 sinon)
- **Lib video** : autocut réservé à `library.type === "video"` (400 si audio)
- **Asset ownership** : `mediaAsset.findMany({libraryId, id: { in: assetIds }})` (403 si mismatch)
- **Active job filtering** : ignore assets avec job pending/processing (`updatedAt > 2h`) anti double-submit
- **ReviewStatus flow** : `pending_review → accepted/skipped → applied` (skipped=DELETE, accepted=PATCH)
- **Webhook verification** : `verifyRunpodWebhook()` via `RUNPOD_WEBHOOK_SECRET`
- **Idempotence** : batch webhook rejuge si status déjà done/partial/failed ; job webhook upsert via runpodId OU fallback batch_id

## Variants & Configurations

- **Language** : query param défault `"fr"` (POST `/autocut-packs`)
- **Model size** : query param défault `"large-v3-turbo"` (Whisper)
- **Audio options** (batch-apply) : `mixToMono`, `normalize`, `gainDb ([-24, +24] dB, nullable)`
- **Padding Whisper** : 0.15s avant premier mot, 0.20s après dernier (fallback segments si alignement fail)
- **PACK_SIZE** : 20 assets/batch (hardcoded, optimise cache Whisper)
- **POLL_INTERVAL_MS** : 5000 (UI panel)
- **STALE_THRESHOLD_MS** : 2h (autorisé re-submit si webhook perdu)

## État du workflow

✅ Implémenté : Prisma models, 5 API routes, 2 webhooks, UI panel + AutocutReviewCard + take detection, helpers RunPod + SSE

❓ Render-engine côté (à vérifier) : `/render-engine/engine/autocut.py` (analyze_autocut, detect silence/prises), worker handler `media_autocut_batch`, MediaEditParams `gainDb` support

## Skills/agents pertinents

- `.claude/skills/content-library/SKILL.md` (MediaAutocutJob)
- `.claude/skills/render-engine/SKILL.md` (RunPod media_edit, Whisper STT)
