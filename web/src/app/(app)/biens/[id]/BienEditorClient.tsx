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
import { FlexFieldsEditor } from "@/components/calendar/FlexFieldsEditor";
import {
  LaunchMissionsModal,
  type LaunchRecipe,
  type LaunchAccount,
} from "./LaunchMissionsModal";

interface BienEditorClientProps {
  id: string;
  initialLabel: string;
  initialFields: Record<string, string>;
  initialFieldSchema: string[];
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
  const [fieldSchema, setFieldSchema] = useState<string[]>(initialFieldSchema);
  const [fields, setFields] = useState<Record<string, string>>(initialFields);
  const [saving, setSaving] = useState(false);
  const [confirmArchive, setConfirmArchive] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [launchOpen, setLaunchOpen] = useState(false);

  function handleFlexChange(schema: string[], values: Record<string, string>) {
    setFieldSchema(schema);
    setFields(values);
  }

  async function handleSave() {
    if (!label.trim()) {
      toast.error("Le nom du bien est requis.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/properties/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: label.trim(), fields, fieldSchema }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        toast.error(data.error ?? "Erreur lors de la sauvegarde");
        return;
      }
      toast.success("Bien enregistré.");
    } catch {
      toast.error("Erreur réseau");
    } finally {
      setSaving(false);
    }
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
            onChange={(value) => setLabel(value)}
            placeholder="Ex : 12 rue des Lilas — T3"
            maxLength={200}
          />
        </FormField>
      </div>

      {/* Flex fields */}
      <Card className="p-4 mb-6">
        <h2 className="text-[13px] font-semibold text-foreground mb-3">Champs du bien</h2>
        <FlexFieldsEditor
          schema={fieldSchema}
          values={fields}
          onChange={handleFlexChange}
        />
      </Card>

      {/* Lancer des missions depuis ce bien */}
      <Card className="p-4 mb-6 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-foreground">Missions du bien</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Créez plusieurs vidéos de ce bien en une fois — une par recette, toutes
            préremplies depuis ses champs.
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          icon={Clapperboard}
          onClick={() => setLaunchOpen(true)}
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
