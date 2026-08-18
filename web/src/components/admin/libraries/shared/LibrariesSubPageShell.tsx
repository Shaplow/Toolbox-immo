/**
 * LibrariesSubPageShell — header standard des 3 pages liste de la médiathèque
 * (vidéo/audio/données) : breadcrumb retour hub + eyebrow + titre + actions/
 * compteur, bâti sur PageShell.
 *
 * Remplace le header copié-collé ~50 lignes par page (wrapper `rounded-t-3xl`
 * + max-w imbriqué — pattern banni par la doctrine DA v3).
 */

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { PageShell } from "@/components/ui/PageShell";

interface LibrariesSubPageShellProps {
  eyebrow: string;
  title: string;
  subtitle?: ReactNode;
  /** Pill de comptage (ex: "3 libs · 12 vidéos") — style laissé au caller (couleur de dot par type). */
  counter?: ReactNode;
  /** Actions additionnelles à gauche du compteur (ex: BackfillDurationButton). */
  actions?: ReactNode;
  children: ReactNode;
}

export function LibrariesSubPageShell({
  eyebrow,
  title,
  subtitle,
  counter,
  actions,
  children,
}: LibrariesSubPageShellProps) {
  return (
    <PageShell variant="wide">
      <nav className="flex items-center gap-1.5 text-[10px] text-muted-foreground mb-3 flex-wrap">
        <Link
          href="/admin/libraries"
          className="inline-flex items-center gap-1 hover:text-foreground transition-colors"
        >
          <ChevronLeft size={10} className="flex-shrink-0" />
          Médiathèque
        </Link>
      </nav>

      <div className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
            {eyebrow}
          </p>
          <h1 className="mt-2 text-[36px] sm:text-[44px] font-semibold tracking-tight text-foreground leading-[1.05]">
            {title}
          </h1>
          {subtitle && <p className="mt-2 text-[13px] text-muted-foreground">{subtitle}</p>}
        </div>

        {(actions || counter) && (
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {actions}
            {counter}
          </div>
        )}
      </div>

      {children}
    </PageShell>
  );
}
