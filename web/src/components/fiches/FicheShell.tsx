/**
 * FicheShell — la charpente commune aux deux surfaces de fiche.
 *
 * `/publications/[id]` et `/fiches/[id]` montrent des choses différentes mais
 * ont la même forme : une barre collante en haut, un bandeau qui dit quoi faire
 * maintenant, une chaîne d'étapes, puis deux colonnes — le travail à gauche, le
 * contexte à droite. Ce module porte cette forme, et rien d'autre : il ne sait
 * ni ce qu'est un slot, ni ce qu'est une fiche.
 *
 * ## Pourquoi ce n'est pas un PageShell
 *
 * `CLAUDE.md` veut `PageShell` sur toutes les pages. Ces deux-là font exception,
 * et c'est structurel : `PageShell` centre TOUT dans un conteneur à largeur
 * bornée, alors que la barre d'en-tête est pleine largeur, avec sa bordure basse
 * qui traverse l'écran. Aucun variant de `PageShell` ne vaut `max-w-6xl` non
 * plus. `FicheShell` remplace donc `PageShell` sur ces deux routes — il ne s'y
 * imbrique pas, sous peine de deux conteneurs concentriques.
 */

import type { ReactNode } from "react";

export interface FicheShellProps {
  /**
   * Contenu de la barre collante. Le composant appelé ne porte PAS sa propre
   * coque : `FicheShell` fournit le `<header sticky>` et le conteneur centré,
   * pour que les deux surfaces collent exactement de la même façon.
   */
  header: ReactNode;
  /** Ce qu'il y a à faire tout de suite : disponibilité, prochaine action. */
  banner?: ReactNode;
  /** Chaîne d'étapes, et les blocs de contexte qui l'accompagnent. */
  chain?: ReactNode;
  /** Colonne de gauche : les sections de travail. */
  children: ReactNode;
  /**
   * Colonne de droite. Absente, la grille ne se forme pas du tout : garder une
   * colonne vide de 320px rétrécirait le contenu principal pour rien.
   */
  aside?: ReactNode;
  /**
   * Offset du sticky de l'aside, en classe Tailwind.
   *
   * Se cale sur la hauteur réelle de la barre, qui dépend de ce que la surface y
   * met — d'où une prop et pas une constante. Une valeur trop petite fait passer
   * l'aside sous la barre au scroll.
   */
  asideStickyTop?: string;
}

export function FicheShell({
  header,
  banner,
  chain,
  children,
  aside,
  asideStickyTop = "xl:top-[128px]",
}: FicheShellProps) {
  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-20 bg-card border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-3">{header}</div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
        {banner}
        {chain}

        {aside ? (
          <div className="mt-6 xl:grid xl:grid-cols-[minmax(0,1fr)_320px] xl:gap-6">
            <div className="space-y-4 min-w-0">{children}</div>

            {/* Pas de max-h + overflow-y-auto interne : laisse scroller la page
                naturellement. Sinon scrollbar visible + contenu tronqué. */}
            <aside className="mt-6 xl:mt-0">
              <div className={`xl:sticky ${asideStickyTop} space-y-4`}>{aside}</div>
            </aside>
          </div>
        ) : (
          <div className="mt-6 space-y-4 min-w-0">{children}</div>
        )}
      </div>
    </div>
  );
}
