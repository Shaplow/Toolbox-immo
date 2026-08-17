# Drops en attente (plan simplification — règle « drop en N+1 »)

Ces SQL ne sont PAS des migrations actives. Chaque phase du plan de
simplification livre son code + ses migrations additives ; le drop des
colonnes/tables rendues mortes n'est converti en vraie migration (dossier
`prisma/migrations/`) qu'au **deploy suivant**, après les contrôles prod.

## Avant de convertir `phase3-4-drops.sql` en migration

1. `npm run db:backup` (prod).
2. Contrôles prod (read-only) :
   - `SELECT COUNT(*) FROM "Render" WHERE status IN ('PENDING','PROCESSING');`
     → attendre 0 render antérieur au deploy Phase 3/4 (leurs `usedAssets`
     contiennent des snapshots de curseurs ; les reverts sont tolérants mais
     autant laisser la fenêtre se vider).
   - `SELECT COUNT(*) FROM "PublicationSlot" WHERE "patternId" IS NOT NULL AND "patternBindingId" IS NULL AND "patternTemplateId" IS NULL;`
     → doit être 0 (sinon rejouer `scripts/migrate-patterns-to-templates.ts`).
3. Script one-shot : mettre à jour les `TemplateJSON.contentLibrary` qui
   portent `dataCampaignId` sans `dataLibraryId` (résolution via DataCampaign
   AVANT son drop) — sinon la résolution legacy runtime ne pourra plus se faire.
3bis. Avant `phase5-drops.sql` : `npm run` → `tsx scripts/merge-property-schemas.ts`
   (union des fieldSchema par instance des Property → EntityType « Bien »).
   Testé en local (dry-run OK).
4. Retirer ensuite du code : les branches de revert legacy
   (`prevCursorStateByLibrary`, `prevDataLibraryCursorState`,
   `prevDataEntryState` dans `api/renders/route.ts` et
   `recordLibraryUsage.ts`), la résolution `dataCampaignId` du resolver, et
   régénérer le client Prisma après édition du schéma (retrait des modèles).
