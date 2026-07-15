"use client";

import { useState } from "react";
import { ImageUp } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/components/ui/Toast";

interface BackfillResponse {
  processed: number;
  succeeded: number;
  failed: number;
  note?: string | null;
  error?: string;
}

/**
 * Génère les posters (vignettes) manquants d'une bibliothèque vidéo. Les assets
 * sans poster retombent sur un <video> lourd dans la grille/liste — ce backfill
 * les remplace par des JPEG légers. Idempotent (skip ceux qui ont déjà un poster).
 */
export function BackfillPostersButton({ libraryId }: { libraryId: string }) {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);

  async function runBackfill() {
    setRunning(true);
    try {
      const res = await fetch(`/api/admin/libraries/media/${libraryId}/backfill-posters`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const data = (await res.json()) as BackfillResponse;
      if (!res.ok) {
        toast.error(data.error ?? "Échec du backfill");
        return;
      }
      if (data.processed === 0) {
        toast.info("Aucune vidéo sans poster — tout est déjà couvert.");
        return;
      }
      const msg = `${data.succeeded}/${data.processed} posters générés (${data.failed} échec${data.failed > 1 ? "s" : ""})`;
      if (data.failed === 0) {
        toast.success(msg);
      } else {
        toast.info(`${msg}${data.note ? ` — ${data.note}` : ""}`);
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Erreur réseau");
    } finally {
      setRunning(false);
      setConfirmOpen(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => setConfirmOpen(true)}
        disabled={running}
        icon={ImageUp}
      >
        {running ? "Génération en cours…" : "Générer les posters manquants"}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title="Générer les posters manquants"
        description="Extrait une vignette JPEG légère pour chaque vidéo sans poster (uploads legacy). Ça accélère fortement l'affichage de la bibliothèque. Peut prendre plusieurs minutes selon le volume."
        confirmLabel="Lancer la génération"
        variant="default"
        loading={running}
        onConfirm={runBackfill}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
