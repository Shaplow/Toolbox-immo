"use client";

import { createContext, useContext } from "react";

/**
 * Familles Google qui n'ont pas réussi à charger dans la preview builder : leur
 * `<link>` css2 a émis un `error` (typiquement HTTP 400 — nom invalide ou poids
 * inexistant). Fourni par `BuilderClient` (qui gère l'injection des `<link>`),
 * consommé par `FontFamilyPicker` pour afficher un signal « ne charge pas ».
 *
 * Contexte plutôt que prop-drilling : le statut traverserait sinon 5 composants
 * (PropertiesPanel → BlockBasePropertiesSection → TextBlockPropertiesPanel →
 * StyleEditor → FontFamilyPicker) sans qu'aucun intermédiaire n'en ait besoin.
 */
export type BuilderFontStatus = {
  failedFamilies: Set<string>;
};

const BuilderFontStatusContext = createContext<BuilderFontStatus>({
  failedFamilies: new Set<string>(),
});

export const BuilderFontStatusProvider = BuilderFontStatusContext.Provider;

export function useBuilderFontStatus(): BuilderFontStatus {
  return useContext(BuilderFontStatusContext);
}
