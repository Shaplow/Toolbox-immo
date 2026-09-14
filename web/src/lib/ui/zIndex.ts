/**
 * Échelle d'empilement de l'app — source unique.
 *
 * Elle existait déjà, mais seulement sous forme d'un commentaire dans
 * `useAnchoredPosition` et de deux constantes non colocalisées. Résultat :
 * des `z-20` de dropdown maison sous des `z-20` de header sticky, et des
 * popovers en `z-50` invisibles sous un panneau de Drawer (lui aussi à 50+).
 *
 * Module TS et non tokens CSS : les deux consommateurs (`useDialogStack`,
 * `useAnchoredPosition`) appliquent leur valeur via `style={{ zIndex }}`, pas
 * via une classe Tailwind. Une échelle CSS obligerait à réécrire les deux
 * hooks sans rien gagner.
 *
 * Les littéraux `z-10` locaux et sans conflit (un `<thead>` sticky dans sa
 * propre table) n'ont pas vocation à migrer ici : cette échelle nomme les
 * étages où des surfaces INDÉPENDANTES se rencontrent.
 */
export const Z = {
  /** En-têtes et cellules collantes, dans leur propre conteneur. */
  sticky: 10,
  /** Voiles plein écran et barres d'action flottantes — sous les dialogues. */
  overlay: 40,
  /** Base des dialogues empilés (useDialogStack : 50, 60, 70…). */
  dialog: 50,
  /**
   * Popovers portalés (useAnchoredPosition). Au-dessus de tout dialogue :
   * un popover quitte le DOM de son panneau, il doit repasser par-dessus.
   */
  popover: 1000,
  /** Toasts — toujours au sommet. */
  toast: 9999,
} as const;

export type ZLayer = keyof typeof Z;
