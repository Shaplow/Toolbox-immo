"use client";

/**
 * Tiroir « Nouveau lien de téléchargement » (fiche client, admin).
 *
 * Trois temps : l'aperçu des volumes se charge (le premier appel peut prendre
 * quelques secondes, le serveur retrouve les tailles), l'admin compose sa
 * sélection (`ExportSelectionForm`), puis le lien créé s'affiche une fois, avec
 * un bouton « Copier ».
 *
 * Le contenu n'est monté que tiroir ouvert (le `Drawer` ne rend rien fermé) :
 * sélection, aperçu et lien créé repartent de zéro à chaque ouverture, sans
 * code de remise à zéro.
 */

import { useEffect, useState, type ReactNode } from "react";
import { Check, Instagram, Loader2 } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";
import type {
  CreateExportLinkRequest,
  ExportLinkSummary,
  ExportPreview,
} from "@/lib/clientExport/types";
import { createExportLink, errorMessage, fetchExportPreview } from "./clientExportApi";
import { exportLinkUrl } from "./clientExportModel";
import { ExportLinkShare } from "./ExportLinkShare";
import { ExportSelectionForm } from "./ExportSelectionForm";

/** Titre de l'erreur d'aperçu — aussi le message de secours de l'API, d'où le test de doublon. */
const PREVIEW_ERROR_TITLE = "Impossible de calculer les volumes";

/**
 * - `editing` : sélection en cours (ou aperçu en chargement).
 * - `creating` : la requête de création est partie.
 * - `done` : le lien est affiché — il ne le sera plus jamais.
 */
type Phase = "editing" | "creating" | "done";

interface ClientExportDrawerProps {
  clientId: string;
  open: boolean;
  onClose: () => void;
  /** Appelé dès que le lien existe (la liste derrière le tiroir se rafraîchit). */
  onCreated?: (link: ExportLinkSummary) => void;
}

export function ClientExportDrawer({ clientId, open, onClose, onCreated }: ClientExportDrawerProps) {
  const [phase, setPhase] = useState<Phase>("editing");

  // Fermer pendant la création ferait perdre l'adresse (le lien existerait,
  // sans que personne ne l'ait vue) ; un clic de travers sur le voile une fois
  // le lien affiché aurait le même effet. Échap et la croix restent permis
  // une fois le lien créé : ce sont des gestes délibérés.
  function close() {
    if (phase === "creating") return;
    setPhase("editing");
    onClose();
  }

  return (
    <Drawer open={open} onClose={close} dismissOnBackdrop={phase === "editing"} size="lg">
      <DrawerContent
        clientId={clientId}
        phase={phase}
        onPhaseChange={setPhase}
        onClose={close}
        onCreated={onCreated}
      />
    </Drawer>
  );
}

type PreviewState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; preview: ExportPreview };

interface CreatedLink {
  url: string;
  expiresAt: string;
}

function DrawerContent({
  clientId,
  phase,
  onPhaseChange,
  onClose,
  onCreated,
}: {
  clientId: string;
  phase: Phase;
  onPhaseChange: (phase: Phase) => void;
  onClose: () => void;
  onCreated?: (link: ExportLinkSummary) => void;
}) {
  const [state, setState] = useState<PreviewState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [created, setCreated] = useState<CreatedLink | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const preview = await fetchExportPreview(clientId, controller.signal);
        setState({ status: "ready", preview });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({ status: "error", message: errorMessage(err, PREVIEW_ERROR_TITLE) });
      }
    })();
    return () => controller.abort();
  }, [clientId, attempt]);

  function retry() {
    setState({ status: "loading" });
    setAttempt((n) => n + 1);
  }

  async function handleCreate(request: CreateExportLinkRequest) {
    onPhaseChange("creating");
    try {
      const { link, rawToken } = await createExportLink(clientId, request);
      onCreated?.(link);
      if (!rawToken) {
        // Contrat : POST renvoie toujours le jeton. S'il manque, le lien existe
        // mais personne ne peut le lire : on le dit, la régénération le rattrape.
        onPhaseChange("editing");
        toast.error(
          "Le lien est créé mais son adresse n'a pas été renvoyée. Utilise « Nouveau lien » dans la liste.",
        );
        return;
      }
      setCreated({ url: exportLinkUrl(window.location.origin, rawToken), expiresAt: link.expiresAt });
      onPhaseChange("done");
    } catch (err) {
      onPhaseChange("editing");
      toast.error(errorMessage(err, "Impossible de créer le lien"));
    }
  }

  let body: ReactNode;
  if (created) {
    body = <CreatedView created={created} onDone={onClose} />;
  } else if (state.status === "loading") {
    body = <LoadingView />;
  } else if (state.status === "error") {
    body = <ErrorView message={state.message} onRetry={retry} />;
  } else if (state.preview.accounts.length === 0) {
    body = <NoAccountView />;
  } else {
    body = (
      <ExportSelectionForm
        preview={state.preview}
        creating={phase === "creating"}
        onCreate={(request) => void handleCreate(request)}
      />
    );
  }

  return (
    <>
      <Drawer.Header onClose={onClose}>Nouveau lien de téléchargement</Drawer.Header>
      {body}
    </>
  );
}

function LoadingView() {
  return (
    <Drawer.Body className="space-y-6">
      <p
        role="status"
        className="inline-flex items-center gap-2 text-[13px] text-muted-foreground"
      >
        <Loader2 size={14} className="animate-spin" aria-hidden />
        Calcul des volumes…
      </p>
      {/* `block` : un Skeleton est un <span>, sans largeur ni hauteur tant qu'il est en ligne. */}
      {[0, 1, 2].map((i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="block w-24" />
          <Skeleton shape="block" className="block h-24 w-full" />
        </div>
      ))}
    </Drawer.Body>
  );
}

function ErrorView({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Drawer.Body>
      <Alert
        variant="danger"
        title={PREVIEW_ERROR_TITLE}
        actions={
          <Button size="sm" variant="secondary" onClick={onRetry}>
            Réessayer
          </Button>
        }
      >
        {/* Le serveur répond souvent exactement le titre : pas de doublon. */}
        {message !== PREVIEW_ERROR_TITLE ? message : null}
      </Alert>
    </Drawer.Body>
  );
}

function NoAccountView() {
  return (
    <Drawer.Body>
      <EmptyState
        icon={Instagram}
        title="Aucun compte Instagram"
        description="Rattache au moins un compte Instagram à ce client pour lui créer un lien de téléchargement."
      />
    </Drawer.Body>
  );
}

function CreatedView({ created, onDone }: { created: CreatedLink; onDone: () => void }) {
  return (
    <>
      <Drawer.Body className="space-y-4">
        <div className="flex items-center gap-2.5">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-success-50 text-success-700">
            <Check size={15} aria-hidden />
          </span>
          <h3 className="text-[15px] font-semibold tracking-tight text-foreground">Lien créé</h3>
        </div>
        <ExportLinkShare url={created.url} expiresAt={created.expiresAt} />
      </Drawer.Body>
      <Drawer.Footer>
        <Button onClick={onDone}>Terminé</Button>
      </Drawer.Footer>
    </>
  );
}
