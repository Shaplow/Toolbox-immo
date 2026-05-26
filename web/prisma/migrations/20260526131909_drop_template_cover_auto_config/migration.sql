-- DataMigration: remove coverAutoConfig key from Template.jsonData (JSON field)
-- coverAutoConfig has been migrated to AccountPattern.coverConfig (Phase 1.8)
-- Using PostgreSQL JSON operator: jsonData - 'coverAutoConfig'
UPDATE "Template"
SET "jsonData" = ("jsonData"::jsonb - 'coverAutoConfig')::text
WHERE "jsonData"::jsonb ? 'coverAutoConfig';
