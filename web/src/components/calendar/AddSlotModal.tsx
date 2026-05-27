"use client";

import { useState, useCallback, useEffect } from "react";
import { Plus, X, AlertCircle } from "lucide-react";
import Link from "next/link";
import type { PublicationSlot } from "@/types/calendar";

interface Account {
  id: string;
  name: string;
  handle: string;
}

interface PatternOption {
  id: string;
  label: string;
  dayOfWeek: number[];
  publishTime: string;
  isActive: boolean;
  defaultAssigneeMonteur: { id: string; name: string } | null;
  defaultAssigneeCm: { id: string; name: string } | null;
  defaultAssigneeVideaste?: { id: string; name: string } | null;
}

/** Shape minimale d'un User telle que retournée par GET /api/admin/users */
interface UserOption {
  id: string;
  name: string;
  role: string;
}

interface AddSlotModalProps {
  accounts: Account[];
  defaultDate?: string; // YYYY-MM-DD
  onCreated: (slot: PublicationSlot) => void;
  onClose: () => void;
}

const DAYS = ["", "Lundi", "Mardi", "Mercredi", "Jeudi", "Vendredi", "Samedi", "Dimanche"];

const INPUT_CLS =
  "w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-800 focus:outline-none focus:ring-2 focus:ring-indigo-300";

export function AddSlotModal({ accounts, defaultDate, onCreated, onClose }: AddSlotModalProps) {
  const today = defaultDate ?? new Date().toISOString().slice(0, 10);

  // --- Form principal ---
  const [form, setForm] = useState({
    accountId: accounts[0]?.id ?? "",
    date: today,
    time: "19:00",
    title: "",
  });

  // --- Pattern picker ---
  const [patterns, setPatterns] = useState<PatternOption[]>([]);
  const [selectedPatternId, setSelectedPatternId] = useState<string>("");
  const [loadingPatterns, setLoadingPatterns] = useState(false);

  // --- Assignees ---
  const [assigneeMonteurId, setAssigneeMonteurId] = useState<string>("");
  const [assigneeCmId, setAssigneeCmId] = useState<string>("");
  const [assigneeVideasteId, setAssigneeVideasteId] = useState<string>("");

  // --- Données chargées au mount ---
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = useCallback((key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Fetch users au mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const usersRes = await fetch("/api/admin/users");
        if (cancelled) return;
        if (usersRes.ok) {
          const data = await usersRes.json() as UserOption[];
          setUsers(data);
        }
      } catch {
        // silencieux
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  // Fetch patterns quand le compte change
  useEffect(() => {
    if (!form.accountId) return;
    let cancelled = false;
    setLoadingPatterns(true);
    setSelectedPatternId("");
    setAssigneeMonteurId("");
    setAssigneeCmId("");
    setAssigneeVideasteId("");

    async function loadPatterns() {
      try {
        const res = await fetch(`/api/admin/accounts/${form.accountId}/patterns`);
        if (cancelled) return;
        if (res.ok) {
          const data = await res.json() as PatternOption[];
          const active = data.filter((p) => p.isActive);
          setPatterns(active);
          // Auto-select first active pattern
          if (active.length > 0) {
            const first = active[0];
            setSelectedPatternId(first.id);
            setAssigneeMonteurId(first.defaultAssigneeMonteur?.id ?? "");
            setAssigneeCmId(first.defaultAssigneeCm?.id ?? "");
            setAssigneeVideasteId(first.defaultAssigneeVideaste?.id ?? "");
          }
        }
      } catch {
        // silencieux
      } finally {
        if (!cancelled) setLoadingPatterns(false);
      }
    }
    void loadPatterns();
    return () => { cancelled = true; };
  }, [form.accountId]);

  // Quand un pattern est sélectionné, pré-remplir les assignations.
  function handlePatternSelect(patternId: string) {
    setSelectedPatternId(patternId);
    if (!patternId) {
      setAssigneeMonteurId("");
      setAssigneeCmId("");
      setAssigneeVideasteId("");
      return;
    }
    const pattern = patterns.find((p) => p.id === patternId);
    if (pattern) {
      setAssigneeMonteurId(pattern.defaultAssigneeMonteur?.id ?? "");
      setAssigneeCmId(pattern.defaultAssigneeCm?.id ?? "");
      setAssigneeVideasteId(pattern.defaultAssigneeVideaste?.id ?? "");
    }
  }

  // Users filtrés par rôle pour les selects d'assignees
  const monteurs = users.filter((u) => u.role === "MONTEUR" || u.role === "ADMIN");
  const cms = users.filter((u) => u.role === "CM" || u.role === "ADMIN");
  const videastes = users.filter((u) => u.role === "VIDEASTE" || u.role === "ADMIN");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedPatternId && !form.title.trim()) {
      setError("Sélectionne un pattern ou renseigne un titre pour ce slot.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const scheduledAt = new Date(`${form.date}T${form.time}:00`).toISOString();

      const payload: Record<string, unknown> = {
        accountId: form.accountId,
        scheduledAt,
        title: form.title || null,
        assigneeMonteurId: assigneeMonteurId || null,
        assigneeCmId: assigneeCmId || null,
        assigneeVideasteId: assigneeVideasteId || null,
        patternId: selectedPatternId || null,
      };

      const res = await fetch("/api/calendar/slots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
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

  const hasNoPatterns = !loadingPatterns && patterns.length === 0 && form.accountId;

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
          {/* Compte */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Compte</label>
            <select
              value={form.accountId}
              onChange={(e) => set("accountId", e.target.value)}
              required
              className={INPUT_CLS}
            >
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>@{a.handle} — {a.name}</option>
              ))}
            </select>
          </div>

          {/* Pattern picker */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Pattern de contenu</label>
            {loadingPatterns ? (
              <div className="flex items-center gap-2 text-xs text-gray-400 py-2">
                <div className="w-4 h-4 border-2 border-indigo-300 border-t-transparent rounded-full animate-spin" />
                Chargement des patterns…
              </div>
            ) : hasNoPatterns ? (
              <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                <AlertCircle size={14} className="mt-0.5 shrink-0" />
                <span>
                  Pas de pattern actif sur ce compte.{" "}
                  <Link
                    href={`/admin/accounts/${form.accountId}`}
                    target="_blank"
                    className="underline hover:text-amber-900"
                  >
                    Configurez-en un d&apos;abord.
                  </Link>
                </span>
              </div>
            ) : (
              <select
                value={selectedPatternId}
                onChange={(e) => handlePatternSelect(e.target.value)}
                className={INPUT_CLS}
              >
                <option value="">— Saisie manuelle —</option>
                {patterns.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.dayOfWeek.map((d) => DAYS[d] ?? `J${d}`).join("/")} {p.publishTime} — {p.label}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Date + Heure */}
          <div className="flex gap-3">
            <div className="flex-1">
              <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
              <input
                type="date"
                value={form.date}
                onChange={(e) => set("date", e.target.value)}
                required
                className={INPUT_CLS}
              />
            </div>
            <div className="w-28">
              <label className="block text-xs font-medium text-gray-700 mb-1">Heure</label>
              <input
                type="time"
                value={form.time}
                onChange={(e) => set("time", e.target.value)}
                required
                className={INPUT_CLS}
              />
            </div>
          </div>

          {/* Assignees */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Vidéaste</label>
              <select
                value={assigneeVideasteId}
                onChange={(e) => setAssigneeVideasteId(e.target.value)}
                className={INPUT_CLS}
                disabled={loadingMeta}
              >
                <option value="">— Aucun —</option>
                {videastes.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Monteur</label>
              <select
                value={assigneeMonteurId}
                onChange={(e) => setAssigneeMonteurId(e.target.value)}
                className={INPUT_CLS}
                disabled={loadingMeta}
              >
                <option value="">— Aucun —</option>
                {monteurs.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
            <div className="col-span-2">
              <label className="block text-xs font-medium text-gray-700 mb-1">CM</label>
              <select
                value={assigneeCmId}
                onChange={(e) => setAssigneeCmId(e.target.value)}
                className={INPUT_CLS}
                disabled={loadingMeta}
              >
                <option value="">— Aucun —</option>
                {cms.map((u) => (
                  <option key={u.id} value={u.id}>{u.name}</option>
                ))}
              </select>
            </div>
          </div>

          {/* B10 — Avertissement si pas de monteur assigné (slot invisible côté monteur) */}
          {!assigneeMonteurId && (
            <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
              <AlertCircle size={14} className="mt-0.5 shrink-0" />
              <span>
                Sans monteur assigné, ce slot n&apos;apparaîtra dans la worklist
                d&apos;aucun monteur. Tu pourras toujours l&apos;assigner plus tard.
              </span>
            </div>
          )}

          {/* Titre — optionnel si un pattern est sélectionné, sinon requis */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Titre
              {selectedPatternId
                ? <span className="ml-1 text-gray-400 text-[10px]">(optionnel)</span>
                : <span className="ml-1 text-amber-600 text-[10px]">(requis sans pattern)</span>}
            </label>
            <input
              type="text"
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              placeholder="Nom du bien, propriétaire…"
              className={INPUT_CLS}
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
              disabled={
                saving ||
                loadingMeta ||
                loadingPatterns ||
                // F1.15 — Désactive si ni pattern ni titre (au lieu de laisser
                // soumettre puis afficher l'erreur).
                (!selectedPatternId && !form.title.trim())
              }
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
