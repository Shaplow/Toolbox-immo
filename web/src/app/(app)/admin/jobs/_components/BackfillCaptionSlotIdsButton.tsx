"use client";

/**
 * BackfillCaptionSlotIdsButton — déclenche
 * `POST /api/admin/jobs/backfill-caption-slot-ids` pour rattacher les
 * CaptionJob orphelins (slotId=null, créés par le pipeline auto avant le
 * fix 2026-05-30) aux slots de publication via le lien
 *   srtFilename → TranscriptionJob → Render → PublicationSlot.
 *
 * Sans ce backfill, les fiches concernées affichent toujours la vidéo
 * brute alors que la version sous-titrée existe (orpheline en DB).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Link2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/useConfirm";

type BackfillSummary = {
  total: number;
  linked: number;
  skipped: { unparsable: number; noTranscription: number; noRenderSlot: number };
};

export function BackfillCaptionSlotIdsButton() {
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [submitting, setSubmitting] = useState(false);

  async function handleBackfill() {
    const ok = await confirm({
      title: "Rattacher les CaptionJob orphelins ?",
      description:
        "Cherche les CaptionJob auto (slotId=null) et tente de les rattacher au slot via le TranscriptionJob → Render. Action idempotente, ne touche que les jobs orphelins.",
      confirmLabel: "Lancer le backfill",
    });
    if (!ok) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/jobs/backfill-caption-slot-ids", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        summary?: BackfillSummary;
      };
      if (!res.ok) {
        toast.error(data.error ?? "Erreur lors du backfill");
        return;
      }
      const linked = data.summary?.linked ?? 0;
      const total = data.summary?.total ?? 0;
      toast.success(
        total === 0
          ? "Aucun CaptionJob orphelin détecté."
          : `${linked}/${total} CaptionJob rattaché${linked > 1 ? "s" : ""} au slot.`,
      );
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur réseau");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <Button
        variant="secondary"
        size="sm"
        icon={Link2}
        loading={submitting}
        onClick={() => void handleBackfill()}
      >
        Backfill captions
      </Button>
      {confirmDialog}
    </>
  );
}
