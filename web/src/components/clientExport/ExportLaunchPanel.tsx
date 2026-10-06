"use client";

/**
 * Bas de l'écran de lancement : les conseils, puis les boutons qui démarrent le
 * téléchargement.
 *
 * Deux états, selon qu'un dossier a été mémorisé lors d'une visite précédente
 * (onglet fermé ou déchargé, autre jour) :
 * - rien de mémorisé : « Choisir un dossier et télécharger » est l'action
 *   principale ;
 * - dossier mémorisé : « Reprendre dans « X » » prend la place principale. Un
 *   visiteur qui suit le bouton le plus visible ne doit jamais retélécharger
 *   150 Go sans le savoir : un autre dossier repart d'une arborescence vide.
 *   « Choisir un autre dossier » passe en secondaire, avec cette mention.
 *
 * Sans état ni effet : les deux handlers viennent de ExportSession, qui garde
 * l'invariant du geste utilisateur (ils n'attendent rien avant leur premier
 * appel navigateur).
 */

import { FolderDown, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ExportAdvice } from "./ExportAdvice";

interface ExportLaunchPanelProps {
  /** Total des tailles connues du manifeste. */
  totalBytes: number;
  /** Nom du dossier racine du manifeste (celui à créer au premier lancement). */
  rootName: string;
  /** Nom du dossier mémorisé lors d'une visite précédente, null quand il n'y en a pas. */
  savedFolderName: string | null;
  /** Un lancement ou une reprise est en préparation (sélecteur ouvert, permission demandée). */
  busy: boolean;
  onChooseFolder: () => void;
  onResume: () => void;
}

export function ExportLaunchPanel({
  totalBytes,
  rootName,
  savedFolderName,
  busy,
  onChooseFolder,
  onResume,
}: ExportLaunchPanelProps) {
  const resuming = savedFolderName !== null;

  return (
    <>
      <ExportAdvice totalBytes={totalBytes} rootName={rootName} resuming={resuming} />
      <div className="space-y-2.5">
        <div className="flex flex-col gap-2 sm:flex-row">
          {resuming ? (
            <>
              <Button size="lg" icon={RotateCcw} loading={busy} onClick={onResume}>
                Reprendre dans « {savedFolderName} »
              </Button>
              <Button size="lg" variant="outline" icon={FolderDown} disabled={busy} onClick={onChooseFolder}>
                Choisir un autre dossier
              </Button>
            </>
          ) : (
            <Button size="lg" icon={FolderDown} loading={busy} onClick={onChooseFolder}>
              Choisir un dossier et télécharger
            </Button>
          )}
        </div>
        <p className="text-[12px] leading-relaxed text-muted-foreground">
          Chrome te demandera ensuite d&apos;autoriser l&apos;accès à ce dossier : accepte pour que les fichiers
          puissent y être enregistrés.
          {resuming &&
            " « Reprendre » ne retélécharge pas les fichiers déjà enregistrés ; « Choisir un autre dossier » repart de zéro."}
        </p>
      </div>
    </>
  );
}
