"use client";

import { useState, useCallback } from "react";
import { Plus, X } from "lucide-react";
import { CONTENT_TYPES } from "@/types/calendar";
import type { PublicationSlot } from "@/types/calendar";

interface Account {
  id: string;
  name: string;
  handle: string;
  offre: string;
}

interface AddSlotModalProps {
  accounts: Account[];
  defaultDate?: string; // YYYY-MM-DD
  onCreated: (slot: PublicationSlot) => void;
  onClose: () => void;
}

export function AddSlotModal({ accounts, defaultDate, onCreated, onClose }: AddSlotModalProps) {
  const today = defaultDate ?? new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    accountId: accounts[0]?.id ?? "",
    date: today,
    time: "19:00",
    contentType: "RPI",
    title: "",
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = useCallback((key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      const scheduledAt = new Date(`${form.date}T${form.time}:00`).toISOString();
      const res = await fetch("/api/calendar/slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: form.accountId,
          scheduledAt,
          contentType: form.contentType,
          title: form.title || null,
        }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        throw new Error(err.error ?? "Erreur lors de la création");
      }
      const slot = await res.json() as PublicationSlot;
      onCreated(slot);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur inconnue");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-5">
          <h2 className="text-base font-semibold text-gray-900">Nouveau slot</h2>
          <button type="button" onClick={onClose} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={(e) => { void handleSubmit(e); }} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Compte</label>
            <select
              value={form.accountId}
              onChange={(e) => set("accountId", e.target.value)}
              required
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>@{a.handle} — {a.name}</option>
              ))}
            </select>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
            <div className="w-28">
              <label className="block text-xs font-medium text-gray-700 mb-1">Heure</label>
              <input
                type="time"
                value={form.time}
                onChange={(e) => set("time", e.target.value)}
                required
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Type de contenu</label>
            <select
              value={form.contentType}
              onChange={(e) => set("contentType", e.target.value)}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            >
              {CONTENT_TYPES.map((ct) => (
                <option key={ct} value={ct}>{ct}</option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Titre (optionnel)</label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Nom du bien, propriétaire…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300"
            />
          </div>

          {error && (
            <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{error}</p>
          )}

          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose} className="flex-1 px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 px-4 py-2 text-sm text-white bg-indigo-600 rounded-lg hover:bg-indigo-700 disabled:opacity-60 flex items-center justify-center gap-2"
            >
              <Plus size={14} />
              {saving ? "Création…" : "Créer le slot"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
