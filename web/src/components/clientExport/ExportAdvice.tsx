"use client";

/**
 * Conseils avant de lancer. Chacun répond à un échec réel d'un téléchargement
 * de plusieurs dizaines de Go : dossier refusé par Chrome, dossier synchronisé
 * dans le cloud, disque trop juste, page fermée ou mise en veille.
 */

import { Alert } from "@/components/ui/Alert";
import { formatMaxSize } from "@/lib/upload/limits";

export function ExportAdvice({ totalBytes }: { totalBytes: number }) {
  // Les .xlsx n'ont pas de taille connue : un total nul laisserait « 0 o » dans les phrases.
  const size = totalBytes > 0 ? formatMaxSize(totalBytes) : null;

  return (
    <Alert variant="info" title="Avant de lancer">
      <ul className="list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-foreground">
        <li>
          Crée un nouveau dossier (par exemple dans Téléchargements) et sélectionne-le : Chrome refuse
          Téléchargements, Bureau et Documents eux-mêmes.
        </li>
        {size && <li>Évite un dossier synchronisé (OneDrive, iCloud) : {size} partiraient dans le cloud.</li>}
        {size && <li>Prévois {size} libres sur ton disque.</li>}
        <li>
          Laisse cette page ouverte et visible, ordinateur branché. Si le téléchargement s&apos;interrompt,
          relance-le : les fichiers déjà téléchargés ne sont pas refaits.
        </li>
      </ul>
    </Alert>
  );
}
