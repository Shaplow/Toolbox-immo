---
name: admin-permissions
description: Work safely with Toolbox Immo's admin, role, permission, and impersonation system. Use when a task involves creating or editing admin-only routes, checking tool access, adding new TOOLS entries, modifying user management UI, or touching impersonation behavior.
---

# Admin & Permissions

Use this skill when the task touches access control, user management, tool gating, or impersonation — even if the primary goal is something else.

## Core Model

Roles are defined in `web/src/types/roles.ts`. Five roles exist:
- `ADMIN` — full access, all tools, can impersonate any non-admin user
- `MONTEUR` — gets captions + transcription tools by default via `ROLE_TOOL_SCOPE`
- `CM` — community manager role; tool scope defined in `ROLE_TOOL_SCOPE`
- `VIDEASTE` — filmmaker; no standalone tools (workflow via publication pipeline)
- `EXTERNAL_GENERATOR` — external client; limited to templates + covers

`USER` was the former catch-all role and has been superseded. Do not re-create it.

Tool grants work on two levels: role-based scope (`ROLE_TOOL_SCOPE` in `web/src/lib/permissions/tools.ts`) plus individual overrides stored as a JSON array in `User.permissions` (e.g. `["description"]`). `hasTool()` checks both layers.

## Key Files

| File | Role |
|---|---|
| `web/src/lib/permissions.ts` | `TOOLS` enum, `hasTool()`, `getUserTools()`, `setUserTools()`, `canAccessTemplate()` |
| `web/src/lib/permissions/tools.ts` | `ROLE_TOOL_SCOPE` — default tool grants per role |
| `web/src/lib/permissions/slotScope.ts` | `whereClauseForUser`, `canUserAccessSlot`, `ALLOWED_PATCH_FIELDS_BY_ROLE` |
| `web/src/lib/permissions/entityScope.ts` | Fiches (métaobjets, Phase 5) : `whereClauseForUserEntity`, `canUserAccessEntity`, `canUploadEntityRushes`, `ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE` — switch `EntityType.visibility` (`admin` = CRUD admin strict, `team` = scoping assignés). Remplace l'ex-`eventScope.ts`. |
| `web/src/lib/permissions/publications.ts` | `canSeePublication`, `canMarkPublished`, `canEditComment` |
| `web/src/lib/userContext.ts` | `getUserContext()`, `resolveUserContext()`, `IMPERSONATION_COOKIE_NAME`, `UserContext` type |
| `web/src/lib/auth.ts` | JWT callback — parses and re-serializes permissions; `session.user.role` and `session.user.permissions` |
| `web/src/app/api/admin/users/route.ts` | Admin user list and creation |
| `web/src/app/api/admin/users/[id]/route.ts` | Admin user PATCH/DELETE |
| `web/src/app/api/admin/users/[id]/accesses/route.ts` | Template access grants |
| `web/src/app/api/admin/users/[id]/caption-preset-accesses/route.ts` | Caption preset access grants per user |
| `web/src/app/api/admin/accounts/[id]/route.ts` | Instagram account management |
| `web/src/app/api/admin/accounts/[id]/cursors/reset/route.ts` | Reset library rotation cursor for an account |
| `web/src/app/api/admin/accounts/[id]/patterns/route.ts` | Pattern CRUD for an account |
| `web/src/app/api/admin/libraries/media/` | Media library CRUD, asset upload, access, edit, reset-usage |
| `web/src/app/api/admin/libraries/data/` | Data library, campaign, entry CRUD + CSV import |
| `web/src/app/api/admin/impersonation/route.ts` | Set/clear impersonation cookie |
| `web/src/components/admin/UsersPanel.tsx` | Admin user management UI |
| `web/src/components/admin/CaptionPromptsPanel.tsx` | Admin caption prompt management |
| `web/src/components/admin/AccountPatternsList.tsx` | Account patterns list UI |
| `web/src/components/admin/AccountPatternForm.tsx` | Account pattern form UI |
| `web/src/components/admin/AccountsListAdmin.tsx` | Instagram accounts list UI |
| `web/src/components/admin/libraries/` | Media + data library management panels |

## UserContext Pattern

Use `getUserContext()` in App Router route handlers (reads impersonation cookie automatically):

```ts
const userContext = await getUserContext();
if (!userContext) return 401;
if (!userContext.canAdminBypass) return 403; // admin-only check
```

Use `resolveUserContext(session, cookieValue)` in Pages Router or when you already have the session:

```ts
const session = await auth();
const userContext = await resolveUserContext(
  session,
  req.cookies.get(IMPERSONATION_COOKIE_NAME)?.value ?? null
);
```

### Key fields on `UserContext`

| Field | Meaning |
|---|---|
| `actualUser` | The real logged-in admin |
| `effectiveUser` | The impersonated user (or same as actualUser) |
| `isAdmin` | `actualUser.role === "ADMIN"` |
| `isImpersonating` | Admin is acting as another user |
| `canAdminBypass` | `true` only when admin and NOT impersonating — use this for admin-only gates |

## Adding a New Tool

1. Add the key to `TOOLS` in `web/src/lib/permissions.ts`
2. Add its label and description to `TOOL_LABELS` and `TOOL_DESCRIPTIONS`
3. Use `hasTool(userId, TOOLS.NEW_TOOL)` in the route handler
4. Add the permission check to the admin UI in `UsersPanel.tsx`

## Impersonation Rules

- Only `ADMIN` users can impersonate.
- Admins cannot impersonate other admins (blocked in `resolveUserContext`).
- While impersonating, `canAdminBypass` is `false` — the admin acts under the impersonated user's permissions.
- Impersonation is stored client-side as a cookie (`toolbox_impersonate_user_id`), validated server-side.

## Common Mistakes

- Using `session.user.role === "ADMIN"` directly instead of `userContext.canAdminBypass` — this breaks during impersonation where the admin should act as the impersonated user.
- Forgetting to call `resolveUserContext` in older Pages API routes (`web/src/pages/api/`) that don't use `getUserContext`.
- Granting all tools to a user by accident by not checking the `role` before `JSON.parse(permissions)`.
- Adding a new tool in `TOOLS` without adding a migration or checking existing user permission strings.

## Validation

Run targeted lint: `cd web && npm run lint -- web/src/lib/permissions.ts web/src/lib/userContext.ts`

Unit tests exist for permissions helpers: `cd web && npm run test:unit` covers `slotScope`, `entityScope`, `publications`, and `tools` helpers.
Verify impersonation behavior manually via the admin UI or by checking the impersonation cookie flow.
