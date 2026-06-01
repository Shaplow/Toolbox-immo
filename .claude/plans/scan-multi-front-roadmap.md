# Scan multi-front — Roadmap 6 chantiers restants

**Date** : 2026-06-01
**Contexte** : Après l'audit multi-front (6 agents) et les 13 fixes appliqués en deux sessions, il reste 6 chantiers de fond identifiés. Ce document prépare l'attaque pour éviter les pièges architecturaux.

**Ordre d'attaque recommandé** : `#5 → #3 → #10 → #4 → #11 → #12` (du critique-isolable au tech-debt).

**Règle dure** : chaque chantier est attaqué dans un worktree dédié (`/worktree-start <slug>`) pour ne pas se stomper. Les chantiers transactionnels (#5, #3, #10) ne se mergent **pas en parallèle** — risque conflit sur `lib/services/slot/*`.

---

## #5 — Promote cascade dans la transaction (Impact 4, Effort 3)

**Worktree** : `wt/fix-promote-cascade-tx`
**Source** : bug-hunter publications P1.1

### Diagnostic

`web/src/app/api/publications/[id]/versions/[versionId]/promote/route.ts:104-184`

Flow actuel :
1. `await prisma.$transaction(...)` — update `currentVersionId` + log + `applyAutoTransition`
2. Tx commit
3. **Fenêtre observable** ← (1-100ms)
4. `markJobsStaleForSlot(prisma, slotId, "version_promoted")` — hors tx
5. `tryAutoTriggerCover` + `triggerAutoTranscriptionForVersion` — fire-and-forget

**Race scenario** : un webhook RunPod CaptionJob COMPLETED arrive pendant la fenêtre 3 → `autoPromoteIfNoActive` set `slot.activeCaptionJobId = newJob.id`. Le stale-mark qui suit (4) reset ce `activeCaptionJobId = null` et marque le job freshly-completed comme stale. La transcription (5) part en parallèle. Outcome : UI affiche "En attente" alors qu'un caption valide existe pour la nouvelle version.

### Approche proposée

Déplacer `markJobsStaleForSlot` **dans** la `$transaction` du promote :

```ts
await prisma.$transaction(async (tx) => {
  await tx.publicationSlot.update({...});  // currentVersionId
  await logActivity(tx, {...});             // VERSION_PROMOTED
  await logActivity(tx, {...});             // CURRENT_VERSION_CHANGED
  await applyAutoTransition(tx, slotId, slot.status, "VERSION_PROMOTED", actorId);

  // NOUVEAU — stale-mark atomique avec le change de currentVersionId
  if (previousVersionId) {
    staleCounts = await markJobsStaleForSlotTx(tx, slotId, "version_promoted");
  }
});

// Hors tx : seuls les triggers fire-and-forget restent
const coverResult = await tryAutoTriggerCover({...});
void triggerAutoTranscriptionForVersion(versionId).catch(...);
```

### Risques (à anticiper)

1. **`markJobsStaleForSlot` ne supporte pas `TransactionClient`** : la signature actuelle prend `prisma`. Audit `lib/publications/jobLifecycle.ts:117-171` — vérifier si `updateMany` accepte le tx client (oui via type union `PrismaClient | TransactionClient` comme `logActivity`).
2. **Webhooks RunPod parallèles** : si un webhook arrive pendant la tx promote, ses writes peuvent attendre puis voir un état post-promote — ce qui est OK car ils utilisent `updateMany WHERE id = X AND status = Y` qui fail gracefully en count=0 si une autre tx a déjà touché.
3. **Tx plus longue** : si `markJobsStaleForSlot` fait 4 updateMany (caption/desc/cover/transcription), la tx tient 200-500ms vs 50ms avant. Sous charge concurrent promote, lock contention sur `PublicationSlot.id` augmente.

### Fichiers touchés

- `web/src/app/api/publications/[id]/versions/[versionId]/promote/route.ts` (1 fichier)
- Si `markJobsStaleForSlot` n'accepte pas déjà `TransactionClient` → `web/src/lib/publications/jobLifecycle.ts` (refactor signature)

### Validation

- `npm run test:unit` (existe `transitions.test.ts` à vérifier)
- E2E manuel : promote V2 avec captionJob COMPLETED en cours sur V1 → vérifier que le caption ancien est marqué stale **AVANT** que le webhook puisse créer un nouveau `activeCaptionJobId`
- Stress : 2 promotes consécutifs rapides → cohérence finale

### Briefing prêt à coller (toolbox-generalist)

> Déplace l'appel `markJobsStaleForSlot` dans la `$transaction` du promote route (`web/src/app/api/publications/[id]/versions/[versionId]/promote/route.ts:104-162`). Pré-requis : vérifier que `markJobsStaleForSlot` accepte `TransactionClient` ou refactorer pour. Garde `tryAutoTriggerCover` et `triggerAutoTranscriptionForVersion` hors tx. Source : bug-hunter publications P1.1 — race condition où un webhook caption arrivé pendant la fenêtre commit↔stale-mark créait un état incohérent (caption stale + nouvelle transcription en parallèle).

**Effort estimé** : 1h (si markJobsStaleForSlot accepte déjà tx) à 3h (refactor signature).

---

## #3 — Rotation burn-once race (Impact 5, Effort 3)

**Worktree** : `wt/fix-rotation-burn-race`
**Source** : bug-hunter content-library P1.1

### Diagnostic

`web/src/lib/contentLibraryResolver.ts:125-253` — fonction `selectMediaAsset`

Les stratégies `least_used`, `oldest_used`, `random` font `$queryRaw` avec `LIMIT 1` **sans** `FOR UPDATE`. Le `usageCount` n'est incrémenté qu'**après** par `recordLibraryUsage` (fire-and-forget post-render DONE).

**Race scenario** : 2 cron jobs ou 2 admin clicks simultanés → les 2 reads voient `usageCount` identique → les 2 passent `burnFilter` (ligne 112-114) → les 2 retournent le même asset. Avec `maxUsageCount=1` (burn-once), 2 renders consomment le même asset, puis `usageCount` finit à 2.

`selectDataEntry` (autre helper plus bas, ligne ~1354) utilise déjà `SELECT ... FOR UPDATE SKIP LOCKED` correctement — c'est le modèle à copier.

### Approche proposée

Wrap le SELECT + un increment optimiste (ou un insert de `MediaAssetUsage` row de claim) dans une **single $transaction** avec `FOR UPDATE SKIP LOCKED` :

```ts
await client.$transaction(async (tx) => {
  // 1. SELECT FOR UPDATE SKIP LOCKED — pose le verrou
  const rows = await tx.$queryRaw<AssetRow[]>(
    Prisma.sql`SELECT ma.id, ... FROM "MediaAsset" ma
      WHERE ... ORDER BY ... LIMIT 1
      FOR UPDATE SKIP LOCKED`
  );
  if (!rows[0]) return null;

  // 2. INSERT claim row pour bloquer les concurrents (per_account)
  //    OU increment immédiat usageCount (shared)
  if (accountId) {
    await tx.mediaAssetUsage.upsert({
      where: { assetId_accountId: { assetId: rows[0].id, accountId } },
      update: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
      create: { assetId: rows[0].id, accountId, usageCount: 1, lastUsedAt: new Date() },
    });
  } else {
    await tx.mediaAsset.update({
      where: { id: rows[0].id },
      data: { usageCount: { increment: 1 }, lastUsedAt: new Date() },
    });
  }
  return parseAssetRow(rows[0]);
});
```

**Alternative à arbitrer** : claim atomique avec `usageCount=0` insert (comme DataEntryUsage) — l'increment réel reste dans `recordLibraryUsage` post-render. Plus de complexité mais conserve la sémantique "compteur reflète usages confirmés".

### Risques (à anticiper)

1. **Double-comptage si render fail** : si on increment au pick + render fail, le compteur reste haut. Soit on accepte (asset moins prioritaire la fois suivante), soit on décrémente dans le path d'erreur (`revertLibraryCursors` pattern existe déjà). À choisir explicitement.
2. **`burnFilter` doit voir le nouveau count** : si on increment dans la même tx, le SELECT initial n'a pas encore le nouveau usageCount. Pour 2 renders concurrents, le 2e voit le SKIP LOCKED → passe à l'asset suivant. OK.
3. **`selectMediaAsset` est appelée hors tx aujourd'hui** : tout caller doit pouvoir passer un `TransactionClient`. Voir où elle est appelée (`api/renders`, generation pre-fill, `selectMediaAssetBySetSequence`).
4. **`recordLibraryUsage` post-render** : doit basculer en "best-effort marker d'usage confirmé" (lastUsedAt fresh) plutôt qu'incrémenter (déjà fait au pick).

### Fichiers touchés

- `web/src/lib/contentLibraryResolver.ts` — `selectMediaAsset` (line 125-253)
- `web/src/lib/recordLibraryUsage.ts` — adapter sémantique post-pick
- Callers de `selectMediaAsset` : grep `selectMediaAsset\b` pour identifier
- Migration Prisma : peut-être un index `(libraryId, usageCount, lastUsedAt)` pour SELECT FOR UPDATE perf

### Validation

- Test concurrent : script qui fire N=10 `selectMediaAsset` en parallèle sur library avec `maxUsageCount=1` → vérifier que chacun reçoit un asset distinct
- `npm run test:unit` (couvrir le nouveau pattern)
- Vérifier `contentLibraryResolver.test.ts` si existe

### Briefing prêt à coller (toolbox-generalist)

> Implémente row-lock atomique dans `selectMediaAsset` (`web/src/lib/contentLibraryResolver.ts:125-253`) pour éliminer la race burn-once. Suis le pattern existant `selectDataEntry` (ligne ~1354) avec `SELECT ... FOR UPDATE SKIP LOCKED` + claim immédiat (upsert MediaAssetUsage per_account ou increment MediaAsset.usageCount shared). Refactor : `selectMediaAsset` accepte un `TransactionClient` optionnel, fallback à `prisma.$transaction` interne. Mets à jour `recordLibraryUsage` pour ne plus double-incrémenter. Source : bug-hunter rotation P1.1 — 2 renders concurrents picked le même asset.

**Effort estimé** : 4-6h (signature refactor + tests concurrent).

---

## #10 — Atomicité CSV import + media-autocut SSE-in-tx (Impact 3, Effort 2)

**Worktree** : `wt/fix-import-atomicity`
**Source** : bug-hunter rotation P2.3 + P2.5

### Diagnostic — partie A : CSV import

`web/src/app/api/admin/libraries/data/campaigns/[campaignId]/import/route.ts:113-122 + 183-185`

```ts
const existingCount = await prisma.dataEntry.count(...);   // round-trip 1
if (existingCount > 0 && !force) return error;
// ... parsing ...
await prisma.dataEntry.createMany(...);                    // round-trip 2
```

2 round-trips → double-click double-import.

### Diagnostic — partie B : media-autocut SSE in tx

`web/src/app/api/webhooks/runpod/media-autocut/route.ts:147-155`

```ts
await prisma.$transaction(async (tx) => {
  await tx.mediaAutocutBatch.update(...);
  await tx.mediaAutocutJob.updateMany(...);
  notifyAll({...});  // ← AVANT le commit !
});
```

Si tx rollback → SSE déjà émis avec mauvais status. Si frontend re-fetch immédiatement → Postgres encore en state pré-commit.

### Approche proposée

**Partie A** :
- Wrapper count + createMany dans `$transaction` avec advisory lock sur `campaignId` (Postgres `pg_advisory_xact_lock(hashtext($1))`) OU
- Ajouter un index unique `(campaignId, setTag)` pour fail-loud sur doublon

**Partie B** :
- Sortir `notifyAll` du callback `$transaction` :
```ts
await prisma.$transaction(...);  // commit
// Post-tx
notifyAll({...});
```

### Risques

1. **Advisory lock** : libéré en fin de tx. Pas de leak. Mais si la tx est très longue (large CSV), bloque les autres imports sur la même campagne — OK fonctionnellement.
2. **Unique index** : si on l'ajoute, migration doit gérer les doublons existants. Faire un audit DB avant.
3. **Partie B** : trivial, 1 ligne.

### Fichiers touchés

- `web/src/app/api/admin/libraries/data/campaigns/[campaignId]/import/route.ts` (partie A)
- `web/src/app/api/webhooks/runpod/media-autocut/route.ts:147-155` (partie B)
- (Optionnel) `web/prisma/schema.prisma` + migration pour unique index

### Validation

- Test : 2 POST simultanés sur l'import → un 200, un 400 ou un 200 idempotent
- Partie B : webhook avec tx forced-rollback → vérifier que SSE n'est pas émis (test unitaire serait idéal)

### Briefing prêt à coller

> Atomicise 2 endroits : (A) `api/admin/libraries/data/campaigns/[id]/import/route.ts` count+createMany dans une seule `$transaction` avec `pg_advisory_xact_lock` sur campaignId. (B) `api/webhooks/runpod/media-autocut/route.ts:147-155` — déplace `notifyAll` après `await prisma.$transaction(...)`. Source : bug-hunter rotation P2.3 + P2.5.

**Effort estimé** : 2-3h.

---

## #4 — Webhook secret HMAC body-signing (Impact 5, Effort 4)

**Worktree** : `wt/fix-webhook-secret-hmac`
**Source** : security-auditor Critical-1

### Diagnostic

`web/src/lib/webhooks/runpod.ts:153-162`

```ts
url.searchParams.set("secret", WEBHOOK_SECRET);
```

Le secret est passé en **query parameter** dans la callback URL. RunPod stocke cette URL dans son job payload + l'apparait dans **leurs logs server-side + access logs CDN + monitoring**. Toute personne avec accès à ces logs peut forger des callbacks (mark renders DONE, déclencher cascades, poison `Render.videoUrl`).

### Approche — 2 alternatives, **arbitrage requis**

**Option A — Garder le secret URL, rotation périodique + monitoring**
- Stocker plusieurs secrets valides simultanément (env `RUNPOD_WEBHOOK_SECRETS=v1:abc,v2:def`)
- Rotation mensuelle, ancien secret expire après 24h
- Alerte si RUNPOD_WEBHOOK_SECRET pattern fuit dans Sentry/logs
- **Effort** : 4h
- **Risque résiduel** : reste un secret partagé, juste rotaté

**Option B — Migration HMAC body-signed**
- Le worker render-engine signe le body POST avec `HMAC-SHA256(body, shared_secret)`
- En-tête `X-Toolbox-Signature: sha256=<hex>`
- Le secret n'apparaît jamais dans l'URL (et donc pas dans les logs)
- **Effort** : 8-12h (modifier worker Python `render-engine/runpod_worker.py` + signing helper + verify côté Next)
- **Risque** : coordination déploiement (worker doit déployer avant la route API qui valide le header — sinon webhooks legacy `?secret=` rejected)
- **Note importante** : RunPod n'a pas de mécanisme natif de signature. Le worker render-engine fait l'appel sortant POST → il peut signer librement avec une lib Python. Vérifier que la version actuelle du worker fait bien le `requests.post(callback_url, json=output)`.

### Risques (à anticiper)

1. **Option B nécessite update worker** : si le worker est en prod sur RunPod, il faut redéployer. Test staging d'abord.
2. **Compatibilité backwards** : pendant la transition, accepter **les deux** mécanismes pour ne pas casser les jobs en vol.
3. **Timing-safe compare** déjà implémenté côté `verifyRunpodWebhook` — réutilisable.
4. **Replay attack** : HMAC ne protège pas contre replay. Ajouter un nonce ou timestamp dans le body et reject si > 5min.

### Fichiers touchés (Option B)

- `web/src/lib/webhooks/runpod.ts` — `verifyRunpodWebhook` + `getRunpodWebhookUrl`
- `web/src/app/api/webhooks/runpod/*/route.ts` — 5 routes (renders, captions, transcription, media-autocut, media-edit)
- `render-engine/runpod_worker.py` ou équivalent — fonction `notify_webhook(callback_url, body)` doit signer

### Validation

- Test : webhook avec mauvaise signature → 401
- Test : webhook avec body modifié in-flight (proxy man-in-middle) → 401
- Test : webhook legacy `?secret=` → accepté pendant période de transition, refusé après

### Briefing prêt à coller (Option B recommandée)

> Migre webhook auth de query-param `?secret=` à HMAC body-signed `X-Toolbox-Signature` :
>
> 1. Côté worker (`render-engine/runpod_worker.py`) : avant `requests.post(callback_url, json=output)`, calculer `hmac.new(SECRET.encode(), body_json.encode(), 'sha256').hexdigest()` et le passer en header `X-Toolbox-Signature: sha256=<hex>` + ajouter un `X-Toolbox-Timestamp: <iso>`.
> 2. Côté Next (`web/src/lib/webhooks/runpod.ts:43-90`) : nouvelle fonction `verifyRunpodWebhookHmac(req)` qui re-calcule HMAC sur body raw + check timestamp < 5min. Accepter **les deux** (legacy + nouveau) pendant 7j puis retirer le legacy.
> 3. `getRunpodWebhookUrl` : ne plus ajouter `?secret=` quand le mode HMAC est activé (flag `RUNPOD_WEBHOOK_MODE=hmac|query`).
> 4. Test : webhook signed + replay attack reject.
>
> Source : security-auditor Critical-1 — secret en query param fuite dans logs serveur + RunPod history.

**Effort estimé** : 8-12h (worker side + Next side + déploiement coordonné). **À planifier hors sprint feature.**

---

## #11 — Sentry observability câblage (Impact 4, Effort 4)

**Worktree** : `wt/observability-sentry`
**Source** : Explore tech debt cluster #5

### Diagnostic

`web/src/lib/observability/captureError.ts:31-65` — actuellement `console.error` + TODO marker E1 step 4.

Aucune dépendance `@sentry/nextjs` dans `package.json`.

### Approche proposée

Suivre le commentaire `captureError.ts:8-14` :
1. `npm install @sentry/nextjs`
2. `npx @sentry/wizard@latest -i nextjs` (génère `sentry.client.config.ts`, `sentry.server.config.ts`, `sentry.edge.config.ts`, `next.config.ts` wrapping)
3. Env `SENTRY_DSN`, `SENTRY_AUTH_TOKEN` (CI)
4. Remplacer corps `captureError` et `captureMessage` par `Sentry.captureException` / `Sentry.captureMessage` avec tags + extra

### Risques

1. **Sourcemaps en prod** : Sentry les upload via auth token. Bien configurer pour ne pas leak la source côté client.
2. **Quota Sentry** : un cron qui spam d'erreurs explose le quota. Ajouter rate-limit côté `captureError` (1/min par tag par exemple).
3. **PII** : ne pas envoyer `user.email` ou `slot.description` brut dans `extra`. Auditer tous les call sites.
4. **GDPR** : Sentry stocke en EU par défaut, vérifier la région.

### Fichiers touchés

- `web/package.json` (+ deps)
- `web/sentry.{client,server,edge}.config.ts` (nouveau)
- `web/next.config.ts` (wrapping)
- `web/src/lib/observability/captureError.ts` (corps)
- `.env.example` (DSN placeholder)

### Validation

- Trigger une erreur volontaire en dev → vérifier qu'elle apparaît dans Sentry test project
- Build : `npm run build` doit produire sourcemaps + les uploader

### Briefing prêt à coller

> Câble Sentry pour remplacer le no-op `captureError.ts`. Étapes : `npm install @sentry/nextjs`, exécuter le wizard, configurer DSN via env, remplacer corps de `captureError` et `captureMessage` par `Sentry.captureException/Message` avec tags `{ tag: context.tag }` + extra `{ ...context.extra }`. Ajouter rate-limit (1/min par tag) pour éviter de spam le quota sous des crons en boucle. Auditer les call sites pour ne pas envoyer de PII (email, description). Région EU. Source : Explore tech debt cluster #5.

**Effort estimé** : 6-12h selon profondeur (wizard rapide, audit PII long).

---

## #12 — V8 cleanup `needsCaptions` Boolean (Impact 3, Effort 5)

**Worktree** : `wt/cleanup-v8-captions-bool`
**Source** : Explore tech debt cluster #1 + bug-hunter notes

### Diagnostic

`web/prisma/schema.prisma` :
- Ligne 789-790 : `needsCaptionsOverride Boolean? // @deprecated V8`
- Ligne 793 : `needsCaptionsModeOverride String?`
- Ligne 923-925 : `needsCaptions Boolean @default(false) // @deprecated V8`
- Ligne 929 : `needsCaptionsMode String @default("none")`

Le helper `resolveCaptionsMode` (`web/src/lib/publications/captionsMode.ts`) gère le fallback compat — donc la lecture est safe. Mais ~382 occurrences de `needsCaptions` dans le code (refs grep, dont du legacy support).

### Approche proposée — phasée

**Phase 1 — audit + freeze writes (1-2h)**
- Grep exhaustif des call sites de `needsCaptions` Boolean (lecture + écriture)
- Identifier les write paths qui set `needsCaptions` (PATCH pattern, migration)
- Bloquer tout nouveau write côté serveur → forcer `needsCaptionsMode`

**Phase 2 — backfill DB (1h)**
- Migration SQL :
  ```sql
  UPDATE "AccountPattern"
    SET "needsCaptionsMode" =
      CASE WHEN "needsCaptions" = true THEN 'auto' ELSE 'none' END
    WHERE "needsCaptionsMode" IS NULL;
  UPDATE "PublicationSlot"
    SET "needsCaptionsModeOverride" =
      CASE WHEN "needsCaptionsOverride" = true THEN 'auto'
           WHEN "needsCaptionsOverride" = false THEN 'none'
           ELSE NULL END
    WHERE "needsCaptionsModeOverride" IS NULL AND "needsCaptionsOverride" IS NOT NULL;
  ```
- Vérifier 0 rows avec mismatch avant suite

**Phase 3 — remplacer les lectures (10-12h)**
- 382 occurrences à parcourir, mais beaucoup sont déjà sur `needsCaptionsMode` via `resolveCaptionsMode`
- Cible : remplacer les `pattern.needsCaptions` directs par `resolveCaptionsMode({pattern}) === "auto"` ou `isCaptionsAuto(...)`
- Tests unitaires à update (mocks pattern)

**Phase 4 — drop colonnes (1h)**
- Migration `DROP COLUMN "needsCaptions"` + `"needsCaptionsOverride"`
- Tests DB

### Risques (à anticiper)

1. **Backfill non-idempotent** : run plusieurs fois → écrase manual writes. Solver via clause `WHERE needsCaptionsMode IS NULL`.
2. **Tests fixtures** : beaucoup de tests créent des patterns avec `needsCaptions: true`. À update massivement.
3. **API contracts** : si EXTERNAL clients API consomment `needsCaptions`, breaking change. Vérifier les routes publiques.
4. **Rollback** : si on drop les colonnes, plus de retour arrière. Garder une migration `addBack` en cas de panique.

### Fichiers touchés

- `web/prisma/schema.prisma` + 2 migrations
- ~30 fichiers code (lectures à remplacer)
- ~10 fichiers tests
- Documentation `.claude/skills/captions-transcription/SKILL.md` peut-être

### Validation

- `npm run test:unit` (tous passent)
- E2E captions auto + manual + none → 3 patterns coherence tests
- DB audit : 0 row avec `needsCaptions = true AND needsCaptionsMode = 'none'`

### Briefing prêt à coller

> Migre la base entière de `needsCaptions` Boolean vers `needsCaptionsMode` enum String (V8 cleanup). Approche phasée : (1) audit + freeze writes Boolean ; (2) backfill SQL idempotent vers mode enum ; (3) remplacer 382 occurrences (focus sur `pattern.needsCaptions` direct, utiliser `resolveCaptionsMode` helper existant) ; (4) drop colonnes Boolean après vérification. Risque : tests fixtures massifs à update + breaking change si API publique consomme. Source : Explore tech debt cluster #1.

**Effort estimé** : 12-16h sur 2-3 sprints (phaser obligatoirement).

---

## Synthèse — ordre d'attaque recommandé

| Ordre | Worktree | Effort | Pré-requis | Quand |
|---|---|---|---|---|
| 1 | `wt/fix-promote-cascade-tx` | 1-3h | Vérifier signature `markJobsStaleForSlot` | **Cette semaine** |
| 2 | `wt/fix-rotation-burn-race` | 4-6h | Lire `selectDataEntry` (modèle FOR UPDATE) | **Cette semaine** |
| 3 | `wt/fix-import-atomicity` | 2-3h | Aucun | **Cette semaine** (quick win SSE-in-tx) |
| 4 | `wt/fix-webhook-secret-hmac` | 8-12h | Arbitrage Option A vs B + coord worker | **Sprint dédié sécurité** |
| 5 | `wt/observability-sentry` | 6-12h | Compte Sentry org + DSN | **Sprint outillage** |
| 6 | `wt/cleanup-v8-captions-bool` | 12-16h | Backup DB + tests E2E robustes | **2-3 sprints phasés** |

**Ne pas attaquer en parallèle** :
- #5 + #3 + #10 touchent tous des transactions Prisma sur des paths critiques — sérialiser
- #4 demande coordination worker render-engine — pas urgent mais important
- #12 est un chantier de fond — peut être lancé en parallèle de #4 ou #11 (pas d'overlap fichier)

## Pour ne pas faire de bêtise

1. **Toujours `git diff main` avant commit** dans le worktree pour vérifier que tu n'as touché que ce que tu veux
2. **Pas de `--force` push, pas de `--no-verify`** (CLAUDE.md règle dure)
3. **Read avant Edit** (utilisateur peut éditer en parallèle dans son IDE)
4. **Tests avant merge** : `npm run test:unit && npm run lint` au minimum, E2E si surface UI
5. **Backup DB avant migration prod** : `cd web && npm run db:backup` puis `npx prisma migrate deploy`
6. **Pour #4 et #6** : test staging dédié, pas direct prod (worker render-engine est critique)
