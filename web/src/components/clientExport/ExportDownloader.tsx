"use client";

/**
 * Page publique de téléchargement des contenus d'un client (/export/[token]).
 *
 * Le visiteur n'a pas de compte et n'est souvent pas technicien : la page lui
 * dit d'abord si son navigateur peut faire le travail (Chrome ou Edge sur
 * ordinateur — l'écriture directe d'un dossier repose sur showDirectoryPicker),
 * puis ce qu'il va recevoir, puis suit le téléchargement jusqu'au bilan.
 *
 * Ce composant ne gère que l'amont : navigateur, chargement du manifeste. Tout
 * ce qui suit vit dans ExportSession.
 */

import type { ReactNode } from "react";
import { Card } from "@/components/ui/Card";
import { Skeleton } from "@/components/ui/Skeleton";
import { dateFrLong, timeFr } from "@/lib/date/formatFr";
import { useBrowserSupport, useExportManifest } from "./exportHooks";
import { ExportSession } from "./ExportSession";
import { ExportErrorCard, ExportLoadingCard, ExportUnsupportedCard } from "./ExportStateCards";
import { LinkUnavailableCard } from "./LinkUnavailableCard";

interface ExportDownloaderProps {
  token: string;
  clientName: string;
  /** ISO. Remplacée par l'expiration du manifeste une fois chargé (lien prolongé entre-temps). */
  expiresAt: string;
}

/** Pas encore de verdict sur le navigateur : un squelette neutre, sans texte qui pourrait mentir. */
function ExportCheckingCard() {
  return (
    <div aria-busy="true">
      <Card className="space-y-2">
        <Skeleton shape="block" className="block h-5 w-2/3" />
        <Skeleton className="block w-full" />
        <Skeleton className="block w-5/6" />
      </Card>
    </div>
  );
}

export function ExportDownloader({ token, clientName, expiresAt }: ExportDownloaderProps) {
  const support = useBrowserSupport();
  const { state, reload } = useExportManifest(token, support === "supported");
  const validUntil = state.kind === "ready" ? state.manifest.expiresAt : expiresAt;

  let body: ReactNode;
  if (support === "checking") {
    body = <ExportCheckingCard />;
  } else if (support === "unsupported") {
    body = <ExportUnsupportedCard />;
  } else if (state.kind === "loading") {
    body = <ExportLoadingCard slow={state.slow} />;
  } else if (state.kind === "gone") {
    body = (
      <LinkUnavailableCard
        as="h2"
        title="Ce lien n'est plus valide."
        description="Demande un nouveau lien à ton interlocuteur."
      />
    );
  } else if (state.kind === "error") {
    body = <ExportErrorCard message={state.message} onRetry={reload} />;
  } else {
    body = <ExportSession token={token} manifest={state.manifest} />;
  }

  return (
    <div className="space-y-6">
      <header className="space-y-1.5">
        <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
          Téléchargement de tes contenus
        </p>
        <h1 className="break-words text-[28px] font-semibold leading-[1.1] tracking-tight text-foreground">
          {clientName}
        </h1>
        {state.kind !== "gone" && (
          <p className="text-[13px] text-muted-foreground">
            Lien valable jusqu&apos;au {dateFrLong(validUntil)} à {timeFr(validUntil)}
          </p>
        )}
      </header>

      {body}

      {state.kind !== "gone" && (
        <p className="text-center text-[12px] text-muted-foreground">
          Ne partage pas ce lien : il donne accès à tes fichiers.
        </p>
      )}
    </div>
  );
}
