---
name: description-generation
description: >
  Work with the description generation module in Toolbox Immo. Use when a task
  involves DescriptionJob, DescriptionPrompt, the /api/description/ routes,
  DescriptionTool.tsx, admin prompt management, transcript/image inputs, or
  the Claude/GPT model selection for generating property descriptions.
---

# Description Generation

Use this skill when the task involves the description generation module: generating
text from transcriptions and/or reference images, managing prompts, reviewing job
history, or fixing bugs in the generate/jobs/prompts routes.

## What It Does

Generates a textual property description using Claude or GPT, from one or both of:
- A **transcript** (text extracted from an SRT/JSON file, or reused from a `TranscriptionJob`)
- A **reference image** (PNG/JPEG/WebP, sent as base64 in the request)

Rejection rule: reject only when **both** transcript text and reference image are absent.
If only image is provided, the prompt instructs the model to stay strictly within
what is visible — no invention.

## Key Files

| File | Role |
|------|------|
| `web/src/app/api/description/generate/route.ts` | Main generation endpoint — validates input, calls Claude or GPT, creates `DescriptionJob` |
| `web/src/app/api/description/jobs/route.ts` | GET job history (own jobs for users, all jobs for admin) |
| `web/src/app/api/description/prompts/route.ts` | GET active prompts (all authed users) / POST create (admin only) |
| `web/src/app/api/description/prompts/[id]/route.ts` | PATCH update / DELETE prompt (admin only) |
| `web/src/components/description/DescriptionTool.tsx` | Full tool UI — input form, history, prompt management |
| `web/src/components/admin/DescriptionPromptsPanel.tsx` | Admin panel for prompt CRUD |
| `web/prisma/schema.prisma` | `DescriptionPrompt`, `DescriptionJob` models |

## Data Model

**`DescriptionPrompt`** — managed by admins, shared across all users:
- `name`: display label
- `prompt`: instructions sent to the LLM before the user message
- `isActive`: soft-delete flag — inactive prompts are not shown in the UI

**`DescriptionJob`** — one record per generation:
- `status`: always `"COMPLETED"` or `"FAILED"` (synchronous — no async queue)
- `inputType`: `"upload"` (file uploaded) or `"transcription"` (existing `TranscriptionJob`)
- `inputFilename`: original filename for display; use `referenceImage.filename` when no transcript filename
- `transcriptionId`: optional FK to `TranscriptionJob` (set to null on cascade delete)
- `promptId`: FK to `DescriptionPrompt` (set to null on cascade delete)
- `promptSnapshot`: full prompt text at generation time — preserved even if prompt is later edited/deleted
- `personalization`: free-text injected into the user message after the prompt
- `model`: `"claude"` or `"gpt"`
- `result`: generated text (null on failure)
- `errorMsg`: error string on failure

## Generation Flow

```
POST /api/description/generate
  → auth check (session required)
  → permission check: TOOLS.DESCRIPTION via hasTool()
  → validate body:
      - transcriptText (optional, max 50 000 chars)
      - promptId (required)
      - personalization (optional)
      - model: "claude" | "gpt"
      - inputFilename (optional)
      - transcriptionId (optional)
      - referenceImage: { dataUrl, filename? } (optional)
  → reject if BOTH transcriptText and referenceImage are absent
  → validate referenceImage: base64 data URL, MIME in {png, jpeg, webp}, max 4 MB
  → fetch DescriptionPrompt from DB
  → buildUserMessage(promptText, transcriptText, personalization, hasImage)
  → call Claude (claude-3-7-sonnet-latest) or GPT (gpt-4o) with vision support
  → DescriptionJob created with status COMPLETED + result
  → return { jobId, result }
  On error: DescriptionJob created with status FAILED + errorMsg
```

Generation is **synchronous** — no RunPod, no async queue, no polling.

## Prompt Structure

`buildUserMessage()` assembles the user message:
1. Prompt text from `DescriptionPrompt.prompt`
2. Personalization block if provided
3. Image instruction block if image is present
4. Transcript block (truncated at 50 000 chars) OR fallback instruction if no transcript

The system message is empty — all instructions come from the prompt text.

## Admin Prompt Management

Prompts are managed in two places:
1. `DescriptionPromptsPanel.tsx` — the admin panel in the tools page
2. Inline in `DescriptionTool.tsx` — users with admin role can create/edit/delete prompts directly from the tool

Admin-only operations: create, update (`PATCH /api/description/prompts/[id]`), delete (`DELETE /api/description/prompts/[id]`).

All users can fetch active prompts: `GET /api/description/prompts`.

## Permission Gate

The generate endpoint checks `TOOLS.DESCRIPTION`:
```ts
const hasAccess = await hasTool(session.user.id, TOOLS.DESCRIPTION);
```

Admin users automatically have all tools. For non-admin users, `TOOLS.DESCRIPTION`
must be in their `permissions` JSON array. See the `admin-permissions` skill.

## Input Sources

The tool accepts transcripts from two sources:
- **Direct upload**: user uploads an `.srt` or `.json` file; `parseSRT()` or JSON
  parse extracts the text client-side before sending.
- **Existing transcription**: user picks a past `TranscriptionJob` from a dropdown;
  transcript text is fetched from that job's R2 output. The `transcriptionId` is
  stored on the `DescriptionJob` for traceability.

## Common Issues

| Symptom | Where to look |
|---------|--------------|
| Generation rejects despite having image | Check that both `transcriptText` and `referenceImage` are truly empty — rejection requires both absent |
| Job history shows empty `inputFilename` | For image-only runs, `inputFilename` must be set from `referenceImage.filename` at creation time |
| Model API key error | Check `ANTHROPIC_API_KEY` for Claude, `OPENAI_API_KEY` for GPT in env vars |
| Prompt not showing in tool | Check `isActive` — inactive prompts are filtered out at `GET /api/description/prompts` |
| Admin can't delete prompt | Prompt may still be referenced by jobs; cascade behavior is `SetNull` so deletion is safe — check route auth |

## Validation

```
cd web && npm run lint -- src/app/api/description/generate/route.ts src/components/description/DescriptionTool.tsx
```

No automated tests. Generation can be tested manually via the tool UI or by sending
a direct POST to `/api/description/generate` with a valid session cookie.
