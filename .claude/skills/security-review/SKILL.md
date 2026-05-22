---
name: security-review
description: Review or harden authentication, authorization, uploads, secrets handling, proxying, public URLs, and external-service integrations in Toolbox Immo. Use when a task involves NextAuth, permissions, admin tools, file upload flows, RunPod, R2, internal API trust boundaries, or untrusted HTML and media inputs.
---

# Security Review

Use this skill when a task has any meaningful security boundary, not just when someone explicitly says "security".

## Main Goal

Find and fix concrete security weaknesses without inventing speculative threats that do not match the architecture.

## High-Risk Areas In This Repo

- authentication and session handling in `web/src/lib/auth.ts`
- permission checks in `web/src/lib/permissions.ts`
- admin-only routes and impersonation-related flows; `web/src/lib/userContext.ts` exposes `resolveUserContext()` and `IMPERSONATION_COOKIE_NAME` — this is the canonical check for admin bypass and impersonation state and must be called on all admin-sensitive reads and writes
- direct uploads and presigned URLs in transcription or media workflows
- RunPod requests and callbacks or status polling
- R2 object publication and public URL generation
- internal proxying between Next.js and render-engine
- HTML or template rendering paths that could accidentally trust unescaped user content

## Recommended Workflow

1. Identify the trust boundary first:
   - authenticated user versus guest
   - normal user versus admin
   - browser versus server
   - Next.js versus render-engine
   - private storage versus public URL
2. Trace who can trigger the action, what data they control, and what side effects happen.
3. Check both authentication and authorization. A valid session is not enough if the user should not have access to that tool or object.
4. For uploads and generated URLs, validate file type, ownership, lifetime, and whether object keys leak cross-user access.
5. For external services, check secret handling, request construction, and whether failures leak sensitive internal details.

## Security Checklist

- Is there an explicit auth check?
- Is there an explicit ownership or permission check?
- Can a user act on another user's job, file, or render by guessing an id or key?
- Are presigned or public URLs scoped tightly enough?
- Are secrets read only on the server and kept out of logs and client responses?
- Are untrusted inputs escaped or constrained before entering HTML, FFmpeg, or downstream AI services?

## Output Expectations

When using this skill, prioritize real exploit paths, privilege escalation, data exposure, SSRF-like integration risks, or trust-boundary mistakes. If no concrete finding is found, say so and mention residual risk areas.