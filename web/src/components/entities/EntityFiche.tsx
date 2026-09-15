"use client";

/**
 * EntityFiche — fiche unifiée d'une Entity (métaobjet), fusion de
 * BienEditorClient (« Bien ») et EventFiche (« Tournage »). Les sections sont
 * conditionnelles selon les capacités du type (hasPlanning/hasAccount/
 * hasRushes/hasAssignees) — cf. `.claude` plan simplification Phase 5.
 */

import { entityTypeIcon } from "@/components/entities/entityTypeIcons";
import { Alert } from "@/components/ui/Alert";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { DateTimeField } from "@/components/ui/molecules/DateTimeField";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Ban,
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
  ClipboardList,
  Mic,
  Paperclip,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { FormField } from "@/components/ui/FormField";
import { Select } from "@/components/ui/Select";
import { EmptyState } from "@/components/ui/EmptyState";
import { Section } from "@/components/ui/molecules/Section";
import { Textarea } from "@/components/ui/Textarea";
import { ButtonIcon } from "@/components/ui/ButtonIcon";
import { TERMINAL_STATUSES } from "@/types/roles";
import { validateFieldValuesAll } from "@/lib/customFields";
import { toast } from "@/components/ui/Toast";
import { MediaDropzone, type UploadResult } from "@/components/ui/MediaDropzone";
import { DeleteButton } from "@/components/ui/DeleteButton";
import { BRIEF_ATTACHMENT_MIME_TYPES } from "@/lib/briefAttachmentTypes";
import { UPLOAD_LIMITS } from "@/lib/upload/limits";
import { CustomFieldValueInput } from "@/components/fields/CustomFieldValueInput";
import { MAX_DECLINE_REASON, needsVideasteAnswer } from "@/lib/entityAvailability";
import type { CustomField } from "@/lib/customFields";
import {
  AttachSlotModal,
  type AttachRecipeOption,
  type AttachAccountOption,
  type AttachShootTypeOption,
} from "./AttachSlotModal";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { EntityRushesPanel, type EntityRush } from "@/components/entities/EntityRushesPanel";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  isPastLocalInput,
  isoToLocalInput,
  localInputToIso,
  shortDateTimeFr,
} from "@/lib/date/formatFr";
import type { SlotStatus } from "@/types/calendar";
import { slotBadgeLabel } from "@/lib/slots/statusLabels";
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
  /** Libellé posé à la main : le recalcul auto ne l'écrase plus. */
  labelIsCustom: boolean;
  /** Modèle de libellé du type — null/vide = libellé saisi à la main. */
  labelTemplate: string | null;
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
  /** null = en attente, "CONFIRMED" | "DECLINED" (réponse du vidéaste). */
  videasteConfirmation: "CONFIRMED" | "DECLINED" | null;
  videasteConfirmationAt: string | null;
  videasteDeclineReason: string | null;
  defaultAssigneeMonteurId: string | null;
  defaultAssigneeCmId: string | null;
  notes: string | null;
  /** Brief de tournage — consignes de prise de vue, lues par le vidéaste. */
  brief: string | null;
  /** Pièces jointes du brief — vocal, doc, photo de repérage. */
  briefAttachments: {
    id: string;
    fileName: string;
    mimeType: string;
    sizeBytes: number | null;
    createdAt: string;
  }[];
  relatedEntityId: string | null;
  relatedLabel: string | null;
  /** Commande d'origine, si la fiche est née d'un bon de commande. */
  orderId: string | null;
  orderLabel: string | null;
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
  /** ADMIN ou vidéaste : le brief est lu par tous, écrit par ces deux-là. */
  canEditBrief: boolean;
  canAttachSlot: boolean;
  /** Retirer un reel sans rushs — ADMIN, MONTEUR, VIDEASTE (cf. canCancelSlot). */
  canCancelSlot: boolean;
  attachMode: "missions" | "reel";
  recipes: AttachRecipeOption[];
  accounts: AttachAccountOption[];
  /** Types de tournage du modèle de commande — vide si la fiche n'en vient pas. */
  shootTypes?: AttachShootTypeOption[];
  defaultShootTypeId?: string | null;
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
  // Le même événement couvre les deux chemins (reel sur un tournage, missions
  // sur une fiche data) — d'où un libellé qui vaut pour les deux.
  SLOT_ATTACHED: "Publication rattachée",
  CANCELLED: "Fiche annulée",
  DONE: "Fiche terminée",
  VALIDATION_APPROVED: "Fiche validée",
  VALIDATION_REJECTED: "Fiche refusée",
  VALIDATION_REQUESTED: "Validation client demandée",
  VIDEASTE_CONFIRMED: "Disponibilité confirmée",
  VIDEASTE_DECLINED: "Vidéaste indisponible",
  VIDEASTE_RESET: "Disponibilité relancée",
};

export function EntityFiche({
  entity,
  isAdmin,
  canMarkShot,
  canUploadRushes,
  canManageRushes,
  canEditBrief,
  canAttachSlot,
  canCancelSlot,
  attachMode,
  recipes,
  accounts,
  shootTypes = [],
  defaultShootTypeId = null,
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
  /**
   * Erreurs de champs, recalculées à chaque frappe.
   *
   * Pré-affichées : depuis que `required` bloque à l'enregistrement, découvrir
   * un champ manquant au clic sur « Enregistrer » — un seul à la fois, dans
   * l'ordre du schéma — transformerait la correction en partie de devinettes.
   * Même source que le serveur (`validateFieldValuesAll`), mêmes `previousValues`,
   * pour que le rouge côté client ne mente jamais sur ce que la garde acceptera.
   */
  const fieldErrors = useMemo(
    () =>
      validateFieldValuesAll(entity.fieldSchema, fields, {
        requireRequired: !entity.isArchived,
        allowUnknownKeys: true,
        previousValues: entity.fields,
      }),
    [entity.fieldSchema, entity.isArchived, entity.fields, fields],
  );
  const missingRequired = entity.fieldSchema.filter(
    (f) => f.required && fieldErrors[f.key],
  ).length;

  // Retrait d'un reel depuis la fiche : le monteur voit ses vidéos ici, il doit
  // pouvoir en retirer une sans passer par le calendrier.
  const [cancelTarget, setCancelTarget] = useState<EntitySlotRef | null>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [cancelling, setCancelling] = useState(false);

  const [brief, setBrief] = useState(entity.brief ?? "");
  const [attachments, setAttachments] = useState(entity.briefAttachments ?? []);
  const [savingBrief, setSavingBrief] = useState(false);
  const briefDirty = brief !== (entity.brief ?? "");

  /** Télécharge une pièce jointe via une URL signée à la demande. */
  async function downloadAttachment(attId: string, fileName: string) {
    try {
      const res = await fetch(`/api/entities/${entity.id}/brief/attachments/${attId}`);
      if (!res.ok) throw new Error("Téléchargement indisponible");
      const { downloadUrl } = (await res.json()) as { downloadUrl: string };
      const a = document.createElement("a");
      a.href = downloadUrl;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch {
      toast.error("Téléchargement impossible.");
    }
  }

  async function deleteAttachment(attId: string) {
    const res = await fetch(`/api/entities/${entity.id}/brief/attachments/${attId}`, {
      method: "DELETE",
    });
    if (!res.ok) {
      toast.error("Suppression impossible.");
      return;
    }
    setAttachments((prev) => prev.filter((a) => a.id !== attId));
    toast.success("Pièce jointe retirée.");
  }

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
      // Le libellé peut avoir été recalculé côté serveur : sans refresh, le
      // titre de la page garderait l'ancienne valeur.
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setSavingFields(false);
    }
  }

  async function confirmCancelSlot() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      const res = await fetch(`/api/publications/${cancelTarget.id}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason: cancelReason }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) {
        toast.error(data.error ?? "Échec du retrait.");
        return;
      }
      toast.success("Vidéo retirée.");
      setCancelTarget(null);
      setCancelReason("");
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setCancelling(false);
    }
  }

  async function saveBrief() {
    setSavingBrief(true);
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        // Chaîne vide → null : un brief effacé doit disparaître de la fiche,
        // pas y rester comme un bloc vide.
        body: JSON.stringify({ brief: brief.trim() || null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de l'enregistrement.");
        return;
      }
      toast.success("Brief enregistré.");
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setSavingBrief(false);
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
          scheduledAt: scheduledAt ? localInputToIso(scheduledAt) : null,
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

  // ─── Libellé automatique ────────────────────────────────────────────────
  const [releasingLabel, setReleasingLabel] = useState(false);
  async function releaseCustomLabel() {
    setReleasingLabel(true);
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ labelIsCustom: false }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de l'enregistrement.");
        return;
      }
      toast.success("Libellé recalculé depuis les champs.");
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setReleasingLabel(false);
    }
  }

  // ─── Disponibilité du vidéaste ──────────────────────────────────────────
  // Le vidéaste assigné répond sur un tournage validé : l'admin sait qui sera
  // là avant le jour J, au lieu de le découvrir par l'absence.
  const [declineOpen, setDeclineOpen] = useState(false);
  const [declineReason, setDeclineReason] = useState("");
  const [answering, setAnswering] = useState(false);

  async function answerAvailability(answer: "CONFIRMED" | "DECLINED", reason?: string) {
    setAnswering(true);
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          videasteConfirmation: answer,
          ...(answer === "DECLINED" ? { videasteDeclineReason: reason ?? "" } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de l'enregistrement.");
        return;
      }
      toast.success(
        answer === "CONFIRMED" ? "Disponibilité confirmée." : "Indisponibilité signalée.",
      );
      setDeclineOpen(false);
      setDeclineReason("");
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setAnswering(false);
    }
  }

  /**
   * ADMIN : remet la disponibilité « en attente » sans réassigner.
   *
   * Sans cette action, un refus était définitif — le vidéaste ne pouvait plus
   * répondre et l'admin n'avait que la réassignation pour débloquer, ce qui
   * perdait l'assigné d'origine.
   */
  const [resetting, setResetting] = useState(false);
  async function resetAvailability() {
    setResetting(true);
    try {
      const res = await fetch(`/api/entities/${entity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videasteConfirmation: null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? "Échec de la relance.");
        return;
      }
      toast.success("Demande de disponibilité relancée.");
      router.refresh();
    } catch {
      toast.error("Erreur réseau.");
    } finally {
      setResetting(false);
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
  const attachedLabel = attachMode === "reel" ? "Reels attachés" : "Publications";
  const attachButtonLabel =
    attachMode === "reel" ? "Ajouter un reel" : "Lancer des publications";
  const status = entity.status ?? "PLANNED";

  // Le bandeau ne s'adresse qu'à l'ASSIGNÉ du tournage : la passerelle d'accès
  // par reel (entityScope) amène ici d'autres vidéastes, qui ne répondent pas
  // à sa place — et le serveur les refuserait.
  //
  // Le test ne porte plus `!isAdmin` : le select des vidéastes accepte les
  // comptes ADMIN (fiches/[id]/page.tsx), et un admin ainsi assigné se
  // retrouvait sans aucun moyen de répondre — la fiche affichait « en attente »
  // indéfiniment. C'est l'identité de l'assigné qui décide, pas le rôle.
  const isAssignedVideaste = currentUserId === entity.assigneeVideasteId;
  const showAvailabilityPrompt = isAssignedVideaste && needsVideasteAnswer(entity);


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
              {/* Sans cet indicateur, un libellé qui bouge tout seul après une
                  édition de champs passe pour un bug. */}
              {entity.labelTemplate &&
                (entity.labelIsCustom ? (
                  isAdmin ? (
                    <button
                      type="button"
                      onClick={() => void releaseCustomLabel()}
                      disabled={releasingLabel}
                      className="rounded-md bg-muted px-1.5 py-0.5 border border-border text-[11px] text-muted-foreground hover:text-foreground hover:bg-accent transition-colors focus-ring"
                      title="Recalculer le libellé depuis les champs et le laisser suivre leurs modifications"
                    >
                      Libellé personnalisé — revenir à l&apos;automatique
                    </button>
                  ) : (
                    <span className="rounded-md bg-muted px-1.5 py-0.5 border border-border text-[11px] text-muted-foreground">
                      Libellé personnalisé
                    </span>
                  )
                ) : (
                  <span
                    className="rounded-md bg-muted px-1.5 py-0.5 border border-border text-[11px] text-muted-foreground"
                    title="Recalculé quand les champs changent"
                  >
                    Libellé automatique
                  </span>
                ))}
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
              {entity.orderId && (
                <Link
                  href={`/commandes/${entity.orderId}`}
                  className="inline-flex items-center gap-1 text-primary hover:underline"
                >
                  <ClipboardList size={13} />
                  {entity.orderLabel ?? "Commande d'origine"}
                </Link>
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

      {/* Disponibilité — vidéaste assigné */}
      {showAvailabilityPrompt && (
        <div
          className={[
            "rounded-lg border px-4 py-3 flex flex-wrap items-center gap-3",
            entity.videasteConfirmation === "DECLINED"
              ? "border-danger-200 bg-danger-50"
              : "border-warning-200 bg-warning-50",
          ].join(" ")}
        >
          <div className="min-w-0">
            <p className="text-[13px] font-medium text-foreground">
              {entity.videasteConfirmation === "DECLINED"
                ? "Vous avez signalé votre indisponibilité"
                : "Êtes-vous disponible pour ce tournage ?"}
            </p>
            <p className="text-[12px] text-muted-foreground">
              {entity.videasteConfirmation === "DECLINED"
                ? "L'admin est prévenu. Vous pouvez encore revenir sur votre réponse."
                : entity.scheduledAtLabel
                  ? `Prévu le ${entity.scheduledAtLabel}. Confirmez pour que l'admin sache que la date est tenue.`
                  : "Confirmez pour que l'admin sache que le tournage est pris en charge."}
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2 shrink-0">
            {/* Reste proposé après un refus : se libérer est le cas normal, et
                le serveur accepte déjà DECLINED → CONFIRMED. Sans ce bouton,
                seul l'admin pouvait débloquer, en réassignant. */}
            <Button
              size="sm"
              onClick={() => void answerAvailability("CONFIRMED")}
              disabled={answering}
            >
              {entity.videasteConfirmation === "DECLINED"
                ? "Finalement, je suis disponible"
                : "Je suis disponible"}
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => setDeclineOpen(true)}
              disabled={answering}
            >
              {entity.videasteConfirmation === "DECLINED"
                ? "Modifier le motif"
                : "Je ne suis pas disponible"}
            </Button>
          </div>
        </div>
      )}

      {/* Brief de tournage — la colonne existait en base depuis la migration
          métaobjet mais n'avait jamais eu d'interface : le champ était écrit
          par l'API et lu par personne. */}
      {entity.hasRushes && (canEditBrief || entity.brief || attachments.length > 0) && (
        <Section title="Brief de tournage" icon={ClipboardList}>
          {canEditBrief ? (
            <div className="space-y-3">
              <Textarea
                value={brief}
                onChange={setBrief}
                rows={5}
                placeholder="Consignes de tournage : plans attendus, angles, ambiance, contraintes sur place…"
              />
              {briefDirty && (
                <div className="flex justify-end gap-2">
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setBrief(entity.brief ?? "")}
                    disabled={savingBrief}
                  >
                    Annuler
                  </Button>
                  <Button size="sm" onClick={() => void saveBrief()} disabled={savingBrief}>
                    {savingBrief ? "Enregistrement…" : "Enregistrer"}
                  </Button>
                </div>
              )}
            </div>
          ) : entity.brief ? (
            <p className="text-[13px] text-foreground whitespace-pre-wrap">{entity.brief}</p>
          ) : null}

          {/* Pièces jointes — « déposer un vocal pour le monteur ». Le même
              bloc que le brief : le mot écrit et le mot dit répondent à la
              même question, ils ne se rangent pas à deux endroits. */}
          <div className="mt-4 pt-4 border-t border-border">
            {canEditBrief && (
              <div className="mb-3">
                <MediaDropzone
                  slotId={entity.id}
                  uploadBasePath={`/api/entities/${entity.id}/brief`}
                  kind="brief-attachment"
                  accept={BRIEF_ATTACHMENT_MIME_TYPES}
                  maxSizeBytes={UPLOAD_LIMITS.BRIEF_ATTACHMENT_MAX_BYTES}
                  multiple
                  label="Déposer un vocal, une photo de repérage, un document…"
                  onUploaded={(r: UploadResult) => {
                    // La route rend la ligne créée ; on la reconstruit ici pour
                    // afficher sans recharger, l'id définitif arrivant au refresh.
                    setAttachments((prev) => [
                      ...prev,
                      {
                        id: r.r2Key,
                        fileName: r.fileName,
                        mimeType: r.mimeType,
                        sizeBytes: r.sizeBytes ?? null,
                        createdAt: new Date().toISOString(),
                      },
                    ]);
                    router.refresh();
                  }}
                  onError={(m) => toast.error(m)}
                />
              </div>
            )}
            {attachments.length === 0 ? (
              <p className="text-[12px] text-muted-foreground">
                {canEditBrief
                  ? "Aucune pièce jointe. Un vocal vaut souvent mieux qu'un paragraphe."
                  : "Aucune pièce jointe."}
              </p>
            ) : (
              <ul className="space-y-1.5">
                {attachments.map((att) => (
                  <li key={att.id} className="flex items-center gap-2">
                    {att.mimeType.startsWith("audio/") ? (
                      <Mic size={13} className="shrink-0 text-muted-foreground" />
                    ) : (
                      <Paperclip size={13} className="shrink-0 text-muted-foreground" />
                    )}
                    <button
                      type="button"
                      onClick={() => void downloadAttachment(att.id, att.fileName)}
                      className="flex-1 min-w-0 text-left text-[13px] text-foreground truncate hover:underline"
                    >
                      {att.fileName}
                    </button>
                    {att.sizeBytes != null && (
                      <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                        {Math.max(1, Math.round(att.sizeBytes / 1024))} Ko
                      </span>
                    )}
                    {canEditBrief && (
                      <DeleteButton
                        itemLabel={`« ${att.fileName} »`}
                        description="La pièce jointe sera définitivement supprimée."
                        size="sm"
                        onConfirm={() => deleteAttachment(att.id)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </Section>
      )}

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
            {isAdmin && missingRequired > 0 && (
              <Alert variant="warning">
                {missingRequired === 1
                  ? "Un champ obligatoire est vide — la fiche ne peut pas être enregistrée."
                  : `${missingRequired} champs obligatoires sont vides — la fiche ne peut pas être enregistrée.`}
              </Alert>
            )}
            {entity.fieldSchema.map((field) => (
              <CustomFieldValueInput
                key={field.key}
                field={field}
                value={fields[field.key] ?? ""}
                onChange={(v) => setFieldValue(field.key, v)}
                showLabel
                validateNumberFormat
                previousValue={entity.fields[field.key] ?? ""}
                error={isAdmin ? fieldErrors[field.key] : undefined}
                disabled={!isAdmin}
              />
            ))}
            {isAdmin && fieldsDirty && (
              <div className="flex justify-end">
                <Button
                  size="sm"
                  onClick={() => void saveFields()}
                  // Inutile d'envoyer une requête dont on connaît déjà le refus.
                  disabled={savingFields || Object.keys(fieldErrors).length > 0}
                >
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
              <>
                <DateTimeField
                  value={scheduledAt}
                  onChange={(v) => {
                    setScheduledAt(v);
                    setPlanningDirty(true);
                  }}
                />
                {scheduledAt && isPastLocalInput(scheduledAt) && (
                  <p className="mt-1 text-[11px] text-warning-700">
                    Date passée — la fiche sort du planning de la semaine en cours.
                  </p>
                )}
              </>
            </FormField>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FormField label="Vidéaste">
                <>
                  <Select
                    value={assigneeVideasteId}
                    onChange={(v) => {
                      setAssigneeVideasteId(v);
                      setPlanningDirty(true);
                    }}
                    options={assigneeOptions(videastes)}
                  />
                  {/* La worklist du vidéaste liste les fiches qui lui sont
                      assignées : sans vidéaste, le tournage n'est nulle part. */}
                  {!assigneeVideasteId && entity.hasRushes && (
                    <p className="mt-1 text-[11px] text-warning-700">
                      Non assigné — ce tournage n&apos;apparaît dans la liste d&apos;aucun vidéaste.
                    </p>
                  )}
                  {/* Réponse du vidéaste — masquée tant que la fiche attend la
                      validation admin : elle ne lui est pas encore visible. */}
                  {assigneeVideasteId &&
                    !planningDirty &&
                    entity.validationStatus !== "PENDING_ADMIN" &&
                    entity.validationStatus !== "REJECTED" &&
                    (entity.videasteConfirmation === "CONFIRMED" ? (
                      <p className="mt-1 text-[11px] text-success-700">
                        Disponibilité confirmée
                        {entity.videasteConfirmationAt
                          ? ` le ${shortDateTimeFr(entity.videasteConfirmationAt)}`
                          : ""}
                        .
                      </p>
                    ) : entity.videasteConfirmation === "DECLINED" ? (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <p className="text-[11px] text-danger-700">
                          Indisponible
                          {entity.videasteDeclineReason ? ` — ${entity.videasteDeclineReason}` : ""}.
                        </p>
                        {isAdmin && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void resetAvailability()}
                            disabled={resetting}
                          >
                            Relancer la demande
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="mt-1 flex flex-wrap items-center gap-2">
                        <p className="text-[11px] text-muted-foreground">
                          En attente de confirmation du vidéaste.
                        </p>
                        {/* Relance utile seulement si une réponse a déjà été
                            donnée puis effacée : sinon la demande est déjà en
                            attente, le bouton ne ferait rien de visible. */}
                        {isAdmin && entity.videasteConfirmationAt && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void resetAvailability()}
                            disabled={resetting}
                          >
                            Relancer la demande
                          </Button>
                        )}
                      </div>
                    ))}
                </>
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

      {/* Reels / publications rattachés */}
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
              title={attachMode === "reel" ? "Aucun reel" : "Aucune publication"}
              description={
                attachMode === "reel"
                  ? "Accrochez des reels à cette fiche — pendant ou après, autant que nécessaire."
                  : "Lancez des publications depuis cette fiche — une par recette."
              }
              {...(canAttachSlot ? { cta: { label: attachButtonLabel, onClick: () => setAttachOpen(true) } } : {})}
            />
          ) : (
            <ul className="divide-y divide-border">
              {attachedSlots.map((slot) => {
                const removed = slot.status === "CANCELLED";
                return (
                  <li key={slot.id} className="flex items-center gap-1">
                    <Link
                      href={`/publications/${slot.id}`}
                      className="flex flex-1 min-w-0 items-center justify-between gap-3 px-2 py-2.5 rounded-md hover:bg-muted transition-colors focus-ring"
                    >
                      <div className="min-w-0">
                        {/* Une vidéo retirée reste listée — c'est ce qui explique
                            « pourquoi 4 et pas 5 » — mais elle ne doit pas se
                            lire comme une vidéo encore à produire. */}
                        <p
                          className={[
                            "text-[13px] font-medium truncate",
                            removed ? "text-muted-foreground line-through" : "text-foreground",
                          ].join(" ")}
                        >
                          {slot.title ?? "Reel"}
                        </p>
                        {slot.scheduledAt && (
                          <p className="text-[11px] text-muted-foreground">
                            {shortDateTimeFr(slot.scheduledAt)}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 text-[11px] text-muted-foreground rounded-md bg-muted px-1.5 py-0.5 border border-border">
                        {slotBadgeLabel(slot.status as SlotStatus, slot.scheduledAt)}
                      </span>
                    </Link>
                    {canCancelSlot && !removed && !(TERMINAL_STATUSES as readonly string[]).includes(slot.status) && (
                      <ButtonIcon
                        icon={Ban}
                        label="Retirer cette vidéo"
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setCancelTarget(slot);
                          setCancelReason("");
                        }}
                      />
                    )}
                  </li>
                );
              })}
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
        open={cancelTarget !== null}
        title="Retirer cette vidéo ?"
        description={`« ${cancelTarget?.title ?? "Reel"} » passera au statut « Annulée » et sortira des worklists. Rien n'est supprimé, et la commande ne la recréera pas.`}
        confirmLabel="Retirer la vidéo"
        variant="danger"
        loading={cancelling || !cancelReason.trim()}
        onConfirm={() => {
          void confirmCancelSlot();
        }}
        onCancel={() => {
          setCancelTarget(null);
          setCancelReason("");
        }}
      >
        <Textarea
          value={cancelReason}
          onChange={setCancelReason}
          rows={2}
          placeholder="Motif (ex : pas de rushs pour cette vidéo)"
        />
      </ConfirmDialog>

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
        open={declineOpen}
        title="Signaler une indisponibilité ?"
        description="L'admin est prévenu. Vous pourrez revenir sur cette réponse tant que le tournage n'a pas eu lieu."
        confirmLabel="Je ne suis pas disponible"
        variant="danger"
        loading={answering}
        onConfirm={() => void answerAvailability("DECLINED", declineReason)}
        onCancel={() => {
          setDeclineOpen(false);
          setDeclineReason("");
        }}
      >
        <textarea
          value={declineReason}
          onChange={(e) => setDeclineReason(e.target.value)}
          rows={3}
          maxLength={MAX_DECLINE_REASON}
          placeholder="Motif (optionnel, visible par l'admin)…"
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
          shootTypes={shootTypes}
          defaultShootTypeId={defaultShootTypeId}
          onClose={() => setAttachOpen(false)}
        />
      )}
    </div>
  );
}
