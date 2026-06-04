"use client";

import { useState } from "react";
import { ClockArrowUp } from "lucide-react";
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

export function BackfillDurationButton() {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [running, setRunning] = useState(false);

  async function runBackfill() {
    setRunning(true);
    try {
      const res = await fetch("/api/admin/libraries/media/backfill-duration", {
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
        toast.info("Aucun asset à prober — toutes les durées sont déjà connues.");
        return;
      }
      const msg = `${data.succeeded}/${data.processed} probés (${data.failed} échec${data.failed > 1 ? "s" : ""})`;
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
        onClick={() => setConfirmOpen(true)}
        disabled={running}
        icon={ClockArrowUp}
      >
        {running ? "Probe en cours…" : "Backfill durations"}
      </Button>
      <ConfirmDialog
        open={confirmOpen}
        title="Backfill des durées vidéo"
        description="Probe la duration de tous les assets vidéo/audio sans duration connue. Ça peut prendre jusqu'à plusieurs minutes selon le volume."
        confirmLabel="Lancer le backfill"
        variant="default"
        loading={running}
        onConfirm={runBackfill}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}
