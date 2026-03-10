"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DeleteListingButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    await fetch(`/api/listings/${id}`, { method: "DELETE" });
    router.refresh();
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1 shrink-0">
        <button
          onClick={handleDelete}
          disabled={loading}
          className="text-xs px-2 py-1 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50 transition-colors"
        >
          {loading ? "…" : "Confirmer"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="text-xs px-2 py-1 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 transition-colors"
        >
          Annuler
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      title="Supprimer ce listing"
      className="shrink-0 text-gray-300 hover:text-red-400 transition-colors text-base leading-none"
    >
      ✕
    </button>
  );
}
