"use client";

/**
 * EntityFiche — fiche unifiée d'une Entity (métaobjet), fusion de
 * BienEditorClient (« Bien ») et EventFiche (« Tournage »). Les sections sont
 * conditionnelles selon les capacités du type (hasPlanning/hasAccount/
 * hasRushes/hasAssignees) — cf. `.claude` plan simplification Phase 5.
 */

import { entityTypeIcon } from "@/components/entities/entityTypeIcons";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DateTimeField } from "@/components/ui/molecules/DateTimeField";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Film,
  Trash2,
  Plus,
  MapPin,
  CalendarClock,
  User as UserIcon,
  Pencil,
  Check,
  X,
  FileText,
  MoreHorizontal,
  Archive,
  ArchiveRestore,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { Section } from "@/components/ui/molecules/Section";
import { toast } from "@/components/ui/Toast";
import { CustomFieldValueInput } from "@/components/fields/CustomFieldValueInput";
import type { CustomField } from "@/lib/customFields";
import { AttachSlotModal, type AttachRecipeOption, type AttachAccountOption } from "./AttachSlotModal";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { EntityRushesPanel, type EntityRush } from "@/components/entities/EntityRushesPanel";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { isoToLocalInput, shortDateTimeFr } from "@/lib/date/formatFr";
import { STATUS_LABELS } from "@/types/calendar";
import {
  ENTITY_STATUS_BADGE,
  ENTITY_STATUS_LABELS,
  ENTITY_VALIDATION_BADGE,
  ENTITY_VALIDATION_LABELS,
  type EntityStatus,
  type EntityValidationStatus,
} from "@/types/entities";

export type { EntityRush };

export interface EntitySlotRef {
  id: string;
  title: string | null;
  status: string;
  scheduledAt: string | null;
}
export interface EntityActivityItem {
  id: string;
  type: string;
  createdAt: string;
  actorName: string | null;
}

export interface EntityFicheData {
  id: string;
  typeId: string;
  typeName: string;
  typeNamePlural: string | null;
  /** Icône du type (clé du registry entityTypeIcons). */
  typeIcon: string | null;
  hasPlanning: boolean;
  hasAccount: boolean;
  hasRushes: boolean;
  hasAssignees: boolean;
  visibility: "admin" | "team";
  label: string;
  isArchived: boolean;
  validationStatus: EntityValidationStatus | null;
  /** Le type a la validation client activée (bouton « Redemander »). */
  needsClientValidation: boolean;
  fieldSchema: CustomField[];
  fields: Record<string, string>;
  status: EntityStatus | null;
  accountId: string | null;
  accountLabel: string | null;
  scheduledAt: string | null;
  scheduledAtLabel: string | null;
  assigneeVideasteId: string | null;
  assigneeVideasteName: string | null;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  notes: string | null;
  relatedEntityId: string | null;
  relatedLabel: string | null;
  slots: EntitySlotRef[];
  shootSlots: EntitySlotRef[];
  rushes: EntityRush[];
  activities: EntityActivityItem[];
}

export interface EntityFicheProps {
  entity: EntityFicheData;
  /** Édition label/champs/planning : réservé ADMIN (cf. ALLOWED_ENTITY_PATCH_FIELDS_BY_ROLE). */
  isAdmin: boolean;
  canMarkShot: boolean;
  canUploadRushes: boolean;
  canManageRushes: boolean;
  canAttachSlot: boolean;
  attachMode: "missions" | "reel";
  recipes: AttachRecipeOption[];
  accounts: AttachAccountOption[];
  videastes: { id: string; name: string }[];
  monteurs: { id: string; name: string }[];
  cms: { id: string; name: string }[];
  currentUserId: string;
  backHref: string;
}

const ACTIVITY_LABELS: Record<string, string> = {
  CREATED: "Fiche créée",
  UPDATED: "Fiche modifiée",
  STATUS_CHANGED: "Statut changé",
  RUSHES_UPLOADED: "Rush ajouté",
  RUSHES_DELETED: "Rush supprimé",
  SHOT: "Marquée réalisée",
  SLOT_ATTACHED: "Reel ajouté",
  CANCELLED: "Fiche annulée",
  DONE: "Fiche terminée",
  VALIDATION_APPROVED: "Fiche validée",
  VALIDATION_REJECTED: "Fiche refusée",
  VALIDATION_REQUESTED: "Validation client demandée",
};

export function EntityFiche({
  entity,
  isAdmin,
  canMarkShot,
  canUploadRushes,
  canManageRushes,
  canAttachSlot,
  attachMode,
  recipes,
  accounts,
  videastes,
  monteurs,
  cms,
  currentUserId,
  backHref,
}: EntityFicheProps) {
  const router = useRouter();
  const TypeIcon = entityTypeIcon(entity.typeIcon);
  const [attachOpen, setAttachOpen] = useState(false);

  // ─── Label (header, inline edit) ──────────────────────────────────────
  const [editingLabel, setEditingLabel] = useState(false);
  const [labelDraft, setLabelDraft] = useState(entity.label);
  const [savingLabel, setSavingLabel] = useState(false);

  async function saveLabel() {
    const trimmed = labelDraft.trim();
    if (!trimmed) {
      toast.error("Le libellé ne peut pas être vide.");
      return;
    }
    setSavingLabel(true);
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: trimmed }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de l'enregistrement.");
        return;
      }
      toast.success("Libellé enregistré.");
      setEditingLabel(false);
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setSavingLabel(false);
    }
  }

  // ─── Champs custom ──────────────────────────────────────────────────────
  const [fields, setFields] = useState<Record<string, string>>(entity.fields);
  const [fieldsDirty, setFieldsDirty] = useState(false);
  const [savingFields, setSavingFields] = useState(false);

  function setFieldValue(key: string, value: string) {
    setFields((prev) => ({ ...prev, [key]: value }));
    setFieldsDirty(true);
  }

  async function saveFields() {
    setSavingFields(true);
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de l'enregistrement.");
        return;
      }
      toast.success("Champs enregistrés.");
      setFieldsDirty(false);
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setSavingFields(false);
    }
  }

  // ─── Planning & équipe ──────────────────────────────────────────────────
  const [scheduledAt, setScheduledAt] = useState(
    entity.scheduledAt ? isoToLocalInput(entity.scheduledAt) : "",
  );
  const [assigneeVideasteId, setAssigneeVideasteId] = useState(entity.assigneeVideasteId ?? "");
  const [defaultAssigneeMonteurId, setDefaultAssigneeMonteurId] = useState(
    entity.defaultAssigneeMonteurId ?? "",
  );
  const [defaultAssigneeCmId, setDefaultAssigneeCmId] = useState(entity.defaultAssigneeCmId ?? "");
  const [planningDirty, setPlanningDirty] = useState(false);
  const [savingPlanning, setSavingPlanning] = useState(false);

  async function savePlanning() {
    setSavingPlanning(true);
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
          assigneeVideasteId: assigneeVideasteId || null,
          defaultAssigneeMonteurId: defaultAssigneeMonteurId || null,
          defaultAssigneeCmId: defaultAssigneeCmId || null,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de l'enregistrement.");
        return;
      }
      toast.success("Planning enregistré.");
      setPlanningDirty(false);
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setSavingPlanning(false);
    }
  }

  // ─── Marquer tourné ─────────────────────────────────────────────────────
  const [markingShot, setMarkingShot] = useState(false);
  async function markShot() {
    setMarkingShot(true);
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: "SHOT" }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec du changement de statut.");
        return;
      }
      toast.success("Fiche marquée « Réalisé ».");
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setMarkingShot(false);
    }
  }

  // ─── Actions admin : statut / archiver / supprimer ──────────────────────
  const [changingStatus, setChangingStatus] = useState(false);
  async function changeStatus(next: string) {
    // SHOT passe par le même PATCH — le serveur route vers markEntityShot.
    setChangingStatus(true);
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: next }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec du changement de statut.");
        return;
      }
      toast.success("Statut mis à jour.");
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setChangingStatus(false);
    }
  }

  const [togglingArchive, setTogglingArchive] = useState(false);
  async function toggleArchived() {
    setTogglingArchive(true);
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isArchived: !entity.isArchived }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de l'archivage.");
        return;
      }
      toast.success(entity.isArchived ? "Fiche désarchivée." : "Fiche archivée.");
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setTogglingArchive(false);
    }
  }

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  async function deleteFiche() {
    setDeleting(true);
    try {
      const res = await fetch(`/api/entities/${entity.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de la suppression.");
        return;
      }
      toast.success("Fiche supprimée.");
      router.push(backHref);
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  // ─── Validation (bidirectionnelle) ──────────────────────────────────────
  const [validating, setValidating] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectComment, setRejectComment] = useState("");
  async function runValidation(action: "approve" | "reject" | "request", comment?: string) {
    setValidating(true);
    try {
      const res = await fetch(`/api/entities/${entity.id}/validation`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, comment: comment || null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de la validation.");
        return;
      }
      toast.success(
        action === "approve"
          ? "Fiche validée."
          : action === "reject"
            ? "Fiche refusée."
            : "Validation client demandée.",
      );
      setRejectOpen(false);
      setRejectComment("");
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setValidating(false);
    }
  }

  const attachedSlots = attachMode === "reel" ? entity.shootSlots : entity.slots;
  const attachedLabel = attachMode === "reel" ? "Reels attachés" : "Missions";
  const attachButtonLabel = attachMode === "reel" ? "Ajouter un reel" : "Lancer des missions";
  const status = entity.status ?? "PLANNED";

  const assigneeOptions = (opts: { id: string; name: string }[]) => [
    { value: "", label: "— Aucun —" },
    ...opts.map((o) => ({ value: o.id, label: o.name })),
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <Breadcrumb
          className="mb-3"
          items={[
            { href: "/fiches", label: "Fiches" },
            { href: backHref, label: entity.typeNamePlural ?? entity.typeName },
            { label: entity.label },
          ]}
        />
        <div className="flex items-start gap-3 flex-wrap">
          <div className="min-w-0 flex-1">
            {editingLabel ? (
              <div className="flex items-center gap-1.5">
                <Input
                  value={labelDraft}
                  onChange={setLabelDraft}
                  autoFocus
                  className="max-w-md"
                />
                <button
                  type="button"
                  onClick={() => void saveLabel()}
                  disabled={savingLabel}
                  className="p-1.5 rounded-md hover:bg-muted text-success-700 focus-ring"
                  aria-label="Enregistrer"
                >
                  <Check size={16} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setLabelDraft(entity.label);
                    setEditingLabel(false);
                  }}
                  disabled={savingLabel}
                  className="p-1.5 rounded-md hover:bg-muted text-muted-foreground focus-ring"
                  aria-label="Annuler"
                >
                  <X size={16} />
                </button>
              </div>
            ) : (
              <h1 className="text-xl font-semibold tracking-tight text-foreground inline-flex items-center gap-2 group">
                <TypeIcon size={17} className="text-muted-foreground shrink-0" />
                {entity.label}
                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => {
                      setLabelDraft(entity.label);
                      setEditingLabel(true);
                    }}
                    className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted opacity-0 group-hover:opacity-100 transition-opacity focus-ring"
                    aria-label="Modifier le libellé"
                  >
                    <Pencil size={14} />
                  </button>
                )}
              </h1>
            )}
            <div className="mt-1.5 flex items-center gap-3 flex-wrap text-[12.5px] text-muted-foreground">
              <span className="rounded-md bg-muted px-1.5 py-0.5 border border-border text-[11px]">
                {entity.typeName}
              </span>
              {entity.isArchived && (
                <span className="rounded-md bg-muted px-1.5 py-0.5 border border-border text-[11px] text-muted-foreground">
                  Archivée
                </span>
              )}
              {entity.scheduledAtLabel && (
                <span className="inline-flex items-center gap-1">
                  <CalendarClock size={13} /> {entity.scheduledAtLabel}
                </span>
              )}
              {entity.accountLabel && <span>@{entity.accountLabel}</span>}
              {entity.relatedLabel && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={13} /> {entity.relatedLabel}
                </span>
              )}
              {entity.assigneeVideasteName && (
                <span className="inline-flex items-center gap-1">
                  <UserIcon size={13} /> {entity.assigneeVideasteName}
                </span>
              )}
            </div>
          </div>
          <div className="ml-auto shrink-0 flex items-center gap-2">
            {entity.validationStatus && (
              <span
                className={[
                  "text-[11px] rounded-md px-2 py-1 border",
                  ENTITY_VALIDATION_BADGE[entity.validationStatus],
                ].join(" ")}
              >
                {ENTITY_VALIDATION_LABELS[entity.validationStatus]}
              </span>
            )}
            {isAdmin &&
              (entity.validationStatus === "PENDING_ADMIN" ||
                entity.validationStatus === "PENDING_CLIENT" ||
                entity.validationStatus === "REJECTED" ||
                entity.validationStatus === "REJECTED_CLIENT") && (
                <>
                  <Button
                    size="sm"
                    onClick={() => void runValidation("approve")}
                    disabled={validating}
                  >
                    Valider
                  </Button>
                  {entity.validationStatus !== "REJECTED" &&
                    entity.validationStatus !== "REJECTED_CLIENT" && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setRejectOpen(true)}
                      disabled={validating}
                    >
                      Refuser
                    </Button>
                  )}
                </>
              )}
            {entity.hasPlanning && (
              <>
                {canMarkShot && !isAdmin && status === "PLANNED" && (
                  <Button size="sm" variant="secondary" onClick={() => void markShot()} disabled={markingShot}>
                    {markingShot ? "…" : "Marquer réalisé"}
                  </Button>
                )}
                {isAdmin ? (
                  <div className="w-36">
                    <Select
                      value={status}
                      onChange={(v) => void changeStatus(v)}
                      options={(Object.keys(ENTITY_STATUS_LABELS) as EntityStatus[]).map((st) => ({
                        value: st,
                        label: ENTITY_STATUS_LABELS[st],
                      }))}
                      disabled={changingStatus}
                    />
                  </div>
                ) : (
                  <span
                    className={["text-[11px] rounded-md px-2 py-1 border", ENTITY_STATUS_BADGE[status]].join(" ")}
                  >
                    {ENTITY_STATUS_LABELS[status]}
                  </span>
                )}
              </>
            )}
            {isAdmin && (
              <DropdownMenu
                align="end"
                trigger={
                  <span
                    className="inline-flex items-center justify-center h-8 w-8 rounded-md border border-input bg-card text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                    aria-label="Actions de la fiche"
                  >
                    <MoreHorizontal size={15} />
                  </span>
                }
                items={[
                  ...(entity.needsClientValidation &&
                  entity.validationStatus !== "PENDING_CLIENT" &&
                  entity.validationStatus !== "PENDING_ADMIN"
                    ? [
                        {
                          label: "Redemander validation client",
                          onClick: () => void runValidation("request"),
                          disabled: validating,
                        },
                      ]
                    : []),
                  {
                    label: entity.isArchived ? "Désarchiver" : "Archiver",
                    icon: entity.isArchived ? ArchiveRestore : Archive,
                    onClick: () => void toggleArchived(),
                    disabled: togglingArchive,
                  },
                  "separator",
                  {
                    label: "Supprimer la fiche",
                    icon: Trash2,
                    destructive: true,
                    onClick: () => setDeleteOpen(true),
                  },
                ]}
              />
            )}
          </div>
        </div>
        {entity.notes && (
          <p className="mt-3 text-[13px] text-muted-foreground bg-muted/50 rounded-md px-3 py-2">
            {entity.notes}
          </p>
        )}
      </div>

      {/* Champs custom */}
      <Section title="Champs" icon={FileText}>
        {entity.fieldSchema.length === 0 ? (
          <p className="text-[12.5px] text-muted-foreground">
            Aucun champ défini pour ce type de fiche.
            {isAdmin && (
              <>
                {" "}
                <Link href="/admin/entity-types" className="text-primary hover:underline">
                  Configurer les champs
                </Link>
              </>
            )}
          </p>
        ) : (
          <div className="space-y-3">
            {entity.fieldSchema.map((field) => (
              <CustomFieldValueInput
                key={field.key}
                field={field}
                value={fields[field.key] ?? ""}
                onChange={(v) => setFieldValue(field.key, v)}
                showLabel
                disabled={!isAdmin}
              />
            ))}
            {isAdmin && fieldsDirty && (
              <div className="flex justify-end">
                <Button size="sm" onClick={() => void saveFields()} disabled={savingFields}>
                  {savingFields ? "Enregistrement…" : "Enregistrer"}
                </Button>
              </div>
            )}
          </div>
        )}
      </Section>

      {/* Planning & équipe */}
      {entity.hasPlanning && isAdmin && (
        <Section title="Planning & équipe" icon={CalendarClock}>
          <div className="space-y-3">
            <FormField label="Date et heure">
              <DateTimeField
                value={scheduledAt}
                onChange={(v) => {
                  setScheduledAt(v);
                  setPlanningDirty(true);
                }}
              />
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormField label="Vidéaste">
                <Select
                  value={assigneeVideasteId}
                  onChange={(v) => {
                    setAssigneeVideasteId(v);
                    setPlanningDirty(true);
                  }}
                  options={assigneeOptions(videastes)}
                />
              </FormField>
              <FormField label="Monteur par défaut">
                <Select
                  value={defaultAssigneeMonteurId}
                  onChange={(v) => {
                    setDefaultAssigneeMonteurId(v);
                    setPlanningDirty(true);
                  }}
                  options={assigneeOptions(monteurs)}
                />
              </FormField>
              <FormField label="CM par défaut">
                <Select
                  value={defaultAssigneeCmId}
                  onChange={(v) => {
                    setDefaultAssigneeCmId(v);
                    setPlanningDirty(true);
                  }}
                  options={assigneeOptions(cms)}
                />
              </FormField>
            </div>
            {planningDirty && (
              <div className="flex justify-end">
                <Button size="sm" onClick={() => void savePlanning()} disabled={savingPlanning}>
                  {savingPlanning ? "Enregistrement…" : "Enregistrer"}
                </Button>
              </div>
            )}
          </div>
        </Section>
      )}

      {/* Rushs de la fiche — panel partagé avec le détail de commande. */}
      {entity.hasRushes && (
        <EntityRushesPanel
          entityId={entity.id}
          rushes={entity.rushes}
          canUpload={canUploadRushes}
          canManage={canManageRushes}
          currentUserId={currentUserId}
        />
      )}

      {/* Reels / Missions rattachés */}
      <section className="rounded-lg bg-card border border-border">
        <header className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Film size={15} className="text-muted-foreground" />
          <h2 className="text-[13px] font-semibold tracking-tight text-foreground">{attachedLabel}</h2>
          <span className="text-[11px] tabular-nums text-muted-foreground">· {attachedSlots.length}</span>
          {canAttachSlot && (
            <Button size="sm" variant="secondary" icon={Plus} className="ml-auto" onClick={() => setAttachOpen(true)}>
              {attachButtonLabel}
            </Button>
          )}
        </header>
        <div className="p-2">
          {attachedSlots.length === 0 ? (
            <EmptyState
              icon={<Film size={20} className="text-muted-foreground" />}
              title={attachMode === "reel" ? "Aucun reel" : "Aucune mission"}
              description={
                attachMode === "reel"
                  ? "Accrochez des reels à cette fiche — pendant ou après, autant que nécessaire."
                  : "Lancez des missions depuis cette fiche — une par recette."
              }
              {...(canAttachSlot ? { cta: { label: attachButtonLabel, onClick: () => setAttachOpen(true) } } : {})}
            />
          ) : (
            <ul className="divide-y divide-border">
              {attachedSlots.map((slot) => (
                <li key={slot.id}>
                  <Link
                    href={`/publications/${slot.id}`}
                    className="flex items-center justify-between gap-3 px-2 py-2.5 rounded-md hover:bg-muted transition-colors focus-ring"
                  >
                    <div className="min-w-0">
                      <p className="text-[13px] font-medium text-foreground truncate">
                        {slot.title ?? "Reel"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        {slot.scheduledAt ? shortDateTimeFr(slot.scheduledAt) : "En banque"}
                      </p>
                    </div>
                    <span className="shrink-0 text-[11px] text-muted-foreground rounded-md bg-muted px-1.5 py-0.5 border border-border">
                      {STATUS_LABELS[slot.status as keyof typeof STATUS_LABELS] ?? slot.status}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Activité */}
      {entity.activities.length > 0 && (
        <section className="rounded-lg bg-card border border-border">
          <header className="px-4 py-3 border-b border-border">
            <h2 className="text-[13px] font-semibold tracking-tight text-foreground">Activité</h2>
          </header>
          <ul className="p-4 space-y-2">
            {entity.activities.map((a) => (
              <li key={a.id} className="flex items-center gap-2 text-[12px]">
                <span className="w-1.5 h-1.5 rounded-full bg-border shrink-0" />
                <span className="text-foreground">{ACTIVITY_LABELS[a.type] ?? a.type}</span>
                <span className="text-muted-foreground">{a.actorName ? `· ${a.actorName}` : ""}</span>
                <span className="ml-auto text-muted-foreground tabular-nums">
                  {shortDateTimeFr(a.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ConfirmDialog
        open={rejectOpen}
        title="Refuser la fiche ?"
        description="La fiche repasse en « Refusée » — son créateur devra la corriger avant une nouvelle validation."
        confirmLabel="Refuser"
        variant="danger"
        loading={validating}
        onConfirm={() => void runValidation("reject", rejectComment)}
        onCancel={() => {
          setRejectOpen(false);
          setRejectComment("");
        }}
      >
        <textarea
          value={rejectComment}
          onChange={(e) => setRejectComment(e.target.value)}
          rows={3}
          placeholder="Motif (optionnel, visible dans l'activité)…"
          className="w-full rounded-md border border-input bg-card px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring/40"
        />
      </ConfirmDialog>

      <ConfirmDialog
        open={deleteOpen}
        title="Supprimer la fiche ?"
        description="Suppression définitive (fiche, rushs et activité). Les publications rattachées doivent d'abord être détachées."
        confirmLabel="Supprimer"
        variant="danger"
        loading={deleting}
        onConfirm={() => void deleteFiche()}
        onCancel={() => setDeleteOpen(false)}
      />

      {canAttachSlot && attachOpen && (
        <AttachSlotModal
          entityId={entity.id}
          entityLabel={entity.label}
          mode={attachMode}
          recipes={recipes}
          accounts={accounts}
          onClose={() => setAttachOpen(false)}
        />
      )}
    </div>
  );
}
