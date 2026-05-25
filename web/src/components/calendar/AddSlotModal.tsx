"use client";

import { useState, useCallback, useEffect } from "react";
import { Plus, X } from "lucide-react";
import { CONTENT_TYPES } from "@/types/calendar";
import type { PublicationSlot } from "@/types/calendar";

interface Account {
  id: string;
  name: string;
  handle: string;
  offre: string;
}

/** Shape minimale d'une ContentRecipe telle que retournée par GET /api/admin/recipes */
interface RecipeOption {
  id: string;
  code: string;
  label: string;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
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
    // Legacy : utilisé uniquement si aucune recipe n'est sélectionnée
    contentType: "RPI",
  });

  // --- Recipe + assignees (nouvelle mécanique 1.2.3) ---
  const [recipeId, setRecipeId] = useState<string>("");
  const [assigneeMonteurId, setAssigneeMonteurId] = useState<string>("");
  const [assigneeCmId, setAssigneeCmId] = useState<string>("");

  // --- Données chargées au mount ---
  const [recipes, setRecipes] = useState<RecipeOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [loadingMeta, setLoadingMeta] = useState(true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = useCallback((key: keyof typeof form, value: string) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  }, []);

  // Fetch recipes + users en parallèle au mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [recipesRes, usersRes] = await Promise.all([
          fetch("/api/admin/recipes"),
          fetch("/api/admin/users"),
        ]);
        if (cancelled) return;
        if (recipesRes.ok) {
          const data = await recipesRes.json() as RecipeOption[];
          setRecipes(data);
        }
        if (usersRes.ok) {
          const data = await usersRes.json() as UserOption[];
          setUsers(data);
        }
      } catch {
        // silencieux — on tombe en mode legacy contentType si les données ne chargent pas
      } finally {
        if (!cancelled) setLoadingMeta(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, []);

  // Préfill des assignees quand la recipe change
  function handleRecipeChange(id: string) {
    setRecipeId(id);
    if (!id) {
      // Pas de recipe → reset assignees (l'admin peut toujours les remplir manuellement)
      setAssigneeMonteurId("");
      setAssigneeCmId("");
      return;
    }
    const recipe = recipes.find((r) => r.id === id);
    if (!recipe) return;
    // Préfill : le défaut de la recipe est appliqué, l'admin peut surcharger via les selects
    setAssigneeMonteurId(recipe.defaultAssigneeMonteurId ?? "");
    setAssigneeCmId(recipe.defaultAssigneeCmId ?? "");
  }

  // Users filtrés par rôle pour les selects d'assignees
  const monteurs = users.filter((u) => u.role === "MONTEUR" || u.role === "ADMIN");
  const cms = users.filter((u) => u.role === "CM" || u.role === "ADMIN");

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
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
      };

      if (recipeId) {
        // Création via recipe : le serveur dérive le contentType depuis recipe.code
        payload.recipeId = recipeId;
      } else {
        // Legacy : contentType fourni directement
        payload.contentType = form.contentType;
      }

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

  const selectedRecipe = recipes.find((r) => r.id === recipeId);

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

          {/* Recette de contenu */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">
              Recette de contenu
              {loadingMeta && <span className="text-gray-400 font-normal ml-1">(chargement…)</span>}
            </label>
            <select
              value={recipeId}
              onChange={(e) => handleRecipeChange(e.target.value)}
              className={INPUT_CLS}
              disabled={loadingMeta}
            >
              <option value="">— Saisie manuelle —</option>
              {recipes.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.label || r.code}
                </option>
              ))}
            </select>
            {selectedRecipe && (
              <p className="text-xs text-gray-400 mt-1">
                Type dérivé : <span className="font-medium text-gray-600">{selectedRecipe.code}</span>
              </p>
            )}
          </div>

          {/* Type de contenu (legacy — affiché uniquement si pas de recipe) */}
          {!recipeId && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Type de contenu</label>
              <select
                value={form.contentType}
                onChange={(e) => set("contentType", e.target.value)}
                className={INPUT_CLS}
              >
                {CONTENT_TYPES.map((ct) => (
                  <option key={ct} value={ct}>{ct}</option>
                ))}
              </select>
            </div>
          )}

          {/* Assignees */}
          <div className="grid grid-cols-2 gap-3">
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
            <div>
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

          {/* Titre */}
          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Titre (optionnel)</label>
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
              disabled={saving || loadingMeta}
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
