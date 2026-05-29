"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2, Check } from "lucide-react";
import { toast } from "@/components/ui/Toast";

interface AssigneeOption {
  id: string;
  name: string | null;
  email: string | null;
}

interface Props {
  slotId: string;
  /** "MONTEUR" ou "CM" — détermine quelle clé envoyer en PATCH et quels users charger. */
  role: "MONTEUR" | "CM";
  /** Assigné courant. */
  current: AssigneeOption | null;
}

const FIELD_BY_ROLE = {
  MONTEUR: "assigneeMonteurId" as const,
  CM: "assigneeCmId" as const,
};

function labelOf(u: AssigneeOption): string {
  return u.name ?? u.email ?? u.id;
}

/**
 * Affiche l'assigné courant comme un bouton inline. Au clic, ouvre un
 * dropdown léger qui charge la liste des users {role}=MONTEUR|CM et permet
 * de réassigner sans quitter la fiche publication. ADMIN-only — gating
 * côté serveur via API (et côté UI : ne pas monter ce composant si pas ADMIN).
 */
export function AssigneeInlineEdit({ slotId, role, current }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [users, setUsers] = useState<AssigneeOption[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Click outside fermer
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // ESC fermer
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open]);

  // Charger les users à la première ouverture
  useEffect(() => {
    if (!open || users.length > 0 || loading) return;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch(`/api/admin/users?role=${role}`);
        if (!res.ok) throw new Error("Erreur de chargement");
        const data = (await res.json()) as AssigneeOption[];
        setUsers(data);
      } catch {
        toast.error("Impossible de charger les utilisateurs.");
      } finally {
        setLoading(false);
      }
    })();
  }, [open, role, users.length, loading]);

  async function handleSelect(userId: string | null) {
    setSaving(userId ?? "__unassign__");
    try {
      const res = await fetch(`/api/calendar/slots/${slotId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ [FIELD_BY_ROLE[role]]: userId }),
      });
      if (!res.ok) {
        const body = (await res.json()) as { error?: string };
        throw new Error(body.error ?? "Erreur lors de l'assignation");
      }
      toast.success(userId ? "Assigné mis à jour" : "Assignation retirée");
      setOpen(false);
      router.refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Erreur");
    } finally {
      setSaving(null);
    }
  }

  const currentLabel = current ? labelOf(current) : null;

  return (
    <div ref={containerRef} className="relative inline-block">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 rounded px-1 py-0.5 hover:bg-gray-100 transition-colors cursor-pointer text-left"
      >
        {currentLabel ? (
          <span className="text-gray-700">{currentLabel}</span>
        ) : (
          <span className="text-gray-400 italic">Non assigné</span>
        )}
        <ChevronDown size={10} className="text-gray-400" />
      </button>

      {open && (
        <div className="absolute left-0 top-full mt-1 z-30 w-56 bg-white rounded-lg border border-gray-200 shadow-lg py-1 max-h-60 overflow-y-auto">
          {loading ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs text-gray-400">
              <Loader2 size={12} className="animate-spin" /> Chargement…
            </div>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void handleSelect(null)}
                disabled={saving !== null || current === null}
                className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-gray-500 italic hover:bg-gray-50 transition-colors disabled:opacity-50"
              >
                {saving === "__unassign__" ? (
                  <Loader2 size={12} className="animate-spin" />
                ) : current === null ? (
                  <Check size={12} className="text-gray-950" />
                ) : (
                  <span className="w-3" />
                )}
                Non assigné
              </button>
              {users.length === 0 ? (
                <div className="px-3 py-2 text-xs text-gray-400">
                  Aucun utilisateur {role}.
                </div>
              ) : (
                users.map((u) => {
                  const isCurrent = current?.id === u.id;
                  const isSaving = saving === u.id;
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => void handleSelect(u.id)}
                      disabled={saving !== null || isCurrent}
                      className="flex items-center gap-2 w-full px-3 py-1.5 text-xs text-left text-gray-700 hover:bg-gray-50 transition-colors disabled:opacity-50 truncate"
                    >
                      {isSaving ? (
                        <Loader2 size={12} className="animate-spin shrink-0" />
                      ) : isCurrent ? (
                        <Check size={12} className="text-gray-950 shrink-0" />
                      ) : (
                        <span className="w-3 shrink-0" />
                      )}
                      <span className="truncate">{labelOf(u)}</span>
                    </button>
                  );
                })
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
