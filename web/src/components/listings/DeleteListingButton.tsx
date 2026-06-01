"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, Check, Loader2 } from "lucide-react";
import { toast } from "@/components/ui/Toast";

interface Props {
  listingId: string;
  /** Appelé après suppression réussie (en plus du router.refresh interne). */
  onDeleted?: () => void;
}

export function DeleteListingButton({ listingId, onDeleted }: Props) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  const stop = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  async function handleDelete(e: React.MouseEvent) {
    stop(e);
    setLoading(true);
    try {
      const res = await fetch(`/api/listings/${listingId}`, { method: "DELETE" });
      if (!res.ok) {
        let message = "Suppression impossible";
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) message = data.error;
        } catch {
          // Pas de JSON parseable (204 ou body vide) — garde le message générique.
        }
        toast.error(message);
        setLoading(false);
        setConfirming(false);
        return;
      }
      toast.success("Génération supprimée");
      onDeleted?.();
      router.refresh();
    } catch {
      toast.error("Erreur réseau lors de la suppression");
      setLoading(false);
      setConfirming(false);
    }
  }

  if (confirming) {
    return (
      <span className="inline-flex items-center gap-0.5">
        <button
          type="button"
          onClick={handleDelete}
          disabled={loading}
          title="Confirmer la suppression"
          aria-label="Confirmer la suppression"
          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-white bg-rose-500 hover:bg-rose-600 disabled:opacity-50 transition-all focus-ring"
        >
          {loading ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
        </button>
        <button
          type="button"
          onClick={(e) => {
            stop(e);
            setConfirming(false);
          }}
          disabled={loading}
          title="Annuler"
          aria-label="Annuler"
          className="inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-500 hover:text-gray-900 hover:bg-white/70 transition-all focus-ring"
        >
          <X size={13} />
        </button>
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        stop(e);
        setConfirming(true);
      }}
      title="Supprimer (admin)"
      aria-label="Supprimer cette génération"
      className="inline-flex items-center justify-center h-7 w-7 rounded-md text-gray-400 hover:text-rose-600 hover:bg-white/70 transition-all focus-ring"
    >
      <X size={13} />
    </button>
  );
}
