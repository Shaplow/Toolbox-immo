---
slug: mediaedit-trim-audio
name: MediaEdit — trim + audio (normalize, gain, mixToMono) sur MediaAsset
generatedAt: 2026-06-01T00:00:00Z
---

# MediaEdit trim & audio

## Pitch
Admin édite un MediaAsset vidéo existant : trim début/fin (frame nudge ±1f), audio normalize, gainDb (-24 à +24), mixToMono. Modal player + dual-range scrubber. Crée MediaEditJob → RunPod media_edit (FFmpeg), webhook callback remplace `MediaAsset.url + duration` avec cache-bust `?v=${jobId}`.

## Schéma Mermaid

```mermaid
flowchart LR
  Detail[MediaAssetDetailDrawer] --> Btn[Bouton "Modifier trim/crop/FX"]
  Btn --> Modal[MediaAssetEditModal]
  Modal --> Player[Player + scrubber + audio sliders]
  Player --> POST["POST /edit"]
  POST --> Tx[Atomic check + MediaEditJob create]
  Tx --> Runpod[submitRunpodJob media_edit]
  Runpod --> Webhook["/api/webhooks/runpod/media-edit"]
  Webhook --> Verify[verifyRunpodWebhook timing-safe]
  Verify --> Whitelist[isR2PublicUrl reject non-R2]
  Whitelist --> Update[MediaAsset.url cache-bust + duration]
  POST --> Poll[Polling GET 3s]
  Poll --> Fallback[15min fallback RunPod check]
```

## Entry points UI

| Composant | Fichier:Ligne | Rôle |
|---|---|---|
| MediaAssetDetailDrawer | `components/admin/libraries/mediaAssets/MediaAssetDetailDrawer.tsx:52,375-387` | Bouton "Modifier (trim, crop, FX)" section "Avancé", callback `onOpenTrim` |
| MediaAssetsPanel | `components/admin/libraries/MediaAssetsPanel.tsx` | State `editingAsset`, expose drawer + modal |
| MediaAssetEditModal | `components/admin/libraries/MediaAssetEditModal.tsx:47-263` | Modal fullscreen : player + dual-range scrubber, inputs début/fin/durée + frame nudge ±1f, audio (gainDb slider -24/+24, normalize toggle, mixToMono toggle), "Envoyer au traitement" |

## Routes API

| Méthode | Path | Effets |
|---|---|---|
| POST | `/.../assets/[assetId]/edit:18-165` | **ADMIN only**. Valide params (trim/normalize/gainDb clampé). Rejette no-op. Atomic tx check + MediaEditJob create (anti-double-submit). Submit RunPod si configuré sinon pending. Retour `{jobId, status}` |
| GET | `/.../assets/[assetId]/edit:173-227` | Polling. Dernier MediaEditJob. **Fallback 15min** : si processing >15min → vérifie RunPod direct (webhook manqué) |

## Webhook Callback

| Path | Effets |
|---|---|
| `/api/webhooks/runpod/media-edit:24-114` | `verifyRunpodWebhook` (`?secret=`). Parse output `{duration?, r2_key?, video_url?, error?, job_id?}`. **Race fallback** : si `runpodId` absent → cherche via `job_id`. **Reject non-R2 URLs** (sécurité stored XSS/exfiltration). Update job + MediaAsset (`url ?v=jobId`, duration). Idempotent. |

## Helpers & Libs

- `lib/runpod.ts:291-340` — **`submitRunpodJob`** : smart dispatch (Serverless idle direct OR Pod On-Demand fallback Serverless). Payload `{input: {job_type: "media_edit", job_id, asset_url, r2_key, params: {trimStart, trimEnd, mixToMono, normalize, gainDb}}, webhook}`
- `lib/webhooks/runpod.ts:53-85` — `verifyRunpodWebhook` timing-safe. Prod 503 si secret absent, dev tolère
- `lib/webhooks/runpod.ts:149-164` — `getRunpodWebhookUrl` (NEXTAUTH_URL + secret param)
- `lib/r2.ts:243` — `isR2PublicUrl` whitelist origin (reject non-R2 video_url)

## Modèles Prisma

- **`MediaEditJob`** :
  - `id` (PK cuid), `assetId FK→MediaAsset CASCADE`
  - `status` : pending | processing | done | failed
  - `params` JSON string (MediaEditParams)
  - `runpodId @unique nullable`
  - `errorMsg nullable`
  - `createdAt, updatedAt`
  - Index `[assetId, status]`
- **`MediaAsset`** : `url` updated post-webhook (`?v=jobId`), `duration` probe RunPod, `editJobs[]` inverse relation
- **`MediaEditParams`** type (`types/mediaEdit.ts:1`) : `trimStart?`, `trimEnd?`, `mixToMono`, `normalize`, `gainDb` (-24 à +24)

## Side Effects

- Post-COMPLETED webhook :
  - `MediaAsset.url` remplacé avec `?v=${jobId}` (R2 cache-bust)
  - `MediaAsset.duration` updated (probe RunPod)
- Cache-bust webhook (`:82`) : `url = ${newUrl.split("?")[0]}?v=${job.id}`
- Cache-bust fallback GET 15min (`:205`) : `url = ${asset.url.split("?")[0]}?v=${Date.now()}`

## Client-side Polling

- **POLL_INTERVAL_MS = 3000** (3s)
- États : `idle → submitting → processing → done | failed`
- Erreur en rouge, success ferme modal + callback `onDone`
- `useAssetInlineEdits` optimistic update + invalidation post-edit

## Pré-conditions

- ADMIN seul (`canAdminBypass`)
- Asset existant + vidéo (`mimeType.startsWith("video/")`)
- FFmpeg dispo sur RunPod worker
- R2 configuré (URLs publiques)
- RunPod API key + endpoint ID (fallback pending si absent)
- RUNPOD_WEBHOOK_SECRET requis en prod

## Variantes & Branches

- **Batch apply** (`/.../[id]/batch-apply`) : soumet media_edit + autocut jobs en parallèle
- **Pod On-Demand** : dispatch direct via `_dispatchJobToPod` si pod idle, sinon Serverless
- **No-op rejection** (`:86`) : refuse si trimStart/trimEnd/normalize/mixToMono/gainDb tous empty
- **Frame nudge ±1f** (`:247-255`) : nudgeStart/nudgeEnd, `DEFAULT_FRAME_DUR = 1/25s`

## Variants par rôle

| Rôle | Ce qui change |
|---|---|
| ADMIN | Seul accès |
| Autres | Boutons cachés / API 403 |

## Skills/agents pertinents

- `.claude/skills/content-library/SKILL.md`
- `.claude/skills/render-engine/SKILL.md` (RunPod media_edit FFmpeg)
- Voir aussi : `mediaautocut-batch`, `medialib-admin-crud`
