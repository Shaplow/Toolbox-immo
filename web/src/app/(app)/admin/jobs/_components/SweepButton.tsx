"use client";

/**
 * SweepButton — déclenche `POST /api/admin/jobs/sweep` pour marquer FAILED
 * tous les jobs zombies (> seuil d'âge configuré côté serveur).
 *
 * F3.4 — La route existait mais n'avait pas de UI exposée. L'admin
 * devait jusqu'ici marquer FAILED job par job.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Wand2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/useConfirm";

export function SweepButton() {
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [submitting, setSubmitting] = useState(false);

  async function handleSweep() {
    const ok = await confirm({
      title: "Sweep automatique des jobs bloqués ?",
      description:
        "Marque FAILED tous les jobs zombies (au-delà des seuils d'âge configurés côté serveur). Action irréversible.",
      confirmLabel: "Lancer le sweep",
      variant: "danger",
    });
    if (!ok) return;
    setSubmitting(true);
    try {
      const res = await fetch("/api/admin/jobs/sweep", { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        swept?: { total?: number };
      };
      if (!res.ok) {
        toast.error(data.error ?? "Erreur lors du sweep");
        return;
      }
      const count = data.swept?.total ?? 0;
      toast.success(
        count === 0
          ? "Aucun job zombie détecté."
          : `${count} job${count > 1 ? "s" : ""} marqué${count > 1 ? "s" : ""} FAILED.`,
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
        icon={Wand2}
        loading={submitting}
        onClick={() => void handleSweep()}
      >
        Sweep auto
      </Button>
      {confirmDialog}
    </>
  );
}
