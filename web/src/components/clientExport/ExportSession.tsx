"use client";

/**
 * Tout ce qui suit le chargement du manifeste : récapitulatif, choix du
 * dossier, téléchargement, bilan, reprise.
 *
 * Le dossier d'écriture vient de deux endroits : un `showDirectoryPicker` lancé
 * par le visiteur, ou le dossier mémorisé lors d'une visite précédente
 * (« Reprendre »). Dans les deux cas le geste utilisateur est le seul droit
 * d'ouvrir le sélecteur ou de redemander l'accès : les deux handlers de clic
 * ci-dessous n'attendent donc rien avant leur premier appel navigateur.
 */

import { useState } from "react";
import { FolderDown, RotateCcw } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { ensureWritePermission, resolveExportRoot } from "@/lib/clientExport/downloadEngine";
import { saveRootHandle } from "@/lib/clientExport/handleStore";
import type { ExportManifest } from "@/lib/clientExport/types";
import { isAbortError } from "./exportApi";
import { useAbandonWritesOnPageHide, useBeforeUnloadGuard, useSavedRoot, useWakeLock } from "./exportHooks";
import { ExportLaunchPanel } from "./ExportLaunchPanel";
import { isFolderReachable } from "./folderAccess";
import { ExportProgressCard } from "./ExportProgressCard";
import { ExportRecap, ExportSkippedList } from "./ExportRecap";
import { ExportResultCard } from "./ExportResultCard";
import { useExportRun } from "./useExportRun";

/** Chrome rouvre le sélecteur là où ce même identifiant l'a laissé la dernière fois. */
const PICKER_ID = "toolbox-export";

const PICKER_CANCELLED_MESSAGE =
  "Aucun dossier choisi — si Chrome a refusé le dossier, crée un sous-dossier et sélectionne-le.";

interface ExportSessionProps {
  token: string;
  manifest: ExportManifest;
}

export function ExportSession({ token, manifest }: ExportSessionProps) {
  const run = useExportRun(token, manifest);
  const { savedRoot, forgetSavedRoot } = useSavedRoot(manifest.linkId);
  /** Dossier de la session en cours ou terminée : cible de « Reprendre ». */
  const [root, setRoot] = useState<FileSystemDirectoryHandle | null>(null);
  const [busy, setBusy] = useState(false);
  /** Message sous les boutons quand une reprise échoue (accès refusé, dossier disparu). */
  const [notice, setNotice] = useState<string | null>(null);

  const running = run.view.kind === "running";
  useWakeLock(running);
  useBeforeUnloadGuard(running);
  useAbandonWritesOnPageHide(running);

  async function chooseFolderAndStart() {
    try {
      // PREMIÈRE instruction du clic : l'activation utilisateur expire après un
      // await réseau, et Chrome refuse d'ouvrir le sélecteur sans elle.
      const picking = window.showDirectoryPicker?.({ id: PICKER_ID, mode: "readwrite", startIn: "downloads" });
      if (!picking) {
        toast.error("Ton navigateur ne permet pas d'enregistrer un dossier complet.");
        return;
      }
      setBusy(true);
      setNotice(null);

      let picked: FileSystemDirectoryHandle;
      try {
        picked = await picking;
      } catch (error) {
        // AbortError : annulation, ou dossier refusé par Chrome (Téléchargements, Bureau…).
        if (isAbortError(error)) toast.info(PICKER_CANCELLED_MESSAGE);
        else toast.error("Chrome n'a pas pu ouvrir le sélecteur de dossier. Recharge la page puis réessaie.");
        return;
      }

      const folder = await resolveExportRoot(picked, manifest.rootName);
      // Sans attendre : IndexedDB indisponible ou lent (navigation privée…) ne doit jamais retarder le
      // téléchargement. Au pire, pas de « Reprendre » à la prochaine visite.
      saveRootHandle(manifest.linkId, folder).catch(() => {});
      setRoot(folder);
      void run.start(folder);
    } catch (error) {
      console.warn("[export] dossier inutilisable :", error);
      toast.error("Impossible d'utiliser ce dossier. Choisis-en un autre.");
    } finally {
      setBusy(false);
    }
  }

  async function resume() {
    const target = root ?? savedRoot;
    if (!target) {
      setNotice("Choisis le dossier à nouveau pour continuer.");
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      // Première attente : requestPermission n'accepte qu'un geste récent, celui de ce clic.
      const granted = await ensureWritePermission(target);
      if (!granted) {
        setNotice(
          `L'accès au dossier « ${target.name} » n'a pas été accordé. Choisis le dossier à nouveau pour continuer.`,
        );
        return;
      }
      // Dossier supprimé ou déplacé depuis la dernière visite : le dire tout de
      // suite plutôt que d'enchaîner des centaines d'échecs de fichiers.
      if (!(await isFolderReachable(target))) {
        forgetSavedRoot();
        setNotice(`Le dossier « ${target.name} » est introuvable. Choisis le dossier à nouveau pour continuer.`);
        return;
      }
      setRoot(target);
      void run.start(target);
    } catch (error) {
      console.warn("[export] reprise impossible :", error);
      setNotice(`Impossible de reprendre dans « ${target.name} ». Choisis le dossier à nouveau pour continuer.`);
    } finally {
      setBusy(false);
    }
  }

  const { view } = run;

  if (view.kind === "running") {
    return (
      <ExportProgressCard
        progress={view.progress}
        rate={view.rate}
        stopping={view.stopping}
        connectionIssue={view.connectionIssue}
        folderName={root?.name ?? manifest.rootName}
        totalFiles={manifest.totals.files}
        totalBytes={manifest.totals.bytes}
        onStop={run.stop}
      />
    );
  }

  const noticeAlert = notice && <Alert variant="warning">{notice}</Alert>;

  if (view.kind === "finished") {
    return (
      <div className="space-y-4">
        {noticeAlert}
        <ExportResultCard
          result={view.result}
          totalFiles={manifest.totals.files}
          folderName={root?.name ?? manifest.rootName}
          busy={busy}
          onResume={() => void resume()}
          onChooseFolder={() => void chooseFolderAndStart()}
          offerChooseFolder={notice !== null}
        />
        <ExportSkippedList skipped={manifest.skipped} />
      </div>
    );
  }

  if (view.kind === "crashed") {
    return (
      <div className="space-y-4">
        {noticeAlert}
        <Alert
          variant="danger"
          title="Le téléchargement a rencontré un problème"
          actions={
            <>
              <Button size="sm" icon={RotateCcw} loading={busy} onClick={() => void resume()}>
                Reprendre
              </Button>
              <Button size="sm" variant="outline" icon={FolderDown} disabled={busy} onClick={() => void chooseFolderAndStart()}>
                Choisir le dossier à nouveau
              </Button>
            </>
          }
        >
          {view.message}
        </Alert>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {noticeAlert}
      <ExportRecap manifest={manifest} />
      <ExportSkippedList skipped={manifest.skipped} />
      {manifest.totals.files > 0 && (
        <ExportLaunchPanel
          totalBytes={manifest.totals.bytes}
          rootName={manifest.rootName}
          savedFolderName={savedRoot?.name ?? null}
          busy={busy}
          onChooseFolder={() => void chooseFolderAndStart()}
          onResume={() => void resume()}
        />
      )}
    </div>
  );
}
