---
slug: template-preview-renderer
name: Template — preview standalone (HTML→iframe + debug layout)
generatedAt: 2026-06-01T12:30:00Z
---

# Template preview renderer

## Pitch

Page autonome `/preview/[templateId]` qui rend un template en HTML dans une iframe avec données de preview synthétiques (générées depuis le schema). Surface distincte du builder studio (`/templates/[id]/edit`) — sert à valider rapidement le rendu HTML hors contexte d'édition, et expose un mode `debug=layout` qui annote les blocs/groupes pour debug les calculs auto-layout.

Audience : admin (tout template) + user avec TemplateAccess. Utilisé pour valider qu'un template rend bien avant de le partager / lancer un Listing dessus. Fond `bg-neutral-950` (dark mode pour mettre en valeur le rendu HTML clair).

## Schéma Mermaid

```mermaid
flowchart LR
  Studio["/templates/[id]/edit"] -->|"Aperçu"| Preview["/preview/[templateId]"]
  PreviewAuth[auth() session NextAuth] --> Guard{isAdmin OR template.userId OR TemplateAccess}
  Guard -->|deny| NotFound["notFound()"]
  Guard -->|allow| Load[Load template + jsonData]
  Load --> Normalize[normalizeTemplateJSON]
  Normalize --> PreviewData[buildSchemaPreviewData fake-fills schema]
  PreviewData --> BuildHTML[buildHTML + layoutDebug option]
  BuildHTML --> Iframe[TemplatePreviewFrame iframe]
  Preview --> BackToEditor["/templates/[id]/edit"]
  Preview --> BackToGallery["/templates"]
```

## Entry points UI

| Composant | Fichier:Ligne | Rôle |
|---|---|---|
| Page SSR | `app/preview/[templateId]/page.tsx:16-87` | Auth + load + buildHTML + render iframe |
| TemplatePreviewFrame | `components/templates/TemplatePreviewFrame.tsx` | iframe `srcDoc=html` + scaling auto (width/height canvas) |
| Header bar | `page.tsx:55-74` | Title + back links Galerie/Éditeur, badge "Aperçu" ou "Debug layout" |

## Helpers utilisés (lib)

- `lib/auth.ts` — `auth()` session NextAuth (exception : cette route utilise `auth()` directement, pas `getUserContext()`, car pas d'impersonation logic ici)
- `lib/renderer/buildHTML.ts` — `buildHTML(templateJson, listingData, { layoutDebug })` : produit le HTML final qui serait envoyé au pipeline render
- `lib/schemaFields.ts` — `buildSchemaPreviewData(schema)` : génère des valeurs factices conformes au schéma (string → "Texte d'exemple", url → asset placeholder, etc.)
- `lib/templateNormalization.ts` — `normalizeTemplateJSON()` : enrichit videoSequence, injecte slots orphelins, valide format

## Routes API (consommées indirectement)

Pas de route API dédiée — tout est en SSR. La page lit Prisma directement (single template find) et produit le HTML serveur. L'iframe `srcDoc` n'a pas besoin d'une route media.

## Permissions

`page.tsx:36-47`

```ts
const isAdmin = session.user.role === "ADMIN";
if (!isAdmin && template.userId !== session.user.id) {
  const access = await prisma.templateAccess.findUnique({
    where: { userId_templateId: { userId, templateId } },
  });
  if (!access) notFound();
}
```

- **ADMIN** : tout template
- **Owner** : `template.userId === session.user.id`
- **Externe** : `TemplateAccess.findUnique({ userId, templateId })` doit exister
- **Sinon** : `notFound()`

⚠️ **Exception à la règle CLAUDE.md** : cette page utilise `auth()` (pas `getUserContext()`). Pas de logique d'impersonation ici (preview = lecture, pas d'action métier).

## Modes spéciaux

| QueryParam | Effet |
|---|---|
| `?debug=layout` | `layoutDebug=true` passé à `buildHTML()` + bandeau "Debug layout" en header. Annote les blocs/groupes avec leurs bounding box pour debug calculs auto-layout |

## Modèles Prisma

- `Template` — id, name, client, userId, jsonData (TemplateJSON serialized)
- `TemplateAccess` — (userId, templateId) unique (pour vérification non-owner non-admin)

## Side effects

Aucun — c'est une lecture pure. Pas de log activity, pas de cursor advance.

## Variants par rôle

| Rôle | Ce qui change |
|---|---|
| ADMIN | Tous templates + back `/templates` |
| EXTERNAL_GENERATOR / autre | Filtré via owner ou TemplateAccess |

## Pré-conditions / invariants

- Template doit exister et avoir `jsonData` valide (JSON parseable)
- `normalizeTemplateJSON` doit pouvoir enrichir sans planter (sinon 500)
- iframe utilise `canvas.width × canvas.height` du template (assumes canvas valid)
- `auth()` (session-based, sans impersonation) suffit ici car pas d'action métier downstream

## Liens vers code

- Page : `web/src/app/preview/[templateId]/page.tsx`
- iframe : `web/src/components/templates/TemplatePreviewFrame.tsx`
- buildHTML : `web/src/lib/renderer/buildHTML.ts`
- preview data : `web/src/lib/schemaFields.ts`

## Skills/agents pertinents

- `.claude/skills/template-builder/SKILL.md` — buildHTML, layout snapshots, debug layout
- Workflow lié : `template-builder-studio` (édition), `generation-render-template` (utilisation effective du buildHTML downstream)
