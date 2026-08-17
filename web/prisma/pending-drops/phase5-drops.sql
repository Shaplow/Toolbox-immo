-- Plan simplification — drops différés de la Phase 5 (métaobjet Entity).
-- À convertir en migration Prisma au deploy N+1 APRÈS validation prod de la
-- Phase 5 (avec l'édition du schema.prisma : retrait des modèles Property,
-- ShootEvent, ShootEventActivity et des colonnes listées).

-- Contrôles préalables (read-only) :
--   SELECT COUNT(*) FROM "Entity";                          -- >= Property+ShootEvent
--   SELECT COUNT(*) FROM "PublicationSlot"
--     WHERE ("propertyId" IS NOT NULL AND "entityId" IS NULL)
--        OR ("eventId" IS NOT NULL AND "shootEntityId" IS NULL);  -- doit être 0

-- FK slots/rushes legacy
DROP INDEX IF EXISTS "PublicationSlot_propertyId_idx";
DROP INDEX IF EXISTS "PublicationSlot_eventId_idx";
ALTER TABLE "PublicationSlot" DROP COLUMN IF EXISTS "propertyId";
ALTER TABLE "PublicationSlot" DROP COLUMN IF EXISTS "eventId";
DROP INDEX IF EXISTS "PublicationRush_eventId_deletedAt_idx";
ALTER TABLE "PublicationRush" DROP COLUMN IF EXISTS "eventId";

-- Recettes
ALTER TABLE "PatternTemplate" DROP COLUMN IF EXISTS "requiresProperty";
ALTER TABLE "PatternTemplate" DROP COLUMN IF EXISTS "fieldSchema";  -- DEPRECATED, ni lu ni écrit
ALTER TABLE "PublicationSlot" DROP COLUMN IF EXISTS "fieldSchema";  -- toujours "[]"

-- Tables legacy
DROP TABLE IF EXISTS "ShootEventActivity";
DROP TABLE IF EXISTS "ShootEvent";
DROP TABLE IF EXISTS "Property";

-- AppSetting : la clé property.defaultFieldSchema n'est plus lue (le schéma
-- vit sur EntityType.fieldSchema du type Bien).
DELETE FROM "AppSetting" WHERE "key" = 'property.defaultFieldSchema';
