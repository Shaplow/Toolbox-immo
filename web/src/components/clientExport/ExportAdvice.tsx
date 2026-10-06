"use client";

/**
 * Conseils avant de lancer. Chacun répond à un échec réel d'un téléchargement
 * de plusieurs dizaines de Go : dossier refusé par Chrome, chemin trop long
 * sous Windows, dossier synchronisé dans le cloud, disque trop juste, page
 * fermée ou mise en veille, reprise dans un autre dossier (tout est refait).
 *
 * La première consigne a deux variantes :
 * - premier lancement : créer un dossier PORTANT LE NOM DE LA RACINE. Le moteur
 *   écrit directement dedans quand le dossier choisi s'appelle déjà
 *   `rootName` (resolveExportRoot) ; sinon il crée `<dossier>/<rootName>` et le
 *   visiteur se retrouve avec deux niveaux du même nom.
 * - reprise (un dossier est mémorisé) : la reprise ne reconnaît les fichiers
 *   déjà présents que dans le MÊME dossier. Suivre la consigne de création
 *   donnerait une arborescence vide, donc 150 Go retéléchargés.
 */

import { Alert } from "@/components/ui/Alert";
import { formatMaxSize } from "@/lib/upload/limits";

interface ExportAdviceProps {
  totalBytes: number;
  /** Nom du dossier racine attendu (manifest.rootName) : celui que le visiteur crée. */
  rootName: string;
  /** Un dossier est déjà mémorisé : le visiteur a commencé, le bon geste est de reprendre dedans. */
  resuming?: boolean;
}

export function ExportAdvice({ totalBytes, rootName, resuming = false }: ExportAdviceProps) {
  // Les .xlsx n'ont pas de taille connue : un total nul laisserait « 0 o » dans les phrases.
  const size = totalBytes > 0 ? formatMaxSize(totalBytes) : null;

  return (
    <Alert variant="info" title="Avant de lancer">
      <ul className="list-disc space-y-1.5 pl-4 text-[13px] leading-relaxed text-foreground">
        {resuming ? (
          <li>Tu as déjà commencé : reprends dans le même dossier — un nouveau dossier repart de zéro.</li>
        ) : (
          <>
            <li>
              Clique sur « Nouveau dossier », nomme-le « {rootName} » et sélectionne-le (Chrome refuse
              Téléchargements, Bureau et Documents eux-mêmes).
            </li>
            {/* Chrome n'est pas longPathAware : le chemin relatif (≤ 200) et le suffixe .crswap ne laissent qu'une cinquantaine de caractères au dossier de base sous MAX_PATH (260). */}
            <li>
              Sur Windows, crée-le près de la racine du disque (par exemple C:\Exports), pas dans OneDrive ni dans
              un dossier profond : les chemins trop longs font échouer des fichiers.
            </li>
          </>
        )}
        {size && <li>Évite un dossier synchronisé (OneDrive, iCloud) : {size} partiraient dans le cloud.</li>}
        {size && <li>Prévois {size} libres sur ton disque.</li>}
        <li>
          Laisse cette page ouverte et visible, ordinateur branché. Si le téléchargement s&apos;interrompt,
          relance-le dans le même dossier : les fichiers déjà téléchargés ne sont pas refaits.
        </li>
      </ul>
    </Alert>
  );
}
