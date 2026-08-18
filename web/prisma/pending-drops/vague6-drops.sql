-- Plan simplification — drops différés de la vague 6 (résidus recettes /
-- AccountPattern décommissionné / overrides morts / Entity métaobjet).
-- À convertir en migration Prisma au deploy N+1, avec l'édition de
-- schema.prisma (retrait des champs listés — cf. les annotations `MORT —
-- drop préparé dans pending-drops/vague6-drops.sql` correspondantes).
--
-- NB doublon volontaire : les ALTER/DROP des sections 2 à 8 ci-dessous
-- étaient déjà préparés (non convertis) dans phase3-4-drops.sql et
-- phase5-drops.sql lors des vagues précédentes (V2.3/V2.4, 17/08). Ils sont
-- repris ici pour donner à schema.prisma un point de référence unique par
-- champ — chaque ALTER utilise IF EXISTS, donc reprendre ces lignes est
-- sans risque même si phase3-4-drops.sql / phase5-drops.sql finissent
-- convertis en migration séparément (double DROP = no-op). Seule la
-- section 1 (backfill requiresEntityTypeId) et la section 2
-- (requiresProperty) sont réellement nouvelles à cette vague.

-- ── 1. Backfill préalable (Phase 5 métaobjet) ───────────────────────────
-- À JOUER EN PROD avant le drop de requiresProperty (section 2), et
-- seulement après avoir retiré l'écriture miroir de requiresProperty dans
-- lib/services/pattern/patternTemplateInput.ts (POST/PATCH recettes) —
-- aujourd'hui volontairement conservée pour ne rien casser côté lecteurs
-- legacy tant que ce backfill n'a pas tourné. PatternTemplateFields.tsx
-- dérive déjà requiresProperty depuis requiresEntityTypeId côté formulaire
-- (`requiresProperty = !!requiresEntityTypeId`), donc ce backfill ne
-- rattrape que les recettes créées AVANT la Phase 5 jamais re-sauvegardées
-- depuis.
UPDATE "PatternTemplate" SET "requiresEntityTypeId" = 'etype_bien'
  WHERE "requiresProperty" = true AND "requiresEntityTypeId" IS NULL;

-- ── 2. PatternTemplate.requiresProperty ─────────────────────────────────
-- Remplacé par requiresEntityTypeId (Phase 5 métaobjet). Ne PAS convertir
-- avant : (a) le backfill de la section 1 exécuté en prod (contrôle : voir
-- README), (b) le retrait de l'écriture miroir dans
-- lib/services/pattern/patternTemplateInput.ts (toPatternTemplateCreateData
-- / toPatternTemplateUpdateData écrivent encore `requiresProperty` en
-- parallèle de `requiresEntityTypeId`).
ALTER TABLE "PatternTemplate" DROP COLUMN IF EXISTS "requiresProperty";

-- ── 3. PatternTemplate.needsCaptions ────────────────────────────────────
-- @deprecated V8, remplacé par needsCaptionsMode (enum "none"|"auto"|
-- "manual"). Colonne Boolean plus jamais lue ni écrite depuis V2.3 (17/08) :
-- resolveEffective.ts / effectivePattern.ts dérivent needsCaptions de
-- needsCaptionsMode !== "none". Vérifié par grep à cette vague : zéro
-- `select: { needsCaptions: true }` en dehors des tests. Déjà présent dans
-- phase3-4-drops.sql (activé V2.3) ; repris ici pour le pointeur unique.
ALTER TABLE "PatternTemplate" DROP COLUMN IF EXISTS "needsCaptions";

-- ── 4. PatternTemplate.fieldSchema ──────────────────────────────────────
-- Les champs personnalisés vivent sur EntityType/Entity depuis la Phase 5
-- métaobjet ; colonne ni lue ni écrite (grep confirmé — zéro hit hors
-- `EntityType.fieldSchema`, champ homonyme mais distinct). Déjà présent
-- dans phase5-drops.sql ; repris ici pour le pointeur unique.
ALTER TABLE "PatternTemplate" DROP COLUMN IF EXISTS "fieldSchema";

-- ── 5. PatternBinding.templateIdOverride (+ relation BindingTemplateOverride) ──
-- MORT (V2.4, 17/08) : jamais réglable en UI (aucun champ formulaire ne
-- l'écrit), zéro lecture. Le DROP COLUMN retire aussi la relation
-- BindingTemplateOverride (pas de FK indexée séparément — pas de
-- @@index sur ce champ). Déjà présent dans phase3-4-drops.sql.
ALTER TABLE "PatternBinding" DROP COLUMN IF EXISTS "templateIdOverride";

-- ── 6. PublicationSlot.patternId (+ relation) + modèle AccountPattern ───
-- Décommissionné (plan simplification D2) : resolveSlotEffectivePattern
-- résout désormais uniquement depuis patternBindingId/patternTemplateId.
-- Re-vérifié par grep à cette vague :
--   - zéro `prisma.accountPattern.*` en dehors d'un mock Prisma inutilisé
--     (`accountPattern: { findUnique: vi.fn() }`) dans
--     lib/services/slot/__tests__/createSlotEvent.test.ts — hors périmètre
--     (mock de test, jamais exercé) ;
--   - zéro `include`/`select` Prisma sur la relation `pattern` (AccountPattern)
--     — le champ `pattern` que portent transitions.ts/slotService.ts/
--     effectivePattern.ts est une forme CALCULÉE par
--     resolveSlotEffectivePattern (même nom historique, source différente),
--     pas la relation Prisma vers AccountPattern.
-- Déjà présent dans phase3-4-drops.sql.
DROP INDEX IF EXISTS "PublicationSlot_patternId_idx";
ALTER TABLE "PublicationSlot" DROP COLUMN IF EXISTS "patternId";
DROP TABLE IF EXISTS "AccountPattern";

-- ── 7. PublicationSlot.coverPresetIdOverride (+ relation SlotCoverPresetOverride) ──
-- MORT (V2.4, 17/08) : jamais écrit ; sa résolution applicative morte vient
-- d'être retirée de lib/services/slot/config.ts. Déjà présent dans
-- phase3-4-drops.sql.
ALTER TABLE "PublicationSlot" DROP COLUMN IF EXISTS "coverPresetIdOverride";

-- ── 8. PublicationSlot.fieldSchema ──────────────────────────────────────
-- Figé à "[]" : plus aucune écriture réelle possible depuis le retrait de
-- "fieldSchema" de la whitelist PATCH slot (lib/permissions/slotScope.ts,
-- cette vague). Reste lu/ré-sérialisé tel quel par slotService.ts (toujours
-- "[]") — lecture non bloquante pour le drop. Déjà présent dans
-- phase5-drops.sql.
ALTER TABLE "PublicationSlot" DROP COLUMN IF EXISTS "fieldSchema";

-- ── 9. MediaAsset.category ──────────────────────────────────────────────
-- Concept de catégorie de rotation retiré Phase 3 (simplification dossiers
-- simples) ; purgé côté applicatif à la vague précédente —
-- contentLibraryResolver.ts ne SELECTionne plus jamais `ma.category`
-- (commentaire explicite au call site). Pas d'@@index sur ce champ. Déjà
-- présent dans phase3-4-drops.sql.
ALTER TABLE "MediaAsset" DROP COLUMN IF EXISTS "category";
