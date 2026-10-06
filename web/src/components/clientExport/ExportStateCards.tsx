"use client";

/**
 * Cartes d'état de la page de téléchargement qui précèdent le récapitulatif :
 * navigateur non pris en charge, chargement du manifeste, échec de chargement.
 */

import { Copy, Laptop, Loader2, RotateCcw } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { toast } from "@/components/ui/Toast";

/** Pas de manifeste ici : sur Safari ou mobile il serait calculé pour rien. */
export function ExportUnsupportedCard() {
  async function copyLink() {
    // Sans la requête ni l'ancre : seul le jeton du chemin compte.
    const url = `${window.location.origin}${window.location.pathname}`;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Lien copié. Colle-le dans Chrome ou Edge, sur un ordinateur.");
    } catch {
      toast.error("Impossible de copier le lien. Copie l'adresse depuis la barre de ton navigateur.");
    }
  }

  return (
    <Card className="space-y-4">
      <div className="flex items-start gap-3">
        <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted text-muted-foreground">
          <Laptop size={18} />
        </span>
        <div className="space-y-1">
          <h2 className="text-base font-semibold leading-snug text-foreground">
            Ouvre ce lien dans Google Chrome ou Microsoft Edge, sur un ordinateur.
          </h2>
          <p className="text-[13px] leading-relaxed text-muted-foreground">
            Ton navigateur ne permet pas d&apos;enregistrer un dossier complet.
          </p>
        </div>
      </div>
      <Button variant="outline" icon={Copy} onClick={() => void copyLink()}>
        Copier le lien
      </Button>
    </Card>
  );
}

export function ExportLoadingCard({ slow }: { slow: boolean }) {
  return (
    <Card className="space-y-4">
      <div role="status" className="flex items-center gap-2 text-[13px] text-foreground">
        <Loader2 size={14} className="animate-spin text-muted-foreground" />
        Préparation de la liste des fichiers…
      </div>
      <div className="space-y-2">
        <Skeleton shape="block" className="block h-5 w-2/3" />
        <Skeleton className="block w-full" />
        <Skeleton className="block w-5/6" />
      </div>
      <p className="text-[12px] text-muted-foreground">
        {slow
          ? "Le serveur met du temps à répondre : nouvel essai en cours…"
          : "Selon la quantité de fichiers, cela peut prendre quelques secondes."}
      </p>
    </Card>
  );
}

export function ExportErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Alert
      variant="danger"
      title="Impossible de charger la liste des fichiers."
      actions={
        <Button size="sm" variant="outline" icon={RotateCcw} onClick={onRetry}>
          Réessayer
        </Button>
      }
    >
      {message}
    </Alert>
  );
}
