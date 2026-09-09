"use client";

/**
 * Équipe par défaut d'un compte Instagram.
 *
 * Niveau le plus bas de la cascade d'assignation : recette → compte → vide.
 * L'équipe est presque toujours la même pour un compte donné ; la régler ici
 * évite de la re-saisir sur chaque recette (et de finir avec des recettes sans
 * personne dessus, donc des tournages que nul ne voit).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { FormField } from "@/components/ui/FormField";
import { Section } from "@/components/ui/molecules/Section";
import { Select } from "@/components/ui/Select";
import { toast } from "@/components/ui/Toast";

interface Option {
  id: string;
  name: string;
}

export interface AccountDefaultTeamProps {
  accountId: string;
  initial: {
    videasteId: string | null;
    monteurId: string | null;
    cmId: string | null;
  };
  videastes: Option[];
  monteurs: Option[];
  cms: Option[];
}

const NONE = [{ value: "", label: "— Aucun —" }];
const options = (list: Option[]) => [...NONE, ...list.map((o) => ({ value: o.id, label: o.name }))];

export function AccountDefaultTeam({
  accountId,
  initial,
  videastes,
  monteurs,
  cms,
}: AccountDefaultTeamProps) {
  const router = useRouter();
  const [videasteId, setVideasteId] = useState(initial.videasteId ?? "");
  const [monteurId, setMonteurId] = useState(initial.monteurId ?? "");
  const [cmId, setCmId] = useState(initial.cmId ?? "");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch(`/api/admin/accounts/${accountId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultAssigneeVideasteId: videasteId || null,
          defaultAssigneeMonteurId: monteurId || null,
          defaultAssigneeCmId: cmId || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de l'enregistrement.");
        return;
      }
      toast.success("Équipe par défaut enregistrée.");
      setDirty(false);
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Section title="Équipe par défaut" icon={Users}>
      <p className="text-[12px] text-muted-foreground mb-3">
        Appliquée aux recettes de ce compte qui ne désignent personne, et aux fiches créées
        dessus. Une recette peut toujours surcharger.
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <FormField label="Vidéaste">
          <Select
            value={videasteId}
            onChange={(v) => {
              setVideasteId(v);
              setDirty(true);
            }}
            options={options(videastes)}
          />
        </FormField>
        <FormField label="Monteur">
          <Select
            value={monteurId}
            onChange={(v) => {
              setMonteurId(v);
              setDirty(true);
            }}
            options={options(monteurs)}
          />
        </FormField>
        <FormField label="CM">
          <Select
            value={cmId}
            onChange={(v) => {
              setCmId(v);
              setDirty(true);
            }}
            options={options(cms)}
          />
        </FormField>
      </div>
      {dirty && (
        <div className="flex justify-end mt-3">
          <Button size="sm" onClick={() => void save()} disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      )}
    </Section>
  );
}
