/**
 * Stub de `server-only` pour Vitest.
 *
 * Next fournit ce package via son bundler, il n'existe pas dans node_modules :
 * sans ce stub, importer un module marqué `server-only` fait planter le test au
 * chargement. Le marqueur garde toute sa valeur en build — c'est lui qui empêche
 * un module touchant Prisma de repartir dans un bundle navigateur.
 */
export {};
