"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { FormField } from "@/components/ui/FormField";
import { toast } from "@/components/ui/Toast";
import { SOURCE_LABELS_FR } from "@/lib/i18n/entityLabels";

export interface AttachRecipeOption {
  id: string;
  label: string;
  source: string;
}
export interface AttachAccountOption {
  id: string;
  name: string;
  handle: string;
}

interface AttachSlotModalProps {
  entityId: string;
  entityLabel: string;
  /** Fiche « admin » (ex-Bien) : N recettes lancées d'un coup (« missions »). */
  mode: "missions" | "reel";
  recipes: AttachRecipeOption[];
  accounts?: AttachAccountOption[];
  onClose: () => void;
}

/**
 * AttachSlotModal — attache un/des slot(s) à une fiche via
 * `POST /api/entities/[id]/slots`. Fusion de LaunchMissionsModal (fiche
 * admin ex-Bien, N recettes → N missions) et AttachReelModal (fiche team
 * ex-Tournage, 1 reel). Le mode est déterminé par le parent (capacités du
 * type), le service serveur applique le même routage.
 */
export function AttachSlotModal({
  entityId,
  entityLabel,
  mode,
  recipes,
  accounts = [],
  onClose,
}: AttachSlotModalProps) {
  const router = useRouter();
  // Mode missions.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [accountId, setAccountId] = useState("");
  // Mode reel.
  const [recipeId, setRecipeId] = useState(recipes[0]?.id ?? "");
  const [title, setTitle] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleSubmit() {
    setError(null);
    if (mode === "missions" && selected.size === 0) {
      setError("Sélectionnez au moins une recette.");
      return;
    }
    if (mode === "reel" && recipes.length > 0 && !recipeId) {
      setError("Choisissez une recette.");
      return;
    }
    setSubmitting(true);
    try {
      const body =
        mode === "missions"
          ? { recipeIds: [...selected], accountId: accountId || null }
          : {
              patternBindingId: recipeId || null,
              title: title.trim() || null,
              scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
            };
      const res = await fetch(`/api/entities/${entityId}/slots`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Échec de l'attache.");
      }
      if (mode === "missions") {
        const { count } = (await res.json()) as { count: number };
        toast.success(`${count} mission${count > 1 ? "s" : ""} créée${count > 1 ? "s" : ""}.`);
        router.push("/calendar");
      } else {
        toast.success("Reel ajouté");
        onClose();
        router.refresh();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erreur réseau.");
    } finally {
      setSubmitting(false);
    }
  }

  const accountOptions = [
    { value: "", label: "Aucun compte — production stock" },
    ...accounts.map((a) => ({ value: a.id, label: `@${a.handle} · ${a.name}` })),
  ];

  return (
    <Modal open onClose={onClose} size="md">
      <div className="p-6">
        <div className="flex items-start gap-3">
          <div className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted text-foreground shrink-0">
            <Clapperboard size={18} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] uppercase tracking-widest font-medium text-muted-foreground">
              {mode === "missions" ? "Missions" : "Reel"}
            </p>
            <h2 className="mt-1 text-[18px] font-semibold text-foreground">
              {mode === "missions" ? "Lancer des missions" : "Ajouter un reel"}
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              {mode === "missions"
                ? `Une mission par recette, toutes rattachées à « ${entityLabel} ».`
                : "Le reel démarre directement au montage (les rushs de la fiche sont partagés)."}
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
          {mode === "missions" ? (
            <>
              <div className="flex flex-col gap-1.5">
                <span className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                  Recettes
                </span>
                {recipes.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Aucune recette disponible.</p>
                ) : (
                  <div className="max-h-64 overflow-auto rounded-md border border-border divide-y divide-border">
                    {recipes.map((r) => (
                      <div key={r.id} className="flex items-center gap-2.5 px-3 py-2">
                        <Checkbox checked={selected.has(r.id)} onChange={() => toggle(r.id)} label={r.label} />
                        <span className="ml-auto text-[11px] text-muted-foreground shrink-0">
                          {SOURCE_LABELS_FR[r.source] ?? r.source}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <FormField label="Compte Instagram" help="Optionnel. S'applique à toutes les missions créées.">
                <Select
                  value={accountId}
                  onChange={setAccountId}
                  options={accountOptions}
                  placeholder="Aucun compte — production stock"
                />
              </FormField>
            </>
          ) : (
            <>
              {recipes.length > 0 ? (
                <FormField label="Recette" required>
                  <Select
                    value={recipeId}
                    onChange={setRecipeId}
                    options={recipes.map((r) => ({ value: r.id, label: r.label }))}
                    placeholder="Choisir une recette…"
                  />
                </FormField>
              ) : (
                <p className="text-[12px] text-warning-700 bg-warning-50 border border-warning-200 rounded-md px-3 py-2">
                  Aucune recette active sur ce compte. Configurez une recette pour ce compte avant
                  d&apos;ajouter des reels.
                </p>
              )}

              <FormField label="Titre (optionnel)" help="Par défaut : le nom de la recette.">
                <Input value={title} onChange={setTitle} placeholder="Ex : Reel visite salon" />
              </FormField>

              <FormField label="Date de publication (optionnel)" help="Vide = reel en banque (à planifier plus tard).">
                <input
                  type="datetime-local"
                  value={scheduledAt}
                  onChange={(e) => setScheduledAt(e.target.value)}
                  className="w-full h-8 rounded-md bg-card border border-input px-2.5 text-[13px] text-foreground focus:border-primary focus:ring-2 focus:ring-primary/30 focus:outline-none"
                />
              </FormField>
            </>
          )}

          {error && <p className="text-[12px] text-danger-700">{error}</p>}
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Annuler
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={
              submitting || (mode === "missions" ? selected.size === 0 : recipes.length === 0)
            }
          >
            {submitting
              ? "Envoi…"
              : mode === "missions"
                ? `Lancer ${selected.size || ""} mission${selected.size > 1 ? "s" : ""}`.replace("  ", " ")
                : "Ajouter le reel"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
