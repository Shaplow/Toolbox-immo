"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Clapperboard } from "lucide-react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Select } from "@/components/ui/Select";
import { Checkbox } from "@/components/ui/Checkbox";
import { FormField } from "@/components/ui/FormField";
import { toast } from "@/components/ui/Toast";

export interface LaunchRecipe {
  id: string;
  label: string;
  source: string;
}
export interface LaunchAccount {
  id: string;
  name: string;
  handle: string;
}

interface LaunchMissionsModalProps {
  propertyId: string;
  propertyLabel: string;
  recipes: LaunchRecipe[];
  accounts: LaunchAccount[];
  onClose: () => void;
}

const SOURCE_LABEL: Record<string, string> = {
  auto_template: "Génération auto",
  manual_rushes: "Montage rushes",
  external_upload: "Upload externe",
};

export function LaunchMissionsModal({
  propertyId,
  propertyLabel,
  recipes,
  accounts,
  onClose,
}: LaunchMissionsModalProps) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [accountId, setAccountId] = useState("");
  const [submitting, setSubmitting] = useState(false);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function handleLaunch() {
    if (selected.size === 0) {
      toast.error("Sélectionnez au moins une recette.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch(`/api/properties/${propertyId}/missions`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipeIds: [...selected], accountId: accountId || null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec du lancement des missions.");
        return;
      }
      const { count } = (await res.json()) as { count: number };
      toast.success(`${count} mission${count > 1 ? "s" : ""} créée${count > 1 ? "s" : ""}.`);
      router.push("/calendar");
    } catch {
      toast.error("Erreur réseau.");
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
              Missions
            </p>
            <h2 className="mt-1 text-[18px] font-semibold text-foreground">
              Lancer des missions
            </h2>
            <p className="mt-0.5 text-[12px] text-muted-foreground">
              Une mission par recette, toutes rattachées au bien « {propertyLabel} ».
            </p>
          </div>
        </div>

        <div className="mt-6 space-y-4">
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
                    <Checkbox
                      checked={selected.has(r.id)}
                      onChange={() => toggle(r.id)}
                      label={r.label}
                    />
                    <span className="ml-auto text-[11px] text-muted-foreground shrink-0">
                      {SOURCE_LABEL[r.source] ?? r.source}
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
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Annuler
          </Button>
          <Button onClick={handleLaunch} disabled={submitting || selected.size === 0}>
            {submitting
              ? "Lancement…"
              : `Lancer ${selected.size || ""} mission${selected.size > 1 ? "s" : ""}`.replace(
                  "  ",
                  " ",
                )}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
