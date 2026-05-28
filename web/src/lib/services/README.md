# `web/src/lib/services/` — Couche métier

## Pattern

- **Fonctions nommées exportées**, groupées par domaine dans `services/<domaine>/`.
- Les services importent `prisma` directement depuis `@/lib/prisma`.
- Les routes API restent responsables du parsing body, de l'auth (`getUserContext()`), du mapping HTTP. La logique métier vit dans les services.
- **Pas de classes, pas de DI, pas de repository pattern, pas de Result type.** Exceptions natives + mapper unique.

## Exemple

```ts
// services/slot/slotService.ts
import { prisma } from "@/lib/prisma";
import { NotFoundError } from "../_runtime/errors";

export async function patchSlot(id: string, body: PatchSlotInput, ctx: UserContext) {
  const slot = await prisma.publicationSlot.findUnique({ where: { id } });
  if (!slot) throw new NotFoundError("Slot");
  // ... validation, transitions, activity log ...
  return prisma.publicationSlot.update({ where: { id }, data: ... });
}
```

```ts
// app/api/calendar/slots/[id]/route.ts
import { patchSlot } from "@/lib/services/slot/slotService";
import { mapServiceError } from "@/lib/services/_runtime/mapServiceError";

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  const ctx = await getUserContext();
  if (!ctx?.effectiveUser.id) return NextResponse.json({ error: "Non autorisé" }, { status: 401 });
  const body = await req.json();
  try {
    const slot = await patchSlot(params.id, body, ctx);
    return NextResponse.json(slot);
  } catch (err) {
    return mapServiceError(err);
  }
}
```

## Erreurs disponibles

- `NotFoundError(resource?)` → 404
- `ForbiddenError(message?)` → 403 (rare : préférer `NotFoundError` pour anti-énumération)
- `ValidationError(message)` → 400
- `ConflictError(message)` → 409
- `UnauthorizedError(message?)` → 401

## Services

| Domaine | Statut |
|---------|--------|
| `_runtime/` | ✅ S1 |
| `slot/` | 🚧 S1 |
| `render/` | ⏳ S2 |
| `captions/` | ⏳ S3 |
| `transcription/` | ⏳ S3 |
| `cover/` | ⏳ S3 |
| `description/` | ⏳ S4 |
| `contentLibrary/` | ⏳ S4 |
| `clientValidation/` | ⏳ S4 |

## Règle d'or pendant l'extraction

**Aucun changement de payload JSON des routes API**. L'UI reste robuste tant que les contracts ne bougent pas. Si une route renvoyait `{ slot: {...}, activity: [...] }`, l'extraction préserve cette forme exacte.
