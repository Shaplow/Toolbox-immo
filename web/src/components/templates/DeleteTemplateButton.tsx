"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Trash2 } from "lucide-react";

export function DeleteTemplateButton({ id }: { id: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [loading, setLoading] = useState(false);

  async function handleDelete() {
    setLoading(true);
    await fetch(`/api/templates/${id}`, { method: "DELETE" });
    router.refresh();
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        <button
          onClick={handleDelete}
          disabled={loading}
          className="flex-1 text-center text-xs bg-red-500 text-white py-1.5 rounded-lg hover:bg-red-600 disabled:opacity-50 transition-colors"
        >
          {loading ? "…" : "Confirmer"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="flex-1 text-center text-xs bg-gray-100 text-gray-600 py-1.5 rounded-lg hover:bg-gray-200 transition-colors"
        >
          Annuler
        </button>
      </div>
    );
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="w-full flex items-center justify-center gap-1.5 text-xs text-gray-400 hover:text-red-500 hover:bg-red-50 py-1.5 rounded-lg transition-colors"
    >
      <Trash2 size={11} />
      Supprimer
    </button>
  );
}
