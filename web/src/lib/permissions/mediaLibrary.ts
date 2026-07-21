/**
 * Accès à la Médiathèque (librairies média vidéo/photo + audio).
 *
 * La médiathèque n'est PAS branchée sur le système de « tools » (ROLE_TOOL_SCOPE,
 * qui ne gère que l'Atelier). Son gating est ici, sur le rôle effectif.
 *
 * Deux niveaux :
 *  - ASSET-level (upload, analyse auto/autocut, édition, tags, suppression d'assets
 *    + lectures des panels) → ADMIN et VIDEASTE.
 *  - LIBRARY-level (créer / supprimer / réglages / rotation d'une librairie) → ADMIN only.
 *
 * À appeler avec `effectiveUser.role` (pas `actualUser`, pas `canAdminBypass`) :
 * `resolveUserContext` n'honore l'impersonation / le « view-as-role » que si le
 * user de session réel est ADMIN, et VALID_VIEW_AS_ROLES ne contient pas ADMIN —
 * un override ne peut donc que descendre. Baser l'autorisation sur effectiveUser.role
 * est sûr et permet à un admin en « Vue VIDEASTE » de vivre l'expérience VIDEASTE.
 *
 * Ce module ne doit dépendre d'aucun code server-only : il est consommé côté
 * serveur (pages, routes API) ET côté client (AppNav).
 */

/** Rôles autorisés à voir la médiathèque et à gérer ses ASSETS. */
const MEDIA_LIBRARY_ROLES: readonly string[] = ["ADMIN", "VIDEASTE"];

/**
 * Peut voir la médiathèque (média + audio) et gérer ses ASSETS : upload,
 * analyse auto, édition, tags, suppression d'assets.
 */
export function canAccessMediaLibrary(role: string | null | undefined): boolean {
  return role != null && MEDIA_LIBRARY_ROLES.includes(role);
}

/**
 * Peut gérer les LIBRAIRIES elles-mêmes : créer / supprimer / réglages / rotation.
 * ADMIN uniquement.
 */
export function canManageMediaLibraries(role: string | null | undefined): boolean {
  return role === "ADMIN";
}
