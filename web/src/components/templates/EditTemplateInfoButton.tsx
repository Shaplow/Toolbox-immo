"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function EditTemplateInfoButton({
  id,
  initialName,
  initialClient,
}: {
  id: string;
  initialName: string;
  initialClient: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(initialName);
  const [client, setClient] = useState(initialClient);
  const [saving, setSaving] = useState(false);

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    await fetch(`/api/templates/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, client }),
    });
    setSaving(false);
    setOpen(false);
    router.refresh();
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="text-xs text-gray-400 hover:text-sky-700 transition-colors"
        title="Renommer"
      >
        ✎
      </button>
    );
  }

  return (
    <form onSubmit={handleSave} className="flex flex-col gap-2 mt-2" onClick={(e) => e.stopPropagation()}>
      <input
        type="text"
        required
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Nom"
        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-400"
      />
      <input
        type="text"
        value={client}
        onChange={(e) => setClient(e.target.value)}
        placeholder="Client"
        className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-sky-400"
      />
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="flex-1 text-xs border border-gray-200 rounded-lg py-1 text-gray-500 hover:bg-gray-50"
        >
          Annuler
        </button>
        <button
          type="submit"
          disabled={saving}
          className="flex-1 text-xs bg-sky-600 text-white rounded-lg py-1 hover:bg-sky-700 disabled:opacity-60"
        >
          {saving ? "..." : "OK"}
        </button>
      </div>
    </form>
  );
}
