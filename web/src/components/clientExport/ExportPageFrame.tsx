/**
 * Cadre commun des pages publiques /export/[token] : la page elle-même, ses
 * états « expiré » / « désactivé » et son 404.
 *
 * `PageShell` plutôt qu'un wrapper maison : il n'a besoin d'aucun contexte du
 * layout (app), donc il tient hors de la session. Le fond vient du body racine
 * (`bg-muted`), les surfaces sont des `Card`. La colonne est ramenée à 2xl : le
 * variant `narrow` (4xl) est trop large pour une barre de progression et une
 * liste de fichiers.
 *
 * La colonne est un `<main>` : /export est hors du layout (app), seul porteur
 * du `<main>` de l'app, et PageShell ne rend que des `div`. Sans lui la page
 * n'aurait aucun repère « contenu principal » pour un lecteur d'écran.
 */

import type { ReactNode } from "react";
import { PageShell } from "@/components/ui/PageShell";

interface ExportPageFrameProps {
  children: ReactNode;
  /** Carte isolée (lien indisponible, 404) : centrée verticalement plutôt que collée en haut. */
  centered?: boolean;
}

export function ExportPageFrame({ children, centered = false }: ExportPageFrameProps) {
  return (
    <PageShell variant="narrow">
      <main className={["mx-auto max-w-2xl", centered ? "flex min-h-[70vh] flex-col justify-center" : ""].join(" ").trim()}>
        {children}
      </main>
    </PageShell>
  );
}
