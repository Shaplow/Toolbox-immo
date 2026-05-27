-- Renomme le rôle `USER` en `EXTERNAL_GENERATOR` (Vague 0 — D4 étape 2).
--
-- Contexte : depuis Phase 1.2, USER est cadré comme "générateur externe"
-- (client qui génère des affiches sur certains templates). Le nom "USER"
-- prête à confusion avec un user système. On le renomme proprement.
--
-- Le champ `User.role` est un `String` libre (pas un enum Prisma), donc
-- pas d'altération de type — juste un UPDATE des lignes existantes et un
-- update du défaut.

-- 1. Met à jour les lignes existantes
UPDATE "User" SET "role" = 'EXTERNAL_GENERATOR' WHERE "role" = 'USER';

-- 2. Met à jour le défaut de la colonne (pour les futurs INSERT sans role)
ALTER TABLE "User" ALTER COLUMN "role" SET DEFAULT 'EXTERNAL_GENERATOR';
