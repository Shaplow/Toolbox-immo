"use client";

/**
 * CRUD des modèles de bons de commande — table + drawer d'édition.
 * Mirror du pattern EntityTypesClient : refetch complet après save.
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ClipboardList, Plus, Trash2, ArrowDown, ArrowUp } from "lucide-react";
import { Alert } from "@/components/ui/Alert";
import { Badge } from "@/components/ui/Badge";
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
import { Switch } from "@/components/ui/Switch";
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
  recipes: {
    patternTemplateId: string;
    label: string;
    count: number;
    isOptional: boolean;
    defaultSelected: boolean;
    minCount: number;
    shootTypeId: string | null;
  }[];
  shootTypes: {
    id: string;
    label: string;
    description: string | null;
    videosDecidedLater: boolean;
  }[];
  clientIds: string[];
  clientNames: string[];
  orderCount: number;
}

interface OrderTemplatesClientProps {
  initialTemplates: OrderTemplateRow[];
  entityTypes: { id: string; name: string; hasPlanning: boolean; hasRushes: boolean }[];
  patternTemplates: { id: string; label: string; source: string; accounts: string }[];
  clients: { id: string; name: string }[];
}

interface Draft {
  name: string;
  description: string;
  isArchived: boolean;
  itemTypeIds: string[];
  recipes: {
    patternTemplateId: string;
    count: number;
    isOptional: boolean;
    defaultSelected: boolean;
    minCount: number;
    /** `key` d'un type de `shootTypes`, ou "" pour « toutes les variantes ». */
    shootTypeKey: string;
  }[];
  /**
   * `key` est l'identité LOCALE d'un type dans ce brouillon ; `id` n'existe que
   * pour un type déjà en base. C'est ce couple qui permet au serveur de
   * préserver les ids existants — les commandes passées les référencent, et les
   * recréer leur ferait perdre leur type en silence.
   */
  shootTypes: {
    key: string;
    id: string | null;
    label: string;
    description: string;
    videosDecidedLater: boolean;
  }[];
  clientIds: string[];
}

/** Clé locale d'un type de tournage ajouté dans le drawer. */
function newShootTypeKey(existing: { key: string }[]): string {
  let n = existing.length + 1;
  while (existing.some((t) => t.key === `new-${n}`)) n += 1;
  return `new-${n}`;
}

/** Au-delà de ce nombre de clients, la liste passe en mode filtrable. */
const CLIENT_FILTER_THRESHOLD = 8;

function toDraft(t: OrderTemplateRow | null): Draft {
  return {
    name: t?.name ?? "",
    description: t?.description ?? "",
    isArchived: t?.isArchived ?? false,
    itemTypeIds: t?.items.map((i) => i.entityTypeId) ?? [],
    recipes:
      t?.recipes.map((r) => ({
        patternTemplateId: r.patternTemplateId,
        count: r.count,
        isOptional: r.isOptional,
        defaultSelected: r.defaultSelected,
        minCount: r.minCount,
        // Un type déjà en base a pour clé son propre id : les recettes y
        // réfèrent sans indirection.
        shootTypeKey: r.shootTypeId ?? "",
      })) ?? [],
    shootTypes:
      t?.shootTypes.map((st) => ({
        key: st.id,
        id: st.id,
        label: st.label,
        description: st.description ?? "",
        videosDecidedLater: st.videosDecidedLater,
      })) ?? [],
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
  const [clientFilter, setClientFilter] = useState("");

  const visibleClients = useMemo(() => {
    const q = clientFilter.trim().toLowerCase();
    if (!q) return clients;
    return clients.filter((c) => c.name.toLowerCase().includes(q));
  }, [clients, clientFilter]);

  const typeName = (id: string) => entityTypes.find((t) => t.id === id)?.name ?? id;
  const recipeLabel = (id: string) => patternTemplates.find((t) => t.id === id)?.label ?? id;

  function openCreate() {
    setDraft(toDraft(null));
    setClientFilter("");
    setEditing(null);
  }
  function openEdit(t: OrderTemplateRow) {
    setDraft(toDraft(t));
    setClientFilter("");
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
          recipes: {
            patternTemplateId: string;
            count: number;
            isOptional: boolean;
            defaultSelected: boolean;
            minCount: number;
            shootTypeId: string | null;
            patternTemplate: { label: string };
          }[];
          shootTypes: {
            id: string;
            label: string;
            description: string | null;
            videosDecidedLater: boolean;
          }[];
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
            isOptional: r.isOptional,
            defaultSelected: r.defaultSelected,
            minCount: r.minCount,
            shootTypeId: r.shootTypeId,
          })),
          shootTypes: t.shootTypes ?? [],
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
        recipes: draft.recipes.map((r) => ({
          ...r,
          // "" = vidéo commune à tous les types.
          shootTypeKey: r.shootTypeKey || null,
        })),
        shootTypes: draft.shootTypes.map((st) => ({
          id: st.id ?? undefined,
          key: st.key,
          label: st.label.trim(),
          description: st.description.trim() || null,
          videosDecidedLater: st.videosDecidedLater,
        })),
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
      cell: (row) =>
        // Un « — » discret laissait passer le seul défaut de config qui rend la
        // validation muette : sans recette, la commande est validée et aucune
        // publication n'est créée. Le badge le rend impossible à manquer.
        row.recipes.length === 0 ? (
          <Badge variant="warning" size="sm">
            0 vidéo
          </Badge>
        ) : (
          <span className="text-[11px] text-muted-foreground">
            {row.recipes
              .map((r) => {
                const qty = r.count > 1 ? `${r.label} ×${r.count}` : r.label;
                return r.isOptional ? `${qty} (au choix)` : qty;
              })
              .join(", ")}
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
          {/* Deux niveaux, comme « Fiches › Types de fiches » : un fil d'Ariane
              qui ne répète que le titre de la page n'apprend rien. */}
          <Breadcrumb
            className="mb-2"
            items={[{ href: "/commandes", label: "Commandes" }, { label: "Modèles de commande" }]}
          />
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

          {/* Le type de tournage commande quelles vidéos sont cochables. Il
              vivait comme un champ de la fiche Tournage, où il ne pilotait
              rien. */}
          <FormField
            label="Types de tournage"
            help="Le demandeur en choisit un, et ne voit que les vidéos qui lui sont rattachées. Laissez vide si ce modèle n'en a pas besoin."
          >
            <div className="space-y-2">
              {draft.shootTypes.map((st) => (
                <div
                  key={st.key}
                  className="rounded-md border border-border bg-muted/30 p-2.5 space-y-2"
                >
                  <div className="flex items-center gap-2">
                    <Input
                      value={st.label}
                      onChange={(v) =>
                        setDraft((d) => ({
                          ...d,
                          shootTypes: d.shootTypes.map((x) =>
                            x.key === st.key ? { ...x, label: v } : x,
                          ),
                        }))
                      }
                      placeholder="Ex : Tournage RVA"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDraft((d) => ({
                          ...d,
                          shootTypes: d.shootTypes.filter((x) => x.key !== st.key),
                          // Ses vidéos redeviennent communes plutôt que de
                          // disparaître : une vidéo affichée en trop se voit,
                          // une vidéo évaporée, non.
                          recipes: d.recipes.map((r) =>
                            r.shootTypeKey === st.key ? { ...r, shootTypeKey: "" } : r,
                          ),
                        }))
                      }
                      className="p-1 rounded text-muted-foreground hover:text-danger-600 shrink-0"
                      aria-label="Retirer le type de tournage"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                  <Input
                    value={st.description}
                    onChange={(v) =>
                      setDraft((d) => ({
                        ...d,
                        shootTypes: d.shootTypes.map((x) =>
                          x.key === st.key ? { ...x, description: v } : x,
                        ),
                      }))
                    }
                    placeholder="Ce que c'est, dit au client, sans jargon (optionnel)"
                  />
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Switch
                      checked={st.videosDecidedLater}
                      onChange={(v) =>
                        setDraft((d) => ({
                          ...d,
                          shootTypes: d.shootTypes.map((x) =>
                            x.key === st.key ? { ...x, videosDecidedLater: v } : x,
                          ),
                        }))
                      }
                    />
                    <span className="text-[11px] text-muted-foreground">
                      Nombre de vidéos décidé plus tard (aucune case à cocher)
                    </span>
                  </label>
                </div>
              ))}
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  setDraft((d) => ({
                    ...d,
                    shootTypes: [
                      ...d.shootTypes,
                      {
                        key: newShootTypeKey(d.shootTypes),
                        id: null,
                        label: "",
                        description: "",
                        videosDecidedLater: false,
                      },
                    ],
                  }))
                }
              >
                Ajouter un type de tournage
              </Button>
            </div>
          </FormField>

          <FormField
            label="Vidéos déclenchées"
            help="Recettes instanciées à la validation de la commande — les publications naissent en banque, à placer sur le calendrier."
          >
            <div className="space-y-2">
              {draft.recipes.length === 0 && (
                <Alert variant="warning">
                  Sans recette, la validation d&apos;une commande bâtie sur ce modèle ne créera
                  aucune publication.
                </Alert>
              )}
              {draft.recipes.map((r) => (
                <div key={r.patternTemplateId} className="space-y-1.5">
                <div className="flex items-center gap-2">
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
                {/* Réglages « au choix » — sous la ligne, pour ne pas alourdir
                    le cas nominal (vidéo imposée). */}
                <div className="flex flex-wrap items-center gap-3 pl-1">
                  {draft.shootTypes.length > 0 && (
                    <label className="flex items-center gap-2">
                      <span className="text-[11px] text-muted-foreground shrink-0">Type</span>
                      <div className="w-48">
                        <Select
                          value={r.shootTypeKey}
                          onChange={(v) =>
                            setDraft((d) => ({
                              ...d,
                              recipes: d.recipes.map((x) =>
                                x.patternTemplateId === r.patternTemplateId
                                  ? { ...x, shootTypeKey: v }
                                  : x,
                              ),
                            }))
                          }
                          options={[
                            { value: "", label: "Tous les types" },
                            ...draft.shootTypes.map((st) => ({
                              value: st.key,
                              label: st.label.trim() || "Type sans nom",
                            })),
                          ]}
                        />
                      </div>
                    </label>
                  )}
                  <label className="flex items-center gap-2 cursor-pointer">
                    <Switch
                      checked={r.isOptional}
                      onChange={(v) =>
                        setDraft((d) => ({
                          ...d,
                          recipes: d.recipes.map((x) =>
                            x.patternTemplateId === r.patternTemplateId
                              ? { ...x, isOptional: v }
                              : x,
                          ),
                        }))
                      }
                    />
                    <span className="text-[11px] text-muted-foreground">
                      Au choix du demandeur
                    </span>
                  </label>
                  {r.isOptional && (
                    <>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <Checkbox
                          checked={r.defaultSelected}
                          onChange={(v) =>
                            setDraft((d) => ({
                              ...d,
                              recipes: d.recipes.map((x) =>
                                x.patternTemplateId === r.patternTemplateId
                                  ? { ...x, defaultSelected: v }
                                  : x,
                              ),
                            }))
                          }
                          size="sm"
                          label="Pré-cochée"
                        />
                        <span className="text-[11px] text-muted-foreground">Pré-cochée</span>
                      </label>
                      <label className="flex items-center gap-2">
                        <span className="text-[11px] text-muted-foreground">Minimum</span>
                        <div className="w-24">
                          <NumberStepper
                            value={r.minCount}
                            onChange={(v) =>
                              setDraft((d) => ({
                                ...d,
                                recipes: d.recipes.map((x) =>
                                  x.patternTemplateId === r.patternTemplateId
                                    ? {
                                        ...x,
                                        // Borné par `count` : au-dessus, la
                                        // fourchette serait vide et le
                                        // formulaire insatisfiable.
                                        minCount: Math.max(0, Math.min(x.count, Math.round(v))),
                                      }
                                    : x,
                                ),
                              }))
                            }
                            min={0}
                            max={r.count}
                          />
                        </div>
                      </label>
                    </>
                  )}
                </div>
                </div>
              ))}
              {availableRecipes.length > 0 && (
                <Select
                  value=""
                  onChange={(v) =>
                    v &&
                    setDraft((d) => ({
                      ...d,
                      recipes: [
                        ...d.recipes,
                        // Imposée par défaut : c'était le seul comportement
                        // possible jusqu'ici, on ne change pas l'existant sous
                        // les pieds de l'admin qui ajoute une ligne.
                        {
                          patternTemplateId: v,
                          count: 1,
                          isOptional: false,
                          defaultSelected: true,
                          minCount: 0,
                          // Commune à tous les types : le choix par défaut
                          // reproduit le comportement d'avant les types.
                          shootTypeKey: "",
                        },
                      ],
                    }))
                  }
                  options={availableRecipes.map((t) => ({
                    value: t.id,
                    label: [
                      t.label,
                      SOURCE_LABELS_FR[t.source as keyof typeof SOURCE_LABELS_FR] ?? t.source,
                      // Vide sauf si le libellé existe en double.
                      t.accounts || null,
                    ]
                      .filter(Boolean)
                      .join(" · "),
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
                {/* Au-delà d'une poignée de clients, une liste de cases nue
                    n'est plus praticable : filtre + rappel des cochés. */}
                {clients.length > CLIENT_FILTER_THRESHOLD && (
                  <div className="flex items-center gap-2 pb-1">
                    <Input
                      value={clientFilter}
                      onChange={setClientFilter}
                      placeholder="Filtrer les clients…"
                    />
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {draft.clientIds.length} coché{draft.clientIds.length > 1 ? "s" : ""}
                    </span>
                  </div>
                )}
                <div
                  className={
                    clients.length > CLIENT_FILTER_THRESHOLD
                      ? "max-h-56 overflow-y-auto space-y-1.5 pr-1"
                      : "space-y-1.5"
                  }
                >
                  {visibleClients.length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Aucun client ne correspond.</p>
                  ) : (
                    visibleClients.map((c) => (
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
                    ))
                  )}
                </div>
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
