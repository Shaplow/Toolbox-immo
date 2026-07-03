"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { PageShell } from "@/components/ui/PageShell";
import { toast } from "@/components/ui/Toast";
import { Clapperboard } from "lucide-react";
import { CustomFieldsSchemaEditor } from "@/components/fields/CustomFieldsSchemaEditor";
import { CustomFieldValueInput } from "@/components/fields/CustomFieldValueInput";
import type { CustomField } from "@/lib/customFields";
import {
  LaunchMissionsModal,
  type LaunchRecipe,
  type LaunchAccount,
} from "./LaunchMissionsModal";

interface BienEditorClientProps {
  id: string;
  initialLabel: string;
  initialFields: Record<string, string>;
  initialFieldSchema: CustomField[];
  recipes: LaunchRecipe[];
  accounts: LaunchAccount[];
}

export function BienEditorClient({
  id,
  initialLabel,
  initialFields,
  initialFieldSchema,
  recipes,
  accounts,
}: BienEditorClientProps) {
  const router = useRouter();
  const [label, setLabel] = useState(initialLabel);
  const [fieldSchema, setFieldSchema] = useState<CustomField[]>(initialFieldSchema);
  const [fields, setFields] = useState<Record<string, string>>(initialFields);
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);
  // Modifications non enregistrées — pilote l'auto-save avant « Lancer des missions »
  // (sinon les missions se prérempliraient depuis les valeurs figées en base).
  const [dirty, setDirty] = useState(false);

  function handleLabelChange(value: string) {
    setLabel(value);
    setDirty(true);
  }

  function setValue(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  }

  function handleSchemaChange(nextSchema: CustomField[]) {
    setFieldSchema(nextSchema);
    // Élague les valeurs des champs supprimés.
    setFields((prev) => {
      const keys = new Set(nextSchema.map((f) => f.key));
      const next: Record<string, string> = {};
      for (const [k, v] of Object.entries(prev)) if (keys.has(k)) next[k] = v;
      return next;
    });
    setDirty(true);
  }

  /** PATCH le bien. Retourne true si enregistré. Toast d'erreur en cas d'échec. */
  async function persist(): Promise<boolean> {
    if (!label.trim()) {
      toast.error("Le nom du bien est requis.");
      return false;
    }
    const res = await fetch(`/api/properties/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ label: label.trim(), fields, fieldSchema }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      toast.error(data.error ?? "Erreur lors de la sauvegarde");
      return false;
    }
    setDirty(false);
    return true;
  }

  async function handleSave() {
    setSaving(true);
    try {
      if (await persist()) toast.success("Bien enregistré.");
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setSaving(false);
    }
  }

  /** Ouvre la modal de lancement — auto-enregistre d'abord si des changements
   *  sont en attente, pour que les missions partent des valeurs à jour. */
  async function handleOpenLaunch() {
    if (dirty) {
      setSaving(true);
      let ok = false;
      try {
        ok = await persist();
      } catch {
        toast.error("Erreur réseau");
      } finally {
        setSaving(false);
      }
      if (!ok) return;
      toast.success("Modifications enregistrées.");
    }
    setLaunchOpen(true);
  }

  async function handleArchive() {
    setArchiving(true);
    try {
      const res = await fetch(`/api/properties/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Erreur lors de l'archivage");
        return;
      }
      toast.success("Bien archivé.");
      router.push("/biens");
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setArchiving(false);
      setConfirmArchive(false);
    }
  }

  return (
    <PageShell variant="narrow">
      {/* Breadcrumb */}
      <Breadcrumb
        className="mb-5"
        items={[
          { href: "/biens", label: "Biens" },
          { label: label || "…" },
        ]}
      />

      {/* Label */}
      <div className="mb-6">
        <FormField label="Nom du bien" required>
          <Input
            value={label}
            onChange={handleLabelChange}
            placeholder="Ex : 12 rue des Lilas — T3"
            maxLength={200}
          />
        </FormField>
      </div>

      {/* Valeurs des champs (saisie typée) + définition repliable */}
      <Card className="p-4 mb-6">
        <h2 className="text-[13px] font-semibold text-foreground mb-3">Champs du bien</h2>

        {fieldSchema.length === 0 ? (
          <p className="text-xs text-muted-foreground italic">
            Aucun champ. Ajoutez-en via « Modifier les champs » ci-dessous.
          </p>
        ) : (
          <div className="space-y-3">
            {fieldSchema.map((field) => (
              <CustomFieldValueInput
                key={field.key}
                field={field}
                value={fields[field.key] ?? ""}
                onChange={(v) => setValue(field.key, v)}
                showLabel
              />
            ))}
          </div>
        )}

        <details className="mt-4 group">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground select-none">
            Modifier les champs (nom, type…)
          </summary>
          <div className="mt-3 pt-3 border-t border-border">
            <CustomFieldsSchemaEditor
              fields={fieldSchema}
              onChange={handleSchemaChange}
            />
          </div>
        </details>
      </Card>

      {/* Lancer des missions depuis ce bien */}
      <Card className="p-4 mb-6 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-foreground">Missions du bien</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Créez plusieurs vidéos de ce bien en une fois — une par recette, toutes
            préremplies depuis ses champs{dirty ? " (les modifications en cours seront enregistrées d'abord)" : ""}.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={Clapperboard}
          onClick={handleOpenLaunch}
          disabled={saving}
          className="shrink-0"
        >
          Lancer des missions
        </Button>
      </Card>

      {/* Actions */}
      <div className="flex items-center justify-between gap-3 pt-2">
        <Button
          variant="danger"
          size="sm"
          onClick={() => setConfirmArchive(true)}
          disabled={archiving}
        >
          Archiver
        </Button>
        <Button
          onClick={handleSave}
          disabled={saving || !label.trim()}
          size="sm"
        >
          {saving ? "Enregistrement…" : "Enregistrer"}
        </Button>
      </div>

      {launchOpen && (
        <LaunchMissionsModal
          propertyId={id}
          propertyLabel={label || "ce bien"}
          recipes={recipes}
          accounts={accounts}
          onClose={() => setLaunchOpen(false)}
        />
      )}

      {/* Confirmation archivage */}
      <ConfirmDialog
        open={confirmArchive}
        title="Archiver ce bien ?"
        description="Le bien sera masqué de la liste. Les missions qui le référencent ne seront pas affectées."
        confirmLabel="Archiver"
        variant="danger"
        onConfirm={handleArchive}
        onCancel={() => setConfirmArchive(false)}
      />
    </PageShell>
  );
}
