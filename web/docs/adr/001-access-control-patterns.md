# ADR 001 — Access Control Patterns

**Status** : Accepted (2026-05-26)
**Phase** : 2.0 — documentation post-audit

---

## Context

Toolbox Immo a 3 niveaux d'accès qui coexistent dans l'application. Un audit de Phase 2.0 a confirmé que cette coexistence est volontaire et nécessaire : chaque niveau répond à un cas d'usage distinct.

---

## Decision

### Level 1 — ADMIN bypass

- **Source** : `getUserContext().canAdminBypass` (vrai si `actualUser.role === "ADMIN"`)
- **Usage** : toujours en premier check dans les routes admin-only. Simplifie le code : 1 check en haut, pas de cascade if-else.
- **Pattern** :
  ```ts
  const userContext = await getUserContext();
  if (!userContext?.canAdminBypass) {
    return NextResponse.json({ error: "Réservé aux administrateurs" }, { status: 403 });
  }
  ```
- **Fichier de référence** : `web/src/lib/userContext.ts`

### Level 2 — Role tool scope

- **Source** : `ROLE_TOOL_SCOPE` dans `web/src/lib/permissions/tools.ts`
- **Usage** : qui peut utiliser quel **outil global** (captions, transcription, description, cover, templates). Évite les permissions hardcodées par user — scalable avec les rôles.
- **Pattern** :
  ```ts
  import { hasTool } from "@/lib/permissions/tools";
  if (!hasTool(userId, "captions")) return 403;
  ```
- **Rôles** : `ADMIN`, `MONTEUR`, `CM`, `USER` (legacy). Définis dans `web/src/types/roles.ts`.

### Level 3 — Granular per-resource access

Tables d'accès dédiées pour la confidentialité client. Deux sous-niveaux :

#### User-level (ressources appartenant intuitivement à un user)

| Table | Cible | Raison |
|---|---|---|
| `TemplateAccess` | `Template` | Un MONTEUR ne doit voir que les templates de son client |
| `CaptionPresetAccess` | `CaptionPreset` | Un user ne voit que les presets qui lui ont été assignés |

Lien : un preset/template assigné par admin → entrée `*Access` créée en même temps.

#### Account-level (ressources partagées entre tous les users d'un compte IG)

| Table | Cible | Raison |
|---|---|---|
| `MediaAssetAccess` | `MediaAsset` | Tous les users travaillant sur un compte IG partagent les assets media |
| `DataEntryAccess` | `DataEntry` | Idem pour les data entries (biens immobiliers, etc.) |

Lien : l'accès est géré au niveau du compte (`InstagramAccount`), pas du user individuel.

---

## Rationale

- **ADMIN bypass** : évite la duplication de logique de permission dans chaque route admin. Un admin voit tout, toujours.
- **Role-based scope** : granularité sans explosion du nombre d'entrées en base. Scalable : ajouter un outil = modifier `ROLE_TOOL_SCOPE`, pas les données.
- **Granular access** : maintient la confidentialité client (isolation entre clients). Indispensable pour les rôles MONTEUR/CM qui peuvent travailler sur plusieurs clients.

---

## Consequences

- 3 niveaux = légère redondance apparente, mais chaque niveau a un cas d'usage propre et non-substituable.
- Les routes doivent toujours utiliser `getUserContext()` (pas `auth()` direct) pour bénéficier de l'impersonation admin.
- Pour chaque nouveau type de ressource réutilisable :
  - Si elle appartient à un user → créer une table `*Access` user-level + seed lors de l'assignation.
  - Si elle est partagée par compte → créer une table `*Access` account-level + seed lors de l'association compte.
- Documenter chaque ajout dans cet ADR (section "Level 3").

---

## References

- `web/src/lib/userContext.ts` — `getUserContext`, `canAdminBypass`, `effectiveUser`
- `web/src/lib/permissions/tools.ts` — `ROLE_TOOL_SCOPE`, `hasTool`
- `web/src/lib/permissions/slotScope.ts` — `whereClauseForUser`, `canUserAccessSlot`
- `web/src/lib/permissions/publications.ts` — `canSeePublication`, `canMarkPublished`
- Phase 2.0 audit context → décision "TemplateAccess : statu quo + ADR"
