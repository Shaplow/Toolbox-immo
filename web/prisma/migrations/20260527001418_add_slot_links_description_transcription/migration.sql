-- No-op : migration historique reconstituée pour résoudre le drift Prisma.
-- Les changes ont déjà été appliqués manuellement en base (avant le scaffold local).
-- TODO : si tu retrouves le SQL d'origine de cette migration, le restaurer ici
-- pour que `prisma migrate deploy` en prod n'échoue pas.
SELECT 1;
