"use client";

import { ENTITY_TYPE_ICON_KEYS } from "@/components/entities/entityTypeIcons";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { FileStack, Plus, Lock } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Table, type TableColumn } from "@/components/ui/Table";
import { toast } from "@/components/ui/Toast";
import { CustomFieldsSchemaEditor } from "@/components/fields/CustomFieldsSchemaEditor";
import type { CustomField } from "@/lib/customFields";

export interface EntityTypeRow {
  id: string;
  name: string;
  namePlural: string | null;
  icon: string | null;
  fieldSchema: CustomField[];
  hasPlanning: boolean;
  hasAccount: boolean;
  hasRushes: boolean;
  hasAssignees: boolean;
  visibility: "admin" | "team";
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  position: number;
  isSystem: boolean;
  entityCount: number;
}

interface Draft {
  name: string;
  namePlural: string;
  icon: string;
  fieldSchema: CustomField[];
  hasPlanning: boolean;
  hasAccount: boolean;
  hasRushes: boolean;
  hasAssignees: boolean;
  visibility: "admin" | "team";
  needsAdminValidation: boolean;
  needsClientValidation: boolean;
  position: number;
}

function toDraft(t: EntityTypeRow | null): Draft {
  return {
    name: t?.name ?? "",
    namePlural: t?.namePlural ?? "",
    icon: t?.icon ?? "",
    fieldSchema: t?.fieldSchema ?? [],
    hasPlanning: t?.hasPlanning ?? false,
    hasAccount: t?.hasAccount ?? false,
    hasRushes: t?.hasRushes ?? false,
    hasAssignees: t?.hasAssignees ?? false,
    visibility: t?.visibility ?? "admin",
    needsAdminValidation: t?.needsAdminValidation ?? false,
    needsClientValidation: t?.needsClientValidation ?? false,
    position: t?.position ?? 0,
  };
}

const CAPABILITIES: { key: keyof Draft; label: string; help: string }[] = [
  { key: "hasPlanning", label: "Planning", help: "Date planifiée + statut (Planifié / Réalisé / Terminé)." },
  { key: "hasAccount", label: "Compte Instagram", help: "Rattaché à un compte cible." },
  { key: "hasRushes", label: "Rushs", help: "Upload de rushs partagés, transition auto vers « Réalisé »." },
  { key: "hasAssignees", label: "Assignés", help: "Vidéaste, monteur et CM par défaut." },
];

export function EntityTypesClient({ initialTypes }: { initialTypes: EntityTypeRow[] }) {
  const router = useRouter();
  const [types, setTypes] = useState<EntityTypeRow[]>(initialTypes);
  const [editing, setEditing] = useState<EntityTypeRow | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(toDraft(null));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<EntityTypeRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  function openCreate() {
    setDraft(toDraft(null));
    setEditing(null);
  }
  function openEdit(t: EntityTypeRow) {
    setDraft(toDraft(t));
    setEditing(t);
  }
  function closeDrawer() {
    setEditing(undefined);
  }

  async function handleSave() {
    if (!draft.name.trim()) {
      toast.error("Un nom est requis.");
      return;
    }
    if (draft.visibility === "team" && !draft.hasAssignees) {
      toast.error("Un type « équipe » doit avoir la capacité « Assignés » activée.");
      return;
    }
    setSaving(true);
    try {
      const isSystem = editing?.isSystem ?? false;
      const body: Record<string, unknown> = {
        name: draft.name.trim(),
        namePlural: draft.namePlural.trim() || null,
        icon: draft.icon.trim() || null,
        fieldSchema: draft.fieldSchema,
        // Éditables aussi sur les types système : pur workflow, aucun scoping.
        needsAdminValidation: draft.needsAdminValidation,
        needsClientValidation: draft.needsClientValidation,
      };
      if (!isSystem) {
        body.hasPlanning = draft.hasPlanning;
        body.hasAccount = draft.hasAccount;
        body.hasRushes = draft.hasRushes;
        body.hasAssignees = draft.hasAssignees;
        body.visibility = draft.visibility;
        body.position = draft.position;
      }
      const res = editing
        ? await fetch(`/api/entity-types/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/entity-types", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de l'enregistrement.");
        return;
      }
      toast.success(editing ? "Type enregistré." : "Type créé.");
      closeDrawer();
      router.refresh();
      // Optimistic-ish refresh : recharge la liste complète (peu de types).
      const listRes = await fetch("/api/entity-types");
      if (listRes.ok) {
        const listData = (await listRes.json()) as {
          types: Array<Omit<EntityTypeRow, "entityCount"> & { _count: { entities: number } }>;
        };
        setTypes(
          listData.types.map((t) => ({ ...t, entityCount: t._count.entities })),
        );
      }
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirmDelete) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/entity-types/${confirmDelete.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de la suppression.");
        return;
      }
      toast.success("Type supprimé.");
      setTypes((prev) => prev.filter((t) => t.id !== confirmDelete.id));
      setConfirmDelete(null);
      closeDrawer();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setDeleting(false);
    }
  }

  const columns: TableColumn<EntityTypeRow>[] = [
    {
      id: "name",
      label: "Nom",
      cell: (row) => (
        <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
          {row.isSystem && <Lock size={11} className="text-muted-foreground shrink-0" />}
          {row.name}
        </span>
      ),
    },
    {
      id: "visibility",
      label: "Visibilité",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.visibility === "team" ? "Équipe" : "Admin"}
        </span>
      ),
    },
    {
      id: "capabilities",
      label: "Capacités",
      cell: (row) => (
        <span className="text-[11px] text-muted-foreground">
          {CAPABILITIES.filter((c) => row[c.key]).map((c) => c.label).join(", ") || "Aucune"}
        </span>
      ),
    },
    {
      id: "fields",
      label: "Champs",
      cell: (row) => <span className="text-xs text-muted-foreground">{row.fieldSchema.length}</span>,
    },
    {
      id: "entityCount",
      label: "Fiches",
      align: "center",
      cell: (row) => <span className="text-xs text-muted-foreground">{row.entityCount}</span>,
    },
  ];

  return (
    <>
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <Breadcrumb
            className="mb-2"
            items={[{ href: "/fiches", label: "Fiches" }, { label: "Types de fiches" }]}
          />
          <h1 className="text-xl font-semibold text-foreground leading-tight">Types de fiches</h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Configure les capacités et les champs custom des types de fiches (« Bien », « Tournage »…).
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus size={14} className="mr-1.5" />
          Nouveau type
        </Button>
      </div>

      {types.length === 0 ? (
        <EmptyState
          icon={FileStack}
          title="Aucun type de fiche"
          description="Créez un type pour commencer."
          cta={{ label: "Créer un type", onClick: openCreate }}
        />
      ) : (
        <Table columns={columns} rows={types} rowKey={(r) => r.id} onRowClick={openEdit} />
      )}

      <Drawer open={editing !== undefined} onClose={closeDrawer} side="right" size="lg">
        <Drawer.Header onClose={closeDrawer}>
          {editing ? `Édition · ${editing.name}` : "Nouveau type de fiche"}
        </Drawer.Header>
        <Drawer.Body className="space-y-5">
          {editing?.isSystem && (
            <p className="text-[12px] text-muted-foreground bg-muted rounded-md px-3 py-2 inline-flex items-center gap-1.5">
              <Lock size={12} /> Type système — visibilité et capacités figées.
            </p>
          )}

          <FormField label="Nom" required>
            <Input value={draft.name} onChange={(v) => setDraft((d) => ({ ...d, name: v }))} placeholder="Ex : Bien" />
          </FormField>
          <FormField label="Nom pluriel" help="Utilisé pour les tabs et titres de section.">
            <Input
              value={draft.namePlural}
              onChange={(v) => setDraft((d) => ({ ...d, namePlural: v }))}
              placeholder="Ex : Biens"
            />
          </FormField>
          <FormField
            label="Icône"
            help={`Affichée dans les tabs et sur la fiche. Valeurs : ${ENTITY_TYPE_ICON_KEYS.join(", ")}.`}
          >
            <Input value={draft.icon} onChange={(v) => setDraft((d) => ({ ...d, icon: v }))} placeholder="home" />
          </FormField>

          <FormField label="Visibilité" help="Équipe = scopée par rôle (assignations). Admin = strictement administrateur.">
            <Select
              value={draft.visibility}
              onChange={(v) => setDraft((d) => ({ ...d, visibility: v as "admin" | "team" }))}
              options={[
                { value: "admin", label: "Admin" },
                { value: "team", label: "Équipe" },
              ]}
              disabled={editing?.isSystem}
            />
          </FormField>

          <FormField label="Position" help="Ordre d'affichage des tabs sur /fiches (croissant).">
            <Input
              value={String(draft.position)}
              onChange={(v) => {
                const n = Number(v);
                setDraft((d) => ({ ...d, position: Number.isFinite(n) ? n : d.position }));
              }}
              disabled={editing?.isSystem}
            />
          </FormField>

          <FormField
            label="Capacités"
            help="Planning + Rushs ⇒ la fiche fonctionne en mode « reel » (un tournage alimente le montage). Sinon, mode « missions » (N recettes lancées d'un coup depuis la fiche)."
          >
            <div className="space-y-1.5">
              {CAPABILITIES.map((c) => (
                <div key={c.key} className="flex items-start gap-2.5 py-1">
                  <Checkbox
                    checked={draft[c.key] as boolean}
                    onChange={(checked) => setDraft((d) => ({ ...d, [c.key]: checked }))}
                    disabled={editing?.isSystem}
                    label={c.label}
                  />
                  <button
                    type="button"
                    className="min-w-0 text-left disabled:cursor-not-allowed"
                    disabled={editing?.isSystem}
                    onClick={() =>
                      !editing?.isSystem &&
                      setDraft((d) => ({ ...d, [c.key]: !d[c.key] }))
                    }
                  >
                    <span className="block text-[13px] text-foreground">{c.label}</span>
                    <span className="block text-[11px] text-muted-foreground">{c.help}</span>
                  </button>
                </div>
              ))}
            </div>
          </FormField>

          <FormField
            label="Validation"
            help="Workflow d'approbation des fiches de ce type, selon qui les crée."
          >
            <div className="space-y-1.5">
              <div className="flex items-start gap-2.5 py-1">
                <Checkbox
                  checked={draft.needsAdminValidation}
                  onChange={(checked) => setDraft((d) => ({ ...d, needsAdminValidation: checked }))}
                  label="Validation admin"
                />
                <div className="min-w-0">
                  <span className="block text-[13px] text-foreground">Validation admin</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Une fiche créée par un client (bon de commande) doit être validée par un admin
                    avant de produire des publications.
                  </span>
                </div>
              </div>
              <div className="flex items-start gap-2.5 py-1">
                <Checkbox
                  checked={draft.needsClientValidation}
                  onChange={(checked) => setDraft((d) => ({ ...d, needsClientValidation: checked }))}
                  label="Validation client"
                />
                <div className="min-w-0">
                  <span className="block text-[13px] text-foreground">Validation client</span>
                  <span className="block text-[11px] text-muted-foreground">
                    Une fiche créée par l&apos;équipe est soumise au client pour accord (informatif,
                    ne bloque pas la production).
                  </span>
                </div>
              </div>
            </div>
          </FormField>

          <FormField label="Champs custom">
            <CustomFieldsSchemaEditor
              fields={draft.fieldSchema}
              onChange={(fields) => setDraft((d) => ({ ...d, fieldSchema: fields }))}
              allowRequired
            />
          </FormField>
        </Drawer.Body>
        <Drawer.Footer>
          {editing && !editing.isSystem && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmDelete(editing)}
              className="mr-auto"
            >
              Supprimer
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={closeDrawer}>
            Annuler
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </Drawer.Footer>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Supprimer ce type de fiche ?"
        description={
          confirmDelete
            ? `« ${confirmDelete.name} » sera supprimé. Refusé si des fiches existent encore pour ce type.`
            : ""
        }
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleting}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}
