/**
 * Accès à la Médiathèque (librairies média vidéo/photo + audio).
 *
 * La médiathèque n'est PAS branchée sur le système de « tools » (ROLE_TOOL_SCOPE,
 * qui ne gère que l'Atelier). Son gating est ici, sur le rôle effectif.
 *
 * Trois niveaux, du plus large au plus restreint :
 *  - VIEW-level (consulter les panels, trier/filtrer, télécharger) → ADMIN, VIDEASTE
 *    et MONTEUR. Le MONTEUR s'arrête là : il pioche des rushs pour ses montages
 *    sans jamais pouvoir modifier la médiathèque.
 *  - ASSET-level (upload, analyse auto/autocut, édition, tags, suppression d'assets)
 *    → ADMIN et VIDEASTE.
 *  - LIBRARY-level (créer / supprimer / réglages / rotation d'une librairie) → ADMIN only.
 *
 * Les niveaux sont emboîtés : qui gère peut voir. Un handler de LECTURE (GET) se
 * gate sur `canViewMediaLibrary`, un handler MUTANT sur `canManageMediaAssets`
 * ou `canManageMediaLibraries` — y compris quand les deux cohabitent dans le
 * même fichier de route (cas de `media/assets/[assetId]/route.ts`).
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

/** Rôles autorisés à consulter la médiathèque et à télécharger ses fichiers. */
const MEDIA_LIBRARY_VIEW_ROLES: readonly string[] = ["ADMIN", "VIDEASTE", "MONTEUR"];

/** Rôles autorisés à gérer les ASSETS de la médiathèque. */
const MEDIA_LIBRARY_MANAGE_ROLES: readonly string[] = ["ADMIN", "VIDEASTE"];

/**
 * Peut consulter la médiathèque (média + audio) et télécharger ses fichiers.
 *
 * C'est le gate des pages médiathèque, de l'item de nav, et de tous les
 * handlers de LECTURE. Le MONTEUR l'obtient sans obtenir `canManageMediaAssets`
 * — d'où une UI intégralement en lecture seule pour lui.
 */
export function canViewMediaLibrary(role: string | null | undefined): boolean {
  return role != null && MEDIA_LIBRARY_VIEW_ROLES.includes(role);
}

/**
 * Peut gérer les ASSETS : upload, analyse auto, édition, tags, suppression.
 *
 * ⚠️ Ne PAS utiliser comme gate de simple consultation — un MONTEUR a le droit
 * de voir et de télécharger sans rien pouvoir modifier. Pour un handler de
 * lecture (GET) ou un gate de page, c'est `canViewMediaLibrary` qu'il faut.
 */
export function canManageMediaAssets(role: string | null | undefined): boolean {
  return role != null && MEDIA_LIBRARY_MANAGE_ROLES.includes(role);
}

/**
 * Peut gérer les LIBRAIRIES elles-mêmes : créer / supprimer / réglages / rotation.
 * ADMIN uniquement.
 */
export function canManageMediaLibraries(role: string | null | undefined): boolean {
  return role === "ADMIN";
}
