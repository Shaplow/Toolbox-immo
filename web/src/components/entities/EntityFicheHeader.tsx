"use client";

/**
 * EntityFicheHeader — l'identité de la fiche et ce qu'on peut lui faire.
 *
 * Ne passe pas par `wrap()` : le contrat de section gate par RÔLE, or le
 * header n'a aucune condition de montage — il est la fiche. Il porte ses deux
 * confirmations (refus de validation, suppression), qui sont portalées : leur
 * place dans l'arbre n'a aucun effet visuel.
 *
 * Ne porte PAS sa barre : la coque collante et le conteneur centré viennent de
 * `FicheShell`. Les notes de la fiche n'y sont pas non plus — un paragraphe
 * libre dans une barre qui suit le scroll la ferait grossir sans raison.
 */

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Trash2,
  MapPin,
  CalendarClock,
  User as UserIcon,
  Pencil,
  Check,
  X,
  MoreHorizontal,
  Archive,
  ArchiveRestore,
  ClipboardList,
} from "lucide-react";
import { entityTypeIcon } from "@/components/entities/entityTypeIcons";
import { Breadcrumb } from "@/components/ui/Breadcrumb";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { DropdownMenu } from "@/components/ui/DropdownMenu";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { toast } from "@/components/ui/Toast";
import {
  ENTITY_STATUS_BADGE,
  ENTITY_STATUS_LABELS,
  ENTITY_VALIDATION_BADGE,
  ENTITY_VALIDATION_LABELS,
  type EntityStatus,
} from "@/types/entities";
import type { EntityFicheData } from "./ficheTypes";

export interface EntityFicheHeaderProps {
  entity: Pick<
    EntityFicheData,
    | "id"
    | "label"
    | "labelIsCustom"
    | "labelTemplate"
    | "typeName"
    | "typeNamePlural"
    | "typeIcon"
    | "isArchived"
    | "status"
    | "hasPlanning"
    | "validationStatus"
    | "needsClientValidation"
    | "scheduledAtLabel"
    | "accountLabel"
    | "relatedLabel"
    | "assigneeVideasteName"
    | "orderId"
    | "orderLabel"
  >;
  isAdmin: boolean;
  canMarkShot: boolean;
  backHref: string;
}

export function EntityFicheHeader({
  entity,
  isAdmin,
  canMarkShot,
  backHref,
}: EntityFicheHeaderProps) {
  const router = useRouter();
  const TypeIcon = entityTypeIcon(entity.typeIcon);
  const status = entity.status ?? "PLANNED";

  // ─── Label (inline edit) ────────────────────────────────────────────────
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

  return (
    <>
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
      </div>

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
    </>
  );
}
