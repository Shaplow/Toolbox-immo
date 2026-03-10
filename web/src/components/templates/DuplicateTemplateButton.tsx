"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function DuplicateTemplateButton({ id }: { id: string }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleDuplicate() {
    setLoading(true);
    await fetch(`/api/templates/${id}/duplicate`, { method: "POST" });
    router.refresh();
    setLoading(false);
  }

  return (
    <button
      onClick={handleDuplicate}
      disabled={loading}
      className="w-full text-center text-xs text-gray-400 hover:text-gray-600 hover:bg-gray-100 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
    >
      {loading ? "…" : "Dupliquer"}
    </button>
  );
}
