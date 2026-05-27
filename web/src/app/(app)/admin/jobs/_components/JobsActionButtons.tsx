"use client";

/**
 * JobsActionButtons — boutons d'action par row de la table /admin/jobs.
 *
 * Pour l'instant : "Marquer FAILED" (libère le slot si bloquait).
 * Future iteration : "Relancer" (re-POST RunPod webhook simulator).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "@/components/ui/Toast";
import { useConfirm } from "@/components/ui/useConfirm";

interface Props {
  type: "render" | "caption" | "transcription" | "description" | "cover-pack" | "autocut";
  id: string;
}

export function JobsActionButtons({ type, id }: Props) {
  const router = useRouter();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [submitting, setSubmitting] = useState(false);

  async function markFailed() {
    const ok = await confirm({
      title: `Marquer le job ${type} ${id.slice(0, 8)}… comme FAILED ?`,
      description: "Le job sera considéré comme échoué et n'occupera plus la file. Cette action est irréversible.",
      confirmLabel: "Marquer FAILED",
      variant: "danger",
    });
    if (!ok) return;
    setSubmitting(true);
    const res = await fetch("/api/admin/jobs/mark-failed", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type, id }),
    });
    setSubmitting(false);
    if (res.ok) {
      toast.success("Job marqué FAILED");
      router.refresh();
    } else {
      const d = await res.json().catch(() => ({})) as { error?: string };
      toast.error(d.error ?? "Erreur lors du marquage");
    }
  }

  return (
    <>
      <button
        onClick={markFailed}
        disabled={submitting}
        className="text-xs px-2 py-1 rounded border border-red-200 text-red-600 hover:bg-red-50 disabled:opacity-50"
      >
        {submitting ? "…" : "Marquer FAILED"}
      </button>
      {confirmDialog}
    </>
  );
}
