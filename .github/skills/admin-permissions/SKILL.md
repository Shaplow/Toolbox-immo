---
name: admin-permissions
description: Work safely with Toolbox Immo's admin, role, permission, and impersonation system. Use when a task involves creating or editing admin-only routes, checking tool access, adding new TOOLS entries, modifying user management UI, or touching impersonation behavior.
---

# Admin & Permissions

Use this skill when the task touches access control, user management, tool gating, or impersonation — even if the primary goal is something else.

## Core Model

Permissions are stored as a JSON array string in `User.permissions`, e.g. `["captions","derush"]`.

Two roles exist:
- `ADMIN` — gets all tools automatically, can impersonate any non-admin user
- `USER` — gets only the tools explicitly assigned in `permissions`

## Key Files

| File | Role |
|---|---|
| `web/src/lib/permissions.ts` | `TOOLS` enum, `hasTool()`, `getUserTools()`, `setUserTools()`, `canAccessTemplate()` |
| `web/src/lib/userContext.ts` | `getUserContext()`, `resolveUserContext()`, `IMPERSONATION_COOKIE_NAME`, `UserContext` type |
| `web/src/lib/auth.ts` | JWT callback — parses and re-serializes permissions; `session.user.role` and `session.user.permissions` |
| `web/src/app/api/admin/users/route.ts` | Admin user list and creation |
| `web/src/app/api/admin/users/[id]/route.ts` | Admin user PATCH/DELETE |
| `web/src/app/api/admin/users/[id]/accesses/route.ts` | Template access grants |
| `web/src/app/api/admin/users/[id]/caption-preset-accesses/route.ts` | Caption preset access grants per user |
| `web/src/app/api/admin/users/[id]/derush-preset-accesses/route.ts` | Derush preset access grants per user |
| `web/src/app/api/admin/accounts/[id]/route.ts` | Instagram account management |
| `web/src/app/api/admin/accounts/[id]/cursors/reset/route.ts` | Reset library rotation cursor for an account |
| `web/src/app/api/admin/libraries/media/` | Media library CRUD, asset upload, access, edit, reset-usage |
| `web/src/app/api/admin/libraries/data/` | Data library, campaign, entry CRUD + CSV import |
| `web/src/app/api/admin/offer-schedule/route.ts` | Offer schedule management |
| `web/src/app/api/admin/impersonation/route.ts` | Set/clear impersonation cookie |
| `web/src/components/admin/UsersPanel.tsx` | Admin user management UI |
| `web/src/components/admin/PresetsPanel.tsx` | Caption preset admin UI |
| `web/src/components/admin/CaptionPromptsPanel.tsx` | Admin caption prompt management |
| `web/src/components/admin/InstagramAccountsPanel.tsx` | Instagram account management UI |
| `web/src/components/admin/OfferSchedulePanel.tsx` | Offer schedule UI |
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

No automated permission tests currently exist. Verify behavior manually via the admin UI or by checking the impersonation cookie flow.
