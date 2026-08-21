"use client";

/**
 * CRUD des modèles de bons de commande — table + drawer d'édition.
 * Mirror du pattern EntityTypesClient : refetch complet après save.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Plus, Trash2, ArrowDown, ArrowUp } from "lucide-react";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Checkbox } from "@/components/ui/Checkbox";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Drawer } from "@/components/ui/Drawer";
import { EmptyState } from "@/components/ui/EmptyState";
import { FormField } from "@/components/ui/FormField";
import { Input } from "@/components/ui/Input";
import { NumberStepper } from "@/components/ui/NumberStepper";
import { Select } from "@/components/ui/Select";
import { Table, type TableColumn } from "@/components/ui/Table";
import { Textarea } from "@/components/ui/Textarea";
import { toast } from "@/components/ui/Toast";
import { SOURCE_LABELS_FR } from "@/lib/i18n/glossary";

export interface OrderTemplateRow {
  id: string;
  name: string;
  description: string | null;
  isArchived: boolean;
  position: number;
  items: { entityTypeId: string; entityTypeName: string }[];
  recipes: { patternTemplateId: string; label: string; count: number }[];
  clientIds: string[];
  clientNames: string[];
  orderCount: number;
}

interface OrderTemplatesClientProps {
  initialTemplates: OrderTemplateRow[];
  entityTypes: { id: string; name: string; hasPlanning: boolean; hasRushes: boolean }[];
  patternTemplates: { id: string; label: string; source: string }[];
  clients: { id: string; name: string }[];
}

interface Draft {
  name: string;
  description: string;
  isArchived: boolean;
  itemTypeIds: string[];
  recipes: { patternTemplateId: string; count: number }[];
  clientIds: string[];
}

function toDraft(t: OrderTemplateRow | null): Draft {
  return {
    name: t?.name ?? "",
    description: t?.description ?? "",
    isArchived: t?.isArchived ?? false,
    itemTypeIds: t?.items.map((i) => i.entityTypeId) ?? [],
    recipes: t?.recipes.map((r) => ({ patternTemplateId: r.patternTemplateId, count: r.count })) ?? [],
    clientIds: t?.clientIds ?? [],
  };
}

export function OrderTemplatesClient({
  initialTemplates,
  entityTypes,
  patternTemplates,
  clients,
}: OrderTemplatesClientProps) {
  const router = useRouter();
  const [templates, setTemplates] = useState<OrderTemplateRow[]>(initialTemplates);
  const [editing, setEditing] = useState<OrderTemplateRow | null | undefined>(undefined);
  const [draft, setDraft] = useState<Draft>(toDraft(null));
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<OrderTemplateRow | null>(null);
  const [deleting, setDeleting] = useState(false);

  const typeName = (id: string) => entityTypes.find((t) => t.id === id)?.name ?? id;
  const recipeLabel = (id: string) => patternTemplates.find((t) => t.id === id)?.label ?? id;

  function openCreate() {
    setDraft(toDraft(null));
    setEditing(null);
  }
  function openEdit(t: OrderTemplateRow) {
    setDraft(toDraft(t));
    setEditing(t);
  }
  function closeDrawer() {
    setEditing(undefined);
  }

  async function refetch() {
    try {
      const res = await fetch("/api/admin/order-templates?includeArchived=true");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        templates: {
          id: string;
          name: string;
          description: string | null;
          isArchived: boolean;
          position: number;
          items: { entityTypeId: string; entityType: { name: string } }[];
          recipes: { patternTemplateId: string; count: number; patternTemplate: { label: string } }[];
          accesses: { clientId: string; client: { name: string } }[];
          _count: { orders: number };
        }[];
      };
      setTemplates(
        data.templates.map((t) => ({
          id: t.id,
          name: t.name,
          description: t.description,
          isArchived: t.isArchived,
          position: t.position,
          items: t.items.map((i) => ({
            entityTypeId: i.entityTypeId,
            entityTypeName: i.entityType.name,
          })),
          recipes: t.recipes.map((r) => ({
            patternTemplateId: r.patternTemplateId,
            label: r.patternTemplate.label,
            count: r.count,
          })),
          clientIds: t.accesses.map((a) => a.clientId),
          clientNames: t.accesses.map((a) => a.client.name),
          orderCount: t._count.orders,
        })),
      );
    } catch {
      router.refresh();
    }
  }

  async function handleSave() {
    if (!draft.name.trim()) {
      toast.error("Un nom est requis.");
      return;
    }
    if (draft.itemTypeIds.length === 0) {
      toast.error("Ajoutez au moins un type de fiche.");
      return;
    }
    setSaving(true);
    try {
      const body = {
        name: draft.name.trim(),
        description: draft.description.trim() || null,
        isArchived: draft.isArchived,
        items: draft.itemTypeIds.map((entityTypeId) => ({ entityTypeId })),
        recipes: draft.recipes,
        clientIds: draft.clientIds,
      };
      const res = editing
        ? await fetch(`/api/admin/order-templates/${editing.id}`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          })
        : await fetch("/api/admin/order-templates", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de l'enregistrement.");
        return;
      }
      toast.success(editing ? "Modèle mis à jour." : "Modèle créé.");
      closeDrawer();
      await refetch();
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
      const res = await fetch(`/api/admin/order-templates/${confirmDelete.id}`, {
        method: "DELETE",
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de la suppression.");
        return;
      }
      toast.success("Modèle supprimé.");
      setConfirmDelete(null);
      closeDrawer();
      await refetch();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setDeleting(false);
    }
  }

  const columns: TableColumn<OrderTemplateRow>[] = [
    {
      id: "name",
      label: "Nom",
      sortable: true,
      cell: (row) => (
        <span className="font-medium text-foreground inline-flex items-center gap-2">
          {row.name}
          {row.isArchived && (
            <span className="text-[10px] rounded px-1.5 py-0.5 border border-border bg-muted text-muted-foreground">
              Archivé
            </span>
          )}
        </span>
      ),
    },
    {
      id: "items",
      label: "Fiches",
      cell: (row) => (
        <span className="text-[11px] text-muted-foreground">
          {row.items.map((i) => i.entityTypeName).join(" + ") || "—"}
        </span>
      ),
    },
    {
      id: "recipes",
      label: "Vidéos",
      cell: (row) => (
        <span className="text-[11px] text-muted-foreground">
          {row.recipes.length === 0
            ? "—"
            : row.recipes.map((r) => (r.count > 1 ? `${r.label} ×${r.count}` : r.label)).join(", ")}
        </span>
      ),
    },
    {
      id: "clients",
      label: "Clients",
      cell: (row) => (
        <span className="text-[11px] text-muted-foreground">
          {row.clientNames.join(", ") || "Aucun"}
        </span>
      ),
    },
    {
      id: "orders",
      label: "Commandes",
      align: "center",
      cell: (row) => <span className="text-xs text-muted-foreground">{row.orderCount}</span>,
    },
  ];

  const availableTypes = entityTypes.filter((t) => !draft.itemTypeIds.includes(t.id));
  const availableRecipes = patternTemplates.filter(
    (t) => !draft.recipes.some((r) => r.patternTemplateId === t.id),
  );

  function moveItem(index: number, delta: -1 | 1) {
    setDraft((d) => {
      const ids = [...d.itemTypeIds];
      const j = index + delta;
      if (j < 0 || j >= ids.length) return d;
      [ids[index], ids[j]] = [ids[j], ids[index]];
      return { ...d, itemTypeIds: ids };
    });
  }

  return (
    <>
      <div className="flex items-center justify-between gap-4 mb-6">
        <div>
          <Breadcrumb className="mb-2" items={[{ label: "Modèles de commande" }]} />
          <h1 className="text-xl font-semibold text-foreground leading-tight">
            Modèles de commande
          </h1>
          <p className="mt-0.5 text-[13px] text-muted-foreground">
            Composition des bons de commande proposés aux agences : fiches à remplir, vidéos
            déclenchées, clients autorisés.
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus size={14} className="mr-1.5" />
          Nouveau modèle
        </Button>
      </div>

      {templates.length === 0 ? (
        <EmptyState
          icon={ClipboardList}
          title="Aucun modèle de commande"
          description="Créez un modèle pour permettre aux agences de passer commande."
          cta={{ label: "Créer un modèle", onClick: openCreate }}
        />
      ) : (
        <Table columns={columns} rows={templates} rowKey={(r) => r.id} onRowClick={openEdit} />
      )}

      <Drawer open={editing !== undefined} onClose={closeDrawer} side="right" size="lg">
        <Drawer.Header onClose={closeDrawer}>
          {editing ? `Édition · ${editing.name}` : "Nouveau modèle de commande"}
        </Drawer.Header>
        <Drawer.Body className="space-y-5">
          <FormField label="Nom">
            <Input
              value={draft.name}
              onChange={(v) => setDraft((d) => ({ ...d, name: v }))}
              placeholder="Ex : Bien + tournage (3 reels)"
            />
          </FormField>

          <FormField label="Description" help="Texte d'aide affiché à l'agence au moment de commander.">
            <Textarea
              value={draft.description}
              onChange={(v) => setDraft((d) => ({ ...d, description: v }))}
              rows={2}
            />
          </FormField>

          <FormField
            label="Fiches à remplir"
            help="Types de fiches que l'agence renseigne, dans l'ordre du formulaire. Un tournage pointera automatiquement la fiche précédente (ex : le bien)."
          >
            <div className="space-y-2">
              {draft.itemTypeIds.map((typeId, i) => (
                <div key={typeId} className="flex items-center gap-2">
                  <span className="flex-1 text-[13px] text-foreground rounded-md border border-border bg-muted/50 px-3 py-1.5">
                    {i + 1}. {typeName(typeId)}
                  </span>
                  <button
                    type="button"
                    onClick={() => moveItem(i, -1)}
                    disabled={i === 0}
                    className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Monter"
                  >
                    <ArrowUp size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveItem(i, 1)}
                    disabled={i === draft.itemTypeIds.length - 1}
                    className="p-1 rounded text-muted-foreground hover:text-foreground disabled:opacity-30"
                    aria-label="Descendre"
                  >
                    <ArrowDown size={13} />
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        itemTypeIds: d.itemTypeIds.filter((id) => id !== typeId),
                      }))
                    }
                    className="p-1 rounded text-muted-foreground hover:text-danger-600"
                    aria-label={`Retirer ${typeName(typeId)}`}
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {availableTypes.length > 0 && (
                <Select
                  value=""
                  onChange={(v) =>
                    v && setDraft((d) => ({ ...d, itemTypeIds: [...d.itemTypeIds, v] }))
                  }
                  options={availableTypes.map((t) => ({ value: t.id, label: t.name }))}
                  placeholder="Ajouter un type de fiche…"
                />
              )}
            </div>
          </FormField>

          <FormField
            label="Vidéos déclenchées"
            help="Recettes instanciées à la validation de la commande — les publications naissent en banque, à placer sur le calendrier."
          >
            <div className="space-y-2">
              {draft.recipes.map((r) => (
                <div key={r.patternTemplateId} className="flex items-center gap-2">
                  <span className="flex-1 min-w-0 truncate text-[13px] text-foreground rounded-md border border-border bg-muted/50 px-3 py-1.5">
                    {recipeLabel(r.patternTemplateId)}
                    <span className="ml-2 text-[11px] text-muted-foreground">
                      {SOURCE_LABELS_FR[
                        patternTemplates.find((t) => t.id === r.patternTemplateId)
                          ?.source as keyof typeof SOURCE_LABELS_FR
                      ] ?? ""}
                    </span>
                  </span>
                  <div className="w-28 shrink-0">
                    <NumberStepper
                      value={r.count}
                      onChange={(v) =>
                        setDraft((d) => ({
                          ...d,
                          recipes: d.recipes.map((x) =>
                            x.patternTemplateId === r.patternTemplateId
                              ? { ...x, count: Math.max(1, Math.min(20, Math.round(v))) }
                              : x,
                          ),
                        }))
                      }
                      min={1}
                      max={20}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      setDraft((d) => ({
                        ...d,
                        recipes: d.recipes.filter(
                          (x) => x.patternTemplateId !== r.patternTemplateId,
                        ),
                      }))
                    }
                    className="p-1 rounded text-muted-foreground hover:text-danger-600"
                    aria-label="Retirer la recette"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              {availableRecipes.length > 0 && (
                <Select
                  value=""
                  onChange={(v) =>
                    v &&
                    setDraft((d) => ({
                      ...d,
                      recipes: [...d.recipes, { patternTemplateId: v, count: 1 }],
                    }))
                  }
                  options={availableRecipes.map((t) => ({
                    value: t.id,
                    label: `${t.label} · ${SOURCE_LABELS_FR[t.source as keyof typeof SOURCE_LABELS_FR] ?? t.source}`,
                  }))}
                  placeholder="Ajouter une recette…"
                />
              )}
            </div>
          </FormField>

          <FormField
            label="Clients autorisés"
            help="Seuls les clients cochés voient ce modèle dans leur espace commande."
          >
            {clients.length === 0 ? (
              <p className="text-xs text-muted-foreground italic">
                Aucun client — créez-en un dans Configuration → Clients.
              </p>
            ) : (
              <div className="space-y-1.5">
                {clients.map((c) => (
                  <div key={c.id} className="flex items-center gap-2.5">
                    <Checkbox
                      checked={draft.clientIds.includes(c.id)}
                      onChange={(checked) =>
                        setDraft((d) => ({
                          ...d,
                          clientIds: checked
                            ? [...d.clientIds, c.id]
                            : d.clientIds.filter((id) => id !== c.id),
                        }))
                      }
                      label={c.name}
                    />
                    <span className="text-[13px] text-foreground">{c.name}</span>
                  </div>
                ))}
              </div>
            )}
          </FormField>

          {editing && (
            <FormField label="Archivage" help="Un modèle archivé n'est plus proposé aux agences.">
              <div className="flex items-center gap-2.5">
                <Checkbox
                  checked={draft.isArchived}
                  onChange={(checked) => setDraft((d) => ({ ...d, isArchived: checked }))}
                  label="Archivé"
                />
                <span className="text-[13px] text-foreground">Archivé</span>
              </div>
            </FormField>
          )}
        </Drawer.Body>
        <Drawer.Footer>
          {editing && (
            <Button
              variant="danger"
              size="sm"
              onClick={() => setConfirmDelete(editing)}
              disabled={saving}
            >
              Supprimer
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" onClick={closeDrawer} disabled={saving}>
              Annuler
            </Button>
            <Button size="sm" onClick={() => void handleSave()} disabled={saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </Drawer.Footer>
      </Drawer>

      <ConfirmDialog
        open={confirmDelete !== null}
        title="Supprimer le modèle ?"
        description={`« ${confirmDelete?.name ?? ""} » sera supprimé définitivement. Refusé si des commandes l'utilisent (archivez-le à la place).`}
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleting}
        onConfirm={() => void handleDelete()}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}
