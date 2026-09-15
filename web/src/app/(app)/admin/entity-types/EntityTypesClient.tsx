"use client";

import { ENTITY_TYPE_ICON_KEYS } from "@/components/entities/entityTypeIcons";
import { Alert } from "@/components/ui/Alert";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FileStack, Plus } from "lucide-react";
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
import {
  MAX_ENTITY_LABEL,
  findUnknownTemplateKeys,
  renderLabelTemplate,
  resolveEntityLabel,
} from "@/lib/entityLabel";
import { TemplateTextField } from "@/components/fields/TemplateTextField";

export interface EntityTypeRow {
  id: string;
  name: string;
  namePlural: string | null;
  icon: string | null;
  fieldSchema: CustomField[];
  labelTemplate: string | null;
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
  labelTemplate: string;
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
    labelTemplate: t?.labelTemplate ?? "",
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

  /**
   * Aperçu du modèle de libellé. Il n'y a pas de fiche ici : on rend contre un
   * échantillon synthétique (la valeur d'un champ = son libellé, ou sa première
   * option), puis une seconde fois à vide pour montrer le repli.
   */
  const labelPreview = useMemo(() => {
    const type = { name: draft.name.trim() || "Fiche", labelTemplate: draft.labelTemplate };
    const sample = Object.fromEntries(
      draft.fieldSchema.map((f) => [
        f.key,
        f.type === "select" ? (f.options?.[0] ?? f.label) : f.label,
      ]),
    );
    const filled = renderLabelTemplate(type, sample);
    return {
      filled: filled || resolveEntityLabel(type, sample),
      empty: resolveEntityLabel(type, {}),
      unknownKeys: findUnknownTemplateKeys(draft.labelTemplate, draft.fieldSchema),
      // Un modèle sans variable donne le même libellé à toutes les fiches.
      constant: draft.labelTemplate.trim().length > 0 && !draft.labelTemplate.includes("{{"),
      tooLong: filled.length >= MAX_ENTITY_LABEL,
    };
  }, [draft.name, draft.labelTemplate, draft.fieldSchema]);
  const [saving, setSaving] = useState(false);
  /**
   * Impact des champs qu'on vient de passer en « requis ».
   *
   * Depuis que `required` bloque à chaque enregistrement, cocher la case peut
   * rendre insauvables des fiches déjà en base. L'admin doit le voir ici, au
   * moment du choix — pas le découvrir plus tard sur une fiche qu'il essaie
   * d'éditer sans comprendre pourquoi elle refuse.
   */
  const [impacts, setImpacts] = useState<
    { key: string; label: string; type: string; missing: number }[]
  >([]);
  const [backfilling, setBackfilling] = useState<string | null>(null);
  const [backfillValues, setBackfillValues] = useState<Record<string, string>>({});

  /**
   * Champs passés à `required` DANS CE BROUILLON — pas ceux qui l'étaient déjà.
   * Un champ requis de longue date a déjà été absorbé par les fiches
   * existantes ; réafficher son impact à chaque ouverture du drawer serait du
   * bruit.
   */
  const newlyRequiredKeys = useMemo(() => {
    if (!editing) return [];
    const before = new Set(
      editing.fieldSchema.filter((f) => f.required).map((f) => f.key),
    );
    return draft.fieldSchema
      .filter((f) => f.required && !before.has(f.key))
      .map((f) => f.key);
  }, [editing, draft.fieldSchema]);

  useEffect(() => {
    if (!editing || newlyRequiredKeys.length === 0) {
      setImpacts([]);
      return;
    }
    let cancelled = false;
    const keys = newlyRequiredKeys.join(",");
    void (async () => {
      try {
        const res = await fetch(
          `/api/entity-types/${editing.id}/required-impact?keys=${encodeURIComponent(keys)}`,
        );
        if (!res.ok) return;
        const data = (await res.json()) as { impacts?: typeof impacts };
        if (!cancelled) setImpacts((data.impacts ?? []).filter((i) => i.missing > 0));
      } catch {
        // Silencieux : c'est un avertissement de confort, son absence ne doit
        // pas empêcher d'enregistrer le type.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [editing, newlyRequiredKeys]);

  async function runBackfill(key: string) {
    if (!editing) return;
    setBackfilling(key);
    try {
      const res = await fetch(`/api/entity-types/${editing.id}/backfill-field`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, value: backfillValues[key] ?? "" }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string; updated?: number };
      if (!res.ok) {
        toast.error(data.error ?? "Échec du remplissage.");
        return;
      }
      toast.success(`${data.updated ?? 0} fiche(s) remplie(s).`);
      setImpacts((prev) => prev.filter((i) => i.key !== key));
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setBackfilling(null);
    }
  }
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
      const body: Record<string, unknown> = {
        name: draft.name.trim(),
        namePlural: draft.namePlural.trim() || null,
        icon: draft.icon.trim() || null,
        fieldSchema: draft.fieldSchema,
        labelTemplate: draft.labelTemplate.trim() || null,
        needsAdminValidation: draft.needsAdminValidation,
        needsClientValidation: draft.needsClientValidation,
        hasPlanning: draft.hasPlanning,
        hasAccount: draft.hasAccount,
        hasRushes: draft.hasRushes,
        hasAssignees: draft.hasAssignees,
        visibility: draft.visibility,
        position: draft.position,
      };
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
        <span className="font-medium text-foreground">{row.name}</span>
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
      id: "labelMode",
      label: "Libellé",
      cell: (row) =>
        (row.labelTemplate ?? "").trim() ? (
          <span className="text-[11px] text-success-700">Automatique</span>
        ) : (
          <span className="text-[11px] text-muted-foreground">Saisi à la main</span>
        ),
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
            />
          </FormField>

          <FormField label="Position" help="Ordre d'affichage des tabs sur /fiches (croissant).">
            <Input
              value={String(draft.position)}
              onChange={(v) => {
                const n = Number(v);
                setDraft((d) => ({ ...d, position: Number.isFinite(n) ? n : d.position }));
              }}
            />
          </FormField>

          <FormField
            label="Capacités"
            help="Planning + Rushs ⇒ la fiche fonctionne en mode « reel » (un tournage alimente le montage). Sinon, N recettes sont lancées d'un coup depuis la fiche, une publication par recette."
          >
            <div className="space-y-1.5">
              {CAPABILITIES.map((c) => (
                <div key={c.key} className="flex items-start gap-2.5 py-1">
                  <Checkbox
                    checked={draft[c.key] as boolean}
                    onChange={(checked) => setDraft((d) => ({ ...d, [c.key]: checked }))}
                    label={c.label}
                  />
                  <button
                    type="button"
                    className="min-w-0 text-left"
                    onClick={() => setDraft((d) => ({ ...d, [c.key]: !d[c.key] }))}
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

          {/* AVANT l'éditeur de schéma, volontairement : en dernier position
              d'un drawer long, sous un éditeur haut, ce réglage restait sous la
              ligne de flottaison — livré mais jamais vu, donc jamais activé.
              Les chips se recalculent depuis `draft.fieldSchema` à chaque
              frappe : la position n'a aucune incidence technique. */}
          <FormField
            label="Modèle de libellé"
            help="Laissez vide pour saisir le libellé à la main sur chaque fiche. Rempli, le libellé est calculé depuis les champs et suit leurs modifications."
          >
            <TemplateTextField
              value={draft.labelTemplate}
              onChange={(v) => setDraft((d) => ({ ...d, labelTemplate: v }))}
              keys={draft.fieldSchema}
              placeholder="{{adresse}}, {{ville}}"
              emptyKeysHint="Ajoutez d'abord des champs ci-dessous pour pouvoir les insérer."
              unknownKeys={labelPreview.unknownKeys}
              preview={
                draft.labelTemplate.trim() ? (
                  <div className="space-y-0.5 text-[11px]">
                    <p className="text-muted-foreground">
                      Aperçu :{" "}
                      <span className="text-foreground font-medium">{labelPreview.filled}</span>
                    </p>
                    {/* Sans cette ligne, le repli reste invisible jusqu'à la
                        première fiche mal remplie. */}
                    <p className="text-muted-foreground">
                      Si les champs sont vides :{" "}
                      <span className="text-foreground font-medium">{labelPreview.empty}</span>
                    </p>
                    {labelPreview.constant && (
                      <p className="text-warning-700">
                        Modèle sans aucun champ — toutes les fiches auront le même libellé.
                      </p>
                    )}
                    {labelPreview.tooLong && (
                      <p className="text-warning-700">
                        Aperçu au-delà de {MAX_ENTITY_LABEL} caractères — le libellé sera tronqué.
                      </p>
                    )}
                  </div>
                ) : draft.fieldSchema.length > 0 ? (
                  // Amorce : sans elle, un type sans modèle ne dit rien de son
                  // état — la saisie manuelle passe pour une fatalité alors
                  // qu'elle est évitable en un clic sur une puce ci-dessus.
                  <p className="text-[11px] text-muted-foreground">
                    Les fiches de ce type demandent un libellé à la main. Insérez un champ
                    ci-dessus pour l&apos;automatiser — par exemple{" "}
                    <span className="text-foreground font-medium">
                      {`{{${draft.fieldSchema[0].key}}}`}
                    </span>
                    .
                  </p>
                ) : null
              }
            />
          </FormField>

          <FormField label="Champs custom">
            <CustomFieldsSchemaEditor
              fields={draft.fieldSchema}
              onChange={(fields) => setDraft((d) => ({ ...d, fieldSchema: fields }))}
              allowRequired
            />
            {impacts.length > 0 && (
              <Alert variant="warning" className="mt-3">
                <div className="space-y-2.5">
                  <p className="text-[12px] text-foreground">
                    Un champ obligatoire bloque l&apos;enregistrement tant qu&apos;il est
                    vide — y compris sur les fiches déjà créées.
                  </p>
                  {impacts.map((impact) => (
                    <div key={impact.key} className="space-y-1">
                      <p className="text-[12px] text-foreground">
                        <span className="font-medium">{impact.missing}</span> fiche
                        {impact.missing > 1 ? "s" : ""} ne renseigne
                        {impact.missing > 1 ? "nt" : ""} pas «&nbsp;{impact.label}&nbsp;».
                      </p>
                      <div className="flex items-center gap-2">
                        {impact.type !== "checkbox" && (
                          <Input
                            value={backfillValues[impact.key] ?? ""}
                            onChange={(v) =>
                              setBackfillValues((prev) => ({ ...prev, [impact.key]: v }))
                            }
                            placeholder="Valeur à appliquer…"
                            className="text-xs"
                          />
                        )}
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void runBackfill(impact.key)}
                          disabled={
                            backfilling !== null ||
                            (impact.type !== "checkbox" && !(backfillValues[impact.key] ?? "").trim())
                          }
                        >
                          {backfilling === impact.key
                            ? "Remplissage…"
                            : impact.type === "checkbox"
                              ? "Tout cocher"
                              : "Remplir"}
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Alert>
            )}
          </FormField>

        </Drawer.Body>
        <Drawer.Footer>
          {editing && (
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
