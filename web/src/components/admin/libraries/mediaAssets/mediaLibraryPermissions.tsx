"use client";

import { createContext, useContext } from "react";

/**
 * Droits de l'utilisateur courant sur la médiathèque, calculés côté serveur
 * (depuis `effectiveUser.role`) et fournis par `MediaAssetsPanel` /
 * `MediaLibrariesPanel`.
 *
 * Contexte plutôt que prop-drilling : le booléen doit atteindre une quinzaine
 * de composants répartis sur trois niveaux (panel → vues → cards → drawers)
 * dont aucun intermédiaire n'a d'usage propre. Même motif que
 * `components/builder/BuilderFontStatusContext.tsx`.
 *
 * ⚠️ Ceci pilote l'AFFICHAGE, pas l'autorisation. La vraie barrière est le
 * guard des routes API (`canViewMediaLibrary` / `canManageMediaAssets` /
 * `canManageMediaLibraries`). Masquer un bouton ne protège rien à soi seul.
 */
export type MediaLibraryPermissions = {
  /** Upload, édition, tags, suppression, analyse auto, trim. */
  canManageAssets: boolean;
  /** Créer / supprimer / régler une bibliothèque, ordonner la rotation. */
  canManageLibraries: boolean;
};

/** Défaut least-privilege : un composant monté hors provider n'expose rien. */
const MediaLibraryPermissionsContext = createContext<MediaLibraryPermissions>({
  canManageAssets: false,
  canManageLibraries: false,
});

export const MediaLibraryPermissionsProvider = MediaLibraryPermissionsContext.Provider;

export function useMediaLibraryPermissions(): MediaLibraryPermissions {
  return useContext(MediaLibraryPermissionsContext);
}

/** Raccourci de lisibilité : `if (readOnly) return;` se lit mieux que la négation. */
export function useMediaLibraryReadOnly(): boolean {
  return !useMediaLibraryPermissions().canManageAssets;
}
